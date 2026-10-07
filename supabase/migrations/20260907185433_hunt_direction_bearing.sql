-- D01: direction to the current target alongside the near/far bar.
-- Decision G7 (2026-09-07): direction is always available in games whose GM
-- opted in (games.direction_enabled, default off), as an exact true-north
-- bearing in whole degrees [0, 360). While direction is enabled the player
-- receives only the five distance bands: the 10 m rounded readout is
-- withheld and distance_m is coarsened to the band edge so an already
-- installed APK still renders a value that reveals nothing beyond the band.
-- Games with direction off keep today's rounded metres. Cloak, two-minute
-- freshness and stale suppression apply to the bearing unchanged. Bonus
-- direction (B01) is not part of this migration.

alter table public.games
  add column direction_enabled boolean not null default false;

comment on column public.games.direction_enabled is
  'GM opt-in: living hunters receive a true-north bearing to their target and bands-only distance.';

-- Column-level SELECT (join_code containment replaced the table grant).
-- UPDATE stays table-level and is gated by the games_update_gm RLS policy.
grant select (direction_enabled) on public.games to authenticated;

-- Least-information metre value consistent with a band: its upper edge, or
-- the 1 km lower edge for "far". Sent instead of the rounded distance while
-- direction is enabled.
create function private.hunt_band_edge_m(p_distance_m double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_distance_m <= 25 then 25
    when p_distance_m <= 100 then 100
    when p_distance_m <= 300 then 300
    else 1000
  end;
$$;

revoke all on function private.hunt_band_edge_m(double precision)
  from public, anon, authenticated;

comment on function private.hunt_band_edge_m(double precision) is
  'Band-edge distance used in place of rounded metres when direction is enabled.';

-- Same authorization and freshness branches as before; direction fields are
-- only ever added inside the "available" proximity branch, so unauthorized,
-- non-participant, eliminated, finished, waiting, stale and cloaked
-- responses cannot leak a bearing.
create or replace function public.get_hunt_status(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  round_row private.hunt_rounds%rowtype;
  player_row private.hunt_players%rowtype;
  player_found boolean := false;
  target_row private.hunt_players%rowtype;
  own_position public.player_positions%rowtype;
  target_position public.player_positions%rowtype;
  target_name text;
  winner_name text;
  incoming_claim jsonb;
  outgoing_claim jsonb;
  target_json jsonb;
  proximity_json jsonb;
  distance_m double precision;
  alive_count integer;
  direction_enabled boolean := false;
  azimuth double precision;
  bearing_deg integer;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_member(g, caller) then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;

  select * into round_row
  from private.hunt_rounds round
  where round.game_id = g;

  if not found then
    return jsonb_build_object(
      'phase', 'not_started',
      'participant', false,
      'alive', false
    );
  end if;

  select * into player_row
  from private.hunt_players player
  where player.game_id = g and player.profile_id = caller;
  player_found := found;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  if round_row.winner_id is not null then
    select character.name into winner_name
    from public.characters character
    where character.game_id = g
      and character.user_id = round_row.winner_id
      and not character.is_npc
    limit 1;
  end if;

  if not player_found then
    return jsonb_build_object(
      'phase', round_row.status,
      'participant', false,
      'alive', false,
      'alive_count', alive_count,
      'winner', case when round_row.winner_id is null then null else
        jsonb_build_object('character_name', winner_name) end
    );
  end if;

  select jsonb_build_object(
    'id', claim.id,
    'requested_at', claim.requested_at
  ) into incoming_claim
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.victim_id = caller
    and claim.status = 'pending'
  order by claim.requested_at desc
  limit 1;

  select jsonb_build_object(
    'id', claim.id,
    'requested_at', claim.requested_at
  ) into outgoing_claim
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.hunter_id = caller
    and claim.status = 'pending'
  order by claim.requested_at desc
  limit 1;

  if round_row.status = 'active'
     and player_row.state = 'alive'
     and player_row.target_profile_id is not null then
    select * into target_row
    from private.hunt_players target
    where target.game_id = g
      and target.profile_id = player_row.target_profile_id;

    select character.name into target_name
    from public.characters character
    where character.game_id = g
      and character.user_id = player_row.target_profile_id
      and not character.is_npc
    limit 1;

    if target_row.hidden_until > now() then
      proximity_json := jsonb_build_object(
        'state', 'cloaked',
        'available_at', target_row.hidden_until
      );
    else
      select * into own_position
      from public.player_positions position
      where position.game_id = g and position.profile_id = caller;

      select * into target_position
      from public.player_positions position
      where position.game_id = g
        and position.profile_id = player_row.target_profile_id;

      if own_position.profile_id is null or target_position.profile_id is null then
        proximity_json := jsonb_build_object('state', 'waiting_for_location');
      elsif own_position.recorded_at < now() - interval '2 minutes'
         or target_position.recorded_at < now() - interval '2 minutes' then
        proximity_json := jsonb_build_object(
          'state', 'stale',
          'last_seen_at', target_position.recorded_at
        );
      else
        distance_m := extensions.st_distance(
          own_position.geog,
          target_position.geog
        );

        select game.direction_enabled into direction_enabled
        from public.games game
        where game.id = g;

        if coalesce(direction_enabled, false) then
          -- Geography azimuth: radians clockwise from true north, null when the
          -- points coincide. Normalized to whole degrees in [0, 360).
          azimuth := extensions.st_azimuth(own_position.geog, target_position.geog);
          if azimuth is not null then
            bearing_deg := (round(degrees(azimuth))::integer % 360 + 360) % 360;
          end if;
          proximity_json := jsonb_build_object(
            'state', 'available',
            'band', private.hunt_distance_band(distance_m),
            'distance_m', private.hunt_band_edge_m(distance_m),
            'distance_is_band_edge', true,
            'direction_state', case when bearing_deg is null then 'unavailable' else 'available' end,
            'bearing_deg', bearing_deg,
            'computed_at', now(),
            'valid_until', least(own_position.recorded_at, target_position.recorded_at) + interval '2 minutes',
            'last_seen_at', target_position.recorded_at
          );
        else
          proximity_json := jsonb_build_object(
            'state', 'available',
            'band', private.hunt_distance_band(distance_m),
            'distance_m', (round(distance_m::numeric / 10) * 10)::integer,
            'direction_state', 'not_enabled',
            'last_seen_at', target_position.recorded_at
          );
        end if;
      end if;
    end if;

    target_json := jsonb_build_object(
      'character_name', target_name,
      'proximity', proximity_json
    );
  end if;

  return jsonb_build_object(
    'phase', round_row.status,
    'participant', true,
    'alive', player_row.state = 'alive',
    'alive_count', alive_count,
    'hidden_until', player_row.hidden_until,
    'direction_enabled', (select game.direction_enabled from public.games game where game.id = g),
    'target', target_json,
    'incoming_claim', incoming_claim,
    'outgoing_claim', outgoing_claim,
    'winner', case when round_row.winner_id is null then null else
      jsonb_build_object(
        'character_name', winner_name,
        'is_self', round_row.winner_id = caller
      ) end
  );
end;
$$;

comment on function public.get_hunt_status(uuid) is
  'Returns only the caller hunt state, assigned target, proximity and, when the GM enabled it, a true-north bearing.';
