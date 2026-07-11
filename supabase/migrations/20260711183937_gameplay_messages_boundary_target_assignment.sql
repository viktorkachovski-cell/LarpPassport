alter table public.zones
  add column zone_type text not null default 'event'
    check (zone_type in ('event', 'play_area')),
  add column warning_distance_m double precision not null default 50
    check (warning_distance_m between 5 and 5000);

create unique index zones_one_play_area_per_game_idx
  on public.zones (game_id)
  where zone_type = 'play_area';

alter table private.zone_state
  add column warning_active boolean not null default false,
  add column outside_active boolean not null default false;

alter table private.hunt_players
  add column pending_target_profile_id uuid,
  add constraint hunt_players_pending_target_fkey
    foreign key (game_id, pending_target_profile_id)
    references private.hunt_players(game_id, profile_id),
  add constraint hunt_players_pending_target_alive_check
    check (state = 'alive' or pending_target_profile_id is null);

create unique index hunt_players_pending_target_unique_idx
  on private.hunt_players (game_id, pending_target_profile_id)
  where pending_target_profile_id is not null;

create or replace view public.zones_view
with (security_invoker = true)
as
select
  z.id,
  z.game_id,
  z.name,
  z.shape,
  z.radius_m,
  z.trigger_mode,
  z.dwell_seconds,
  z.exit_buffer_m,
  z.one_shot,
  z.active,
  z.payload,
  z.created_at,
  extensions.st_asgeojson(z.geog)::json as geojson,
  z.zone_type,
  z.warning_distance_m
from public.zones z;

create or replace function private.rearm_zone_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.active is distinct from old.active
     or new.shape is distinct from old.shape
     or new.radius_m is distinct from old.radius_m
     or new.geog::text is distinct from old.geog::text
     or new.zone_type is distinct from old.zone_type
     or new.warning_distance_m is distinct from old.warning_distance_m then
    delete from private.zone_state where zone_id = new.id;
  end if;
  return new;
end;
$$;

create function private.emit_play_area_event(
  p_zone public.zones,
  p_user_id uuid,
  p_event_type text,
  p_at_time timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_character_id uuid;
  event_message text;
begin
  select character.id into player_character_id
  from public.characters character
  where character.game_id = p_zone.game_id
    and character.user_id = p_user_id
    and not character.is_npc
  limit 1;

  event_message := case p_event_type
    when 'zone_boundary_warning' then
      'Warning: you are nearing the edge of the time anomaly. Leaving it will forfeit any active elimination claim.'
    else
      'You left the time anomaly. Any active elimination claim was forfeited; contact the GM for a ruling.'
  end;

  insert into public.game_events (
    game_id, profile_id, character_id, zone_id, type, status,
    player_visible, payload, created_at
  ) values (
    p_zone.game_id,
    p_user_id,
    player_character_id,
    p_zone.id,
    p_event_type,
    case when p_event_type = 'zone_boundary_exit' then 'pending' else 'confirmed' end,
    true,
    p_zone.payload || jsonb_build_object('message', event_message),
    p_at_time
  );
end;
$$;

create or replace function private.evaluate_zones(
  p_game_id uuid,
  p_user_id uuid,
  p_position extensions.geography,
  p_at_time timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone_row public.zones%rowtype;
  state_row private.zone_state%rowtype;
  is_inside boolean;
  near_boundary boolean;
  center_distance_m double precision;
begin
  for zone_row in
    select * from public.zones
    where game_id = p_game_id and active
  loop
    if zone_row.shape = 'circle' then
      is_inside := extensions.st_dwithin(
        p_position, zone_row.geog, zone_row.radius_m
      );
    else
      is_inside := extensions.st_intersects(p_position, zone_row.geog);
    end if;

    insert into private.zone_state (zone_id, profile_id)
    values (zone_row.id, p_user_id)
    on conflict (zone_id, profile_id) do nothing;

    select * into state_row
    from private.zone_state
    where zone_id = zone_row.id and profile_id = p_user_id
    for update;

    if zone_row.zone_type = 'play_area' then
      if zone_row.shape = 'circle' then
        center_distance_m := extensions.st_distance(p_position, zone_row.geog);
        near_boundary := is_inside and center_distance_m >= greatest(
          zone_row.radius_m - zone_row.warning_distance_m,
          0::double precision
        );
      else
        near_boundary := is_inside and extensions.st_dwithin(
          p_position,
          extensions.st_boundary(
            zone_row.geog::extensions.geometry
          )::extensions.geography,
          zone_row.warning_distance_m
        );
      end if;

      if is_inside then
        if near_boundary and not state_row.warning_active then
          perform private.emit_play_area_event(
            zone_row, p_user_id, 'zone_boundary_warning', p_at_time
          );
        end if;

        update private.zone_state
        set inside = true,
            inside_since = coalesce(inside_since, p_at_time),
            warning_active = near_boundary,
            outside_active = false,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
      elsif not state_row.outside_active then
        update private.hunt_claims
        set status = 'rejected', responded_at = now(), response_by = p_user_id
        where game_id = p_game_id
          and hunter_id = p_user_id
          and status = 'pending';

        perform private.emit_play_area_event(
          zone_row, p_user_id, 'zone_boundary_exit', p_at_time
        );

        update private.zone_state
        set inside = false,
            inside_since = null,
            fired_at = null,
            warning_active = false,
            outside_active = true,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
      end if;

      continue;
    end if;

    if is_inside then
      if not state_row.inside then
        update private.zone_state
        set inside = true,
            inside_since = p_at_time,
            fired_at = null,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
        state_row.inside_since := p_at_time;
        state_row.fired_at := null;
      end if;

      if state_row.fired_at is null
         and not (zone_row.one_shot and state_row.trigger_count > 0)
         and p_at_time >= state_row.inside_since
             + pg_catalog.make_interval(secs => zone_row.dwell_seconds) then
        update private.zone_state
        set fired_at = p_at_time,
            trigger_count = state_row.trigger_count + 1,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
        perform private.emit_zone_event(
          zone_row, p_user_id, 'zone_enter', p_at_time
        );
      end if;
    elsif state_row.inside and not extensions.st_dwithin(
      p_position,
      zone_row.geog,
      case
        when zone_row.shape = 'circle'
          then zone_row.radius_m + zone_row.exit_buffer_m
        else zone_row.exit_buffer_m
      end
    ) then
      update private.zone_state
      set inside = false,
          inside_since = null,
          fired_at = null,
          updated_at = now()
      where zone_id = zone_row.id and profile_id = p_user_id;

      if state_row.fired_at is not null then
        perform private.emit_zone_event(
          zone_row, p_user_id, 'zone_exit', p_at_time
        );
      end if;
    end if;
  end loop;
end;
$$;

create function private.defer_hunt_target_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.state = 'alive' and new.state = 'eliminated' then
    update private.hunt_players hunter
    set pending_target_profile_id = old.target_profile_id
    where hunter.game_id = old.game_id
      and hunter.state = 'alive'
      and hunter.target_profile_id = old.profile_id;
  elsif old.pending_target_profile_id is not null
        and new.pending_target_profile_id = old.pending_target_profile_id
        and new.target_profile_id = old.pending_target_profile_id then
    -- Existing elimination code attempts automatic inheritance; hold it for GM assignment.
    new.target_profile_id := null;
  end if;
  return new;
end;
$$;

create trigger hunt_players_defer_target_assignment
  before update on private.hunt_players
  for each row execute function private.defer_hunt_target_assignment();

create function private.cleanup_finished_hunt_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finished' and old.status is distinct from new.status then
    update private.hunt_players
    set pending_target_profile_id = null
    where game_id = new.game_id;
  end if;
  return new;
end;
$$;

create trigger hunt_rounds_cleanup_pending_assignments
  after update on private.hunt_rounds
  for each row execute function private.cleanup_finished_hunt_assignments();

create function private.reject_competing_hunt_claims()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'pending' and new.status = 'confirmed' then
    update private.hunt_claims
    set status = 'rejected', responded_at = now(), response_by = new.response_by
    where game_id = new.game_id
      and id <> new.id
      and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger hunt_claims_reject_after_confirmation
  after update on private.hunt_claims
  for each row execute function private.reject_competing_hunt_claims();

create function private.block_claim_until_target_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from private.hunt_players player
    where player.game_id = new.game_id
      and player.pending_target_profile_id is not null
  ) then
    raise exception using errcode = '55000',
      message = 'the GM must assign the next target first';
  end if;
  return new;
end;
$$;

create trigger hunt_claims_wait_for_target_assignment
  before insert on private.hunt_claims
  for each row execute function private.block_claim_until_target_assigned();

create or replace function public.gm_restore_player(g uuid, profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  restore_id uuid := profile_id;
  restored private.hunt_players%rowtype;
  round_status text;
  predecessor_id uuid;
  restored_target_id uuid;
  alive_count integer;
  participant uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

  select round.status into round_status
  from private.hunt_rounds round
  where round.game_id = g
  for update;

  if not found or round_status not in ('active', 'finished') then
    raise exception using errcode = '55000', message = 'hunt cannot restore players';
  end if;

  select * into restored
  from private.hunt_players player
  where player.game_id = g and player.profile_id = restore_id
  for update;

  if not found or restored.state <> 'eliminated' then
    raise exception using errcode = '22023', message = 'player is not eliminated';
  end if;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  if alive_count = 1 then
    select player.profile_id into predecessor_id
    from private.hunt_players player
    where player.game_id = g and player.state = 'alive';
    restored_target_id := predecessor_id;
  else
    select player.profile_id,
           coalesce(player.target_profile_id, player.pending_target_profile_id)
      into predecessor_id, restored_target_id
    from private.hunt_players player
    where player.game_id = g
      and player.profile_id = restored.eliminated_by
      and player.state = 'alive'
      and coalesce(
        player.target_profile_id,
        player.pending_target_profile_id
      ) is not null;

    if predecessor_id is null then
      select player.profile_id into restored_target_id
      from private.hunt_players player
      where player.game_id = g and player.state = 'alive'
      order by player.profile_id
      limit 1;

      select player.profile_id into predecessor_id
      from private.hunt_players player
      where player.game_id = g
        and player.state = 'alive'
        and player.target_profile_id = restored_target_id;
    end if;
  end if;

  if predecessor_id is null or restored_target_id is null then
    raise exception using errcode = '55000',
      message = 'target chain cannot accept the restored player';
  end if;

  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = caller
  where game_id = g and status = 'pending' and hunter_id = predecessor_id;

  update private.hunt_players
  set target_profile_id = restore_id,
      pending_target_profile_id = null
  where private.hunt_players.game_id = g
    and private.hunt_players.profile_id = predecessor_id;

  update private.hunt_players
  set state = 'alive',
      target_profile_id = restored_target_id,
      pending_target_profile_id = null,
      hidden_until = null,
      eliminated_at = null,
      eliminated_by = null
  where private.hunt_players.game_id = g
    and private.hunt_players.profile_id = restore_id;

  update private.hunt_rounds
  set status = 'active', winner_id = null, finished_at = null
  where game_id = g;

  update public.games
  set status = 'active', location_visibility = 'gm_only'
  where id = g;

  for participant in
    select player.profile_id from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g, participant, 'hunt_player_restored',
      jsonb_build_object(
        'profile_id', restore_id,
        'message', 'The GM restored a traveller and repaired the target chain.'
      )
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.gm_set_hunt_chain(g uuid, player_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  alive_count integer;
  supplied_count integer := coalesce(pg_catalog.cardinality(player_ids), 0);
  distinct_count integer;
  i integer;
  participant uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

  if not exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is not active';
  end if;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  select count(distinct supplied.profile_id)::integer into distinct_count
  from pg_catalog.unnest(player_ids) as supplied(profile_id);

  if alive_count < 2
     or supplied_count <> alive_count
     or distinct_count <> alive_count
     or exists (
       select 1 from private.hunt_players player
       where player.game_id = g
         and player.state = 'alive'
         and not (player.profile_id = any(player_ids))
     ) then
    raise exception using errcode = '22023',
      message = 'chain must contain every living player exactly once';
  end if;

  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = caller
  where game_id = g and status = 'pending';

  update private.hunt_players
  set target_profile_id = null,
      pending_target_profile_id = null
  where game_id = g and state = 'alive';

  for i in 1..alive_count loop
    update private.hunt_players
    set target_profile_id = player_ids[(i % alive_count) + 1]
    where game_id = g and profile_id = player_ids[i] and state = 'alive';
  end loop;

  for participant in
    select player.profile_id from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g, participant, 'hunt_chain_changed',
      jsonb_build_object('message', 'The GM corrected the target chain.')
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create function public.gm_assign_next_target(g uuid, hunter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  assign_hunter_id uuid := hunter_id;
  next_target_id uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

  select player.pending_target_profile_id into next_target_id
  from private.hunt_players player
  where player.game_id = g
    and player.profile_id = assign_hunter_id
    and player.state = 'alive'
  for update;

  if not found or next_target_id is null then
    raise exception using errcode = '22023',
      message = 'player is not waiting for a target assignment';
  end if;
  if not exists (
    select 1 from private.hunt_players target
    where target.game_id = g
      and target.profile_id = next_target_id
      and target.state = 'alive'
  ) then
    raise exception using errcode = '55000', message = 'suggested target is not alive';
  end if;

  update private.hunt_players
  set target_profile_id = next_target_id,
      pending_target_profile_id = null
  where game_id = g and profile_id = assign_hunter_id;

  perform private.emit_hunt_event(
    g,
    assign_hunter_id,
    'hunt_target_assigned',
    jsonb_build_object('message', 'The GM assigned your next target.')
  );

  return public.get_hunt_admin(g);
end;
$$;

create function public.send_gm_message(g uuid, message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_message text := pg_catalog.btrim(message);
  created_event public.game_events%rowtype;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not exists (
    select 1 from public.game_players player
    where player.game_id = g
      and player.profile_id = caller
      and player.role = 'player'
  ) then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  if clean_message is null or char_length(clean_message) not between 1 and 100 then
    raise exception using errcode = '22023',
      message = 'message must contain between 1 and 100 characters';
  end if;
  if exists (
    select 1 from public.game_events event
    where event.game_id = g
      and event.profile_id = caller
      and event.type = 'player_message'
      and event.created_at > now() - interval '3 seconds'
  ) then
    raise exception using errcode = '55000',
      message = 'wait a moment before sending another message';
  end if;

  insert into public.game_events (
    game_id, profile_id, type, status, player_visible, payload
  ) values (
    g,
    caller,
    'player_message',
    'confirmed',
    true,
    jsonb_build_object('message', clean_message)
  )
  returning * into created_event;

  return jsonb_build_object(
    'id', created_event.id,
    'seq', created_event.seq,
    'message', clean_message,
    'created_at', created_event.created_at
  );
end;
$$;

revoke all on function private.emit_play_area_event(public.zones, uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function private.defer_hunt_target_assignment()
  from public, anon, authenticated;
revoke all on function private.cleanup_finished_hunt_assignments()
  from public, anon, authenticated;
revoke all on function private.reject_competing_hunt_claims()
  from public, anon, authenticated;
revoke all on function private.block_claim_until_target_assigned()
  from public, anon, authenticated;

revoke all on function public.gm_assign_next_target(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.send_gm_message(uuid, text)
  from public, anon, authenticated;

grant execute on function public.gm_assign_next_target(uuid, uuid)
  to authenticated;
grant execute on function public.send_gm_message(uuid, text)
  to authenticated;

comment on function public.gm_assign_next_target(uuid, uuid) is
  'GM-only confirmation of the inherited target after a non-final elimination.';
comment on function public.send_gm_message(uuid, text) is
  'Sends a player-authored message of at most 100 characters to game GMs.';
