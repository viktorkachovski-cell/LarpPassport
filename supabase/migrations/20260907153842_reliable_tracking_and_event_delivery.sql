-- Keep location and hunt adjudication ordered under the existing per-game lock.
alter table private.zone_state add column last_evaluated_at timestamptz;

-- Ping ingestion and play-area boundary hardening.
--
-- ingest_pings:
--   * Invalid points (bad coordinates, out-of-window timestamps, malformed
--     values) are skipped and counted instead of rejecting the whole batch.
--     A device with a skewed clock previously poisoned its offline queue
--     forever. Structural abuse (non-array, >500 points, >256 KiB) still
--     raises.
--   * Pings are accepted while the game is 'draft' or 'active'. The
--     first-game setup flow verifies player markers before the hunt starts,
--     and reset returns the game to 'draft'; only 'finished' rejects.
--   * The rejection reason is specific ('not_member' / 'game_finished' /
--     'no_consent') so the client can react accurately.
--   * Zone evaluation is bounded to the newest 50 points recorded within the
--     last 10 minutes. A full 500-point offline dump previously risked the
--     hosted statement timeout; historical points still land in the trail and
--     still update the latest position.
--
-- evaluate_zones:
--   * A play-area breach requires the player to have actually been inside;
--     the first fix of a player who never entered no longer rejects their
--     claims or files a breach.
--   * Leaving uses exit_buffer_m hysteresis, matching event zones, so a
--     single GPS glitch across the edge no longer forfeits a claim.
--   * The play-area boundary is only evaluated while a hunt round is active.

create or replace function public.ingest_pings(
  g uuid,
  pings jsonb,
  last_seen_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  member_row record;
  reject_reason text;
  ping jsonb;
  batch_size integer;
  accepted_count integer := 0;
  rejected_count integer := 0;
  valid_pings jsonb := '[]'::jsonb;
  ping_is_valid boolean;
  inserted_ping_id bigint;
  current_lat double precision;
  current_lng double precision;
  current_position extensions.geography;
  current_accuracy real;
  current_recorded_at timestamptz;
  current_battery real;
  evaluation_cutoff timestamptz;
  near_zone boolean := false;
  event_json jsonb := '[]'::jsonb;
  latest_seq bigint := last_seen_seq;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  if jsonb_typeof(pings) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'pings must be a JSON array';
  end if;

  batch_size := jsonb_array_length(pings);
  if batch_size < 1 or batch_size > 500 then
    raise exception using errcode = '22023',
      message = 'pings must contain between 1 and 500 points';
  end if;
  if octet_length(pings::text) > 262144 then
    raise exception using errcode = '22023',
      message = 'pings payload exceeds 256 KiB';
  end if;
  if last_seen_seq is not null and last_seen_seq < 0 then
    raise exception using errcode = '22023',
      message = 'last_seen_seq cannot be negative';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || g::text, 0));

  select (gp.sharing_enabled
          and gp.location_consent_at is not null
          and (
            gp.consent_revoked_at is null
            or gp.consent_revoked_at < gp.location_consent_at
          )) as consent_ok,
         game.status as game_status
    into member_row
  from public.game_players gp
  join public.games game on game.id = gp.game_id
  where gp.game_id = g and gp.profile_id = caller;

  if not found then
    reject_reason := 'not_member';
  elsif member_row.game_status = 'finished' then
    reject_reason := 'game_finished';
  elsif exists (select 1 from private.hunt_players hp where hp.game_id = g and hp.profile_id = caller and hp.state = 'eliminated') then
    reject_reason := 'eliminated';
  elsif not member_row.consent_ok then
    reject_reason := 'no_consent';
  end if;

  if reject_reason is not null then
    return jsonb_build_object(
      'accepted', 0,
      'rejected', batch_size,
      'reason', reject_reason
    );
  end if;

  -- Per-point validation: invalid points are skipped and counted, never fatal.
  for ping in select value from jsonb_array_elements(pings) as item(value) loop
    ping_is_valid := false;

    if jsonb_typeof(ping) = 'object' then
      begin
        current_lat := (ping->>'lat')::double precision;
        current_lng := (ping->>'lng')::double precision;
        current_accuracy := nullif(ping->>'accuracy', '')::real;
        current_recorded_at := (ping->>'recorded_at')::timestamptz;
        current_battery := nullif(ping->>'battery', '')::real;

        ping_is_valid :=
          current_lat is not null
          and current_lat::text not in ('NaN', 'Infinity', '-Infinity')
          and current_lat between -90 and 90
          and current_lng is not null
          and current_lng::text not in ('NaN', 'Infinity', '-Infinity')
          and current_lng between -180 and 180
          and (
            current_accuracy is null
            or (
              current_accuracy::text not in ('NaN', 'Infinity', '-Infinity')
              and current_accuracy between 0 and 10000
            )
          )
          and (
            current_battery is null
            or (
              current_battery::text not in ('NaN', 'Infinity', '-Infinity')
              and current_battery between 0 and 100
            )
          )
          and current_recorded_at is not null
          and isfinite(current_recorded_at)
          and current_recorded_at >= now() - interval '24 hours'
          and current_recorded_at <= now() + interval '5 minutes';
      exception
        when invalid_text_representation
          or numeric_value_out_of_range
          or datetime_field_overflow then
          ping_is_valid := false;
      end;
    end if;

    if ping_is_valid then
      valid_pings := valid_pings || jsonb_build_array(ping);
    else
      rejected_count := rejected_count + 1;
    end if;
  end loop;

  select min(sampled_at) into evaluation_cutoff from (
    select distinct (value->>'recorded_at')::timestamptz as sampled_at
    from jsonb_array_elements(valid_pings) item(value)
    where (value->>'recorded_at')::timestamptz > now() - interval '10 minutes'
      and (value->>'recorded_at')::timestamptz <= now()
      and not exists (select 1 from private.location_pings lp
        where lp.game_id = g and lp.profile_id = caller
          and lp.recorded_at = (value->>'recorded_at')::timestamptz)
    order by sampled_at desc limit 50
  ) newest;
  current_battery := null;
  for ping in
    select value
    from jsonb_array_elements(valid_pings) as item(value)
    order by (value->>'recorded_at')::timestamptz asc
  loop
    current_lat := (ping->>'lat')::double precision;
    current_lng := (ping->>'lng')::double precision;
    current_position := extensions.st_setsrid(
      extensions.st_makepoint(current_lng, current_lat),
      4326
    )::extensions.geography;
    current_accuracy := nullif(ping->>'accuracy', '')::real;
    current_recorded_at := (ping->>'recorded_at')::timestamptz;
    current_battery := coalesce(
      nullif(ping->>'battery', '')::real,
      current_battery
    );
    inserted_ping_id := null;

    insert into private.location_pings (
      game_id, profile_id, geog, accuracy_m, recorded_at
    )
    values (
      g, caller, current_position, current_accuracy, current_recorded_at
    )
    on conflict (game_id, profile_id, recorded_at) do nothing
    returning id into inserted_ping_id;

    if inserted_ping_id is not null then
      accepted_count := accepted_count + 1;
      -- Only recent points are gameplay-relevant, and a full offline dump
      -- must never exceed the API statement timeout.
      if current_recorded_at >= evaluation_cutoff and current_recorded_at <= now() then
        perform private.evaluate_zones(
          g, caller, current_position, current_recorded_at
        );
      end if;
    end if;
  end loop;

  if jsonb_array_length(valid_pings) > 0 then
    insert into public.player_positions (
      game_id, profile_id, geog, accuracy_m, recorded_at, battery_pct, updated_at
    )
    values (
      g, caller, current_position, current_accuracy,
      current_recorded_at, current_battery, now()
    )
    on conflict (game_id, profile_id) do update
    set geog = excluded.geog,
        accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at,
        battery_pct = excluded.battery_pct,
        updated_at = now()
    where excluded.recorded_at >= player_positions.recorded_at;

    select exists (
      select 1
      from public.zones z
      where z.game_id = g
        and z.active
        and extensions.st_dwithin(
          current_position,
          z.geog,
          250 + coalesce(z.radius_m, 0)
        )
    ) into near_zone;
  end if;

  if last_seen_seq is not null then
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', event_row.id,
            'seq', event_row.seq,
            'type', event_row.type,
            'payload', event_row.payload,
            'created_at', event_row.created_at
          )
          order by event_row.seq
        ),
        '[]'::jsonb
      ),
      coalesce(max(event_row.seq), last_seen_seq)
    into event_json, latest_seq
    from (
      select *
      from public.game_events
      where game_id = g
        and profile_id = caller
        and player_visible
        and seq > last_seen_seq
      order by seq asc
      limit 10
    ) event_row;
  end if;

  return jsonb_build_object(
    'accepted', accepted_count,
    'rejected', rejected_count,
    'profile', jsonb_build_object(
      'mode', case when near_zone then 'near' else 'far' end,
      'interval_s', case when near_zone then 15 else 60 end,
      'accuracy', case when near_zone then 'high' else 'balanced' end
    ),
    'events', event_json,
    'latest_seq', latest_seq
  );
end;
$$;

comment on function public.ingest_pings(uuid, jsonb, bigint) is
  'Idempotently ingests up to 500 points for a consenting player in an unfinished game; invalid points are skipped and counted.';

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
  round_started_at timestamptz;

begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || p_game_id::text, 0));
  select started_at into round_started_at from private.hunt_rounds
    where game_id = p_game_id and status = 'active';
  if p_at_time > now() then return; end if;
  for zone_row in
    select * from public.zones
    where game_id = p_game_id and active
  loop
    -- The anomaly boundary only matters during a live hunt round; skipping it
    -- otherwise avoids breach noise during setup and between rounds.
    if zone_row.zone_type = 'play_area' and (round_started_at is null or p_at_time < round_started_at) then
      continue;
    end if;

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

    if state_row.last_evaluated_at is not null and p_at_time <= state_row.last_evaluated_at then continue; end if;
    update private.zone_state set last_evaluated_at = p_at_time
      where zone_id = zone_row.id and profile_id = p_user_id;

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
      elsif state_row.inside
            and not state_row.outside_active
            and not extensions.st_dwithin(
              p_position,
              zone_row.geog,
              case
                when zone_row.shape = 'circle'
                  then zone_row.radius_m + zone_row.exit_buffer_m
                else zone_row.exit_buffer_m
              end
            ) then
        update private.hunt_claims
        set status = 'rejected', responded_at = now(), response_by = p_user_id
        where game_id = p_game_id
          and hunter_id = p_user_id
          and status = 'pending'
          and requested_at <= p_at_time;

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

-- Revoking location consent previously left the player's last stored
-- position visible until the game finished and the nightly purge ran.
-- Elimination already deletes the latest position; manual revocation now
-- does the same.
create or replace function public.set_location_consent(
  g uuid,
  grant_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || g::text, 0));

  if grant_consent and exists (
    select 1 from private.hunt_players hp
    where hp.game_id = g and hp.profile_id = caller and hp.state = 'eliminated'
  ) then
    raise exception using errcode = '55000', message = 'Eliminated players cannot share until restored by a GM.';
  end if;
  if grant_consent then
    update public.game_players
    set location_consent_at = now(),
        sharing_enabled = true,
        consent_revoked_at = null
    where game_id = g and profile_id = caller;
  else
    update public.game_players
    set consent_revoked_at = now(),
        sharing_enabled = false
    where game_id = g and profile_id = caller;
  end if;

  if not found then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;

  if not grant_consent then
    delete from public.player_positions
    where game_id = g and profile_id = caller;
  end if;

  insert into public.game_events (
    game_id, profile_id, type, status, player_visible
  )
  values (
    g,
    caller,
    case when grant_consent then 'consent_granted' else 'consent_revoked' end,
    'confirmed',
    false
  );
end;
$$;

comment on function public.set_location_consent(uuid, boolean) is
  'Records explicit location consent or revocation; revocation also deletes the latest stored position.';

create or replace function public.start_hunt(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  participants uuid[];
  participant_count integer;
  character_count integer;
  i integer;
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

  if exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is already active';
  end if;

  select count(*)::integer,
         array_agg(player.profile_id order by pg_catalog.random())
    into participant_count, participants
  from public.game_players player
  where player.game_id = g and player.role = 'player';

  if participant_count < 2 then
    raise exception using errcode = '22023',
      message = 'at least two players are required';
  end if;

  select count(distinct character.user_id)::integer into character_count
  from public.characters character
  where character.game_id = g
    and not character.is_npc
    and character.user_id = any(participants);

  if character_count <> participant_count then
    raise exception using errcode = '22023',
      message = 'every player needs a character before the hunt starts';
  end if;

  delete from private.zone_state zs using public.zones z
    where zs.zone_id = z.id and z.game_id = g and z.zone_type = 'play_area';
  delete from private.hunt_claims where game_id = g;
  delete from private.hunt_players where game_id = g;
  delete from private.hunt_rounds where game_id = g;

  insert into private.hunt_rounds (game_id, status, started_by)
  values (g, 'active', caller);

  for i in 1..participant_count loop
    insert into private.hunt_players (
      game_id, profile_id, target_profile_id
    ) values (
      g,
      participants[i],
      participants[(i % participant_count) + 1]
    );
  end loop;

  update public.games
  set status = 'active', location_visibility = 'gm_only'
  where id = g;

  for i in 1..participant_count loop
    perform private.emit_hunt_event(
      g,
      participants[i],
      'hunt_started',
      jsonb_build_object('message', 'The hunt has begun. Your target is ready.')
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.reset_hunt(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
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

  delete from private.zone_state zs using public.zones z
    where zs.zone_id = z.id and z.game_id = g and z.zone_type = 'play_area';
  delete from private.hunt_claims where game_id = g;
  delete from private.hunt_players where game_id = g;
  delete from private.hunt_rounds where game_id = g;

  update public.games set status = 'draft' where id = g;

  return jsonb_build_object('phase', 'not_started');
end;
$$;

create or replace function private.protect_active_hunt_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_game uuid := coalesce(new.game_id, old.game_id);
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || affected_game::text, 0)) then
    raise exception using errcode = '40001', message = 'Game is changing; retry this action.';
  end if;
  if not exists (
    select 1
    from private.hunt_rounds round
    where round.game_id = affected_game and round.status = 'active'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception using errcode = '55000',
      message = 'players cannot join while the hunt is active';
  elsif tg_op = 'DELETE' and old.role = 'player' then
    raise exception using errcode = '55000',
      message = 'participants cannot leave while the hunt is active';
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception using errcode = '55000',
      message = 'participant roles cannot change while the hunt is active';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.protect_active_hunt_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || new.id::text, 0)) then
    raise exception using errcode = '40001', message = 'Game is changing; retry this action.';
  end if;
  if exists (
    select 1
    from private.hunt_rounds round
    where round.game_id = new.id and round.status = 'active'
  ) and (
    new.status <> 'active'
    or new.location_visibility <> 'gm_only'
  ) then
    raise exception using errcode = '55000',
      message = 'an active hunt must remain active and GM-only';
  end if;
  return new;
end;
$$;

create function private.lock_character_game() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || coalesce(new.game_id, old.game_id)::text, 0)) then
    raise exception using errcode = '40001', message = 'Game is changing; retry this action.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.lock_character_game() from public, anon, authenticated;
create trigger characters_lock_game before insert or update or delete on public.characters
  for each row execute function private.lock_character_game();

-- Delivery order is separate from the immutable timeline sequence. A GM making
-- an old event visible assigns a fresh delivery number without rewriting history.
create sequence private.event_delivery_seq;
alter table public.game_events add column delivery_seq bigint;
update public.game_events set delivery_seq = seq;
select pg_catalog.setval('private.event_delivery_seq', greatest(coalesce((select max(seq) from public.game_events), 0) + 1, 1), false);
alter table public.game_events alter column delivery_seq set not null;
create index game_events_delivery_idx on public.game_events(game_id, profile_id, delivery_seq) where player_visible;
create function private.order_event_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize allocation through commit, so a cursor cannot skip an uncommitted event.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delivery:' || new.game_id::text, 0));
  if tg_op = 'INSERT' then
    new.delivery_seq := pg_catalog.nextval('private.event_delivery_seq');
  elsif new.player_visible and not old.player_visible then
    new.delivery_seq := pg_catalog.nextval('private.event_delivery_seq');
  else
    new.delivery_seq := old.delivery_seq;
  end if;
  return new;
end;
$$;
revoke all on sequence private.event_delivery_seq from public, anon, authenticated;
revoke all on function private.order_event_delivery() from public, anon, authenticated;
create trigger game_events_order_delivery before insert or update on public.game_events
  for each row execute function private.order_event_delivery();

create function public.get_player_event_delivery(g uuid, after_seq bigint default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if not exists (select 1 from public.game_players where game_id = g and profile_id = auth.uid()) then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('delivery:' || g::text, 0));
  select coalesce(jsonb_agg(to_jsonb(e) order by e.delivery_seq), '[]'::jsonb) into result
  from (select id, seq, delivery_seq, type, payload, created_at from public.game_events
    where game_id = g and profile_id = auth.uid() and player_visible
      and delivery_seq > greatest(coalesce(after_seq, 0), 0)
    order by delivery_seq limit 100) e;
  return result;
end;
$$;
revoke all on function public.get_player_event_delivery(uuid,bigint) from public, anon, authenticated;
grant execute on function public.get_player_event_delivery(uuid,bigint) to authenticated;

create or replace function private.emit_play_area_event(
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
      'You left the time anomaly. Claims active at the recorded exit may have been forfeited; contact the GM for a ruling.'
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
