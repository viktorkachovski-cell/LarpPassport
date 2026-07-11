-- RLS helpers live outside exposed schemas to avoid recursive policy lookups.
create function private.is_game_member(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.profile_id = p_user_id
  );
$$;

create function private.is_game_gm(p_game_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.profile_id = p_user_id
      and gp.role = 'gm'
  );
$$;

create function private.same_faction(
  p_game_id uuid,
  p_user_id uuid,
  p_other_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and exists (
    select 1
    from public.characters mine
    join public.characters other
      on other.game_id = mine.game_id
     and other.faction_id = mine.faction_id
    where mine.game_id = p_game_id
      and mine.user_id = p_user_id
      and other.user_id = p_other_profile_id
      and not mine.is_npc
      and not other.is_npc
      and mine.faction_id is not null
  );
$$;

revoke all on function private.is_game_member(uuid, uuid) from public, anon;
revoke all on function private.is_game_gm(uuid, uuid) from public, anon;
revoke all on function private.same_faction(uuid, uuid, uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_game_member(uuid, uuid) to authenticated;
grant execute on function private.is_game_gm(uuid, uuid) to authenticated;
grant execute on function private.same_faction(uuid, uuid, uuid) to authenticated;

-- Authentication and audit trigger functions.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  fallback_username text := 'user_' || substr(new.id::text, 1, 8);
begin
  requested_username := nullif(trim(new.raw_user_meta_data->>'username'), '');

  begin
    insert into public.profiles (id, username)
    values (new.id, coalesce(requested_username, fallback_username));
  exception
    when unique_violation or check_violation then
      insert into public.profiles (id, username)
      values (new.id, fallback_username)
      on conflict (id) do nothing;
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill profiles for users that existed before this baseline was installed.
insert into public.profiles (id, username)
select u.id, 'user_' || substr(u.id::text, 1, 8)
from auth.users u
on conflict (id) do nothing;

create function private.add_creator_as_gm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_players (game_id, profile_id, role)
  values (new.id, new.gm_id, 'gm')
  on conflict (game_id, profile_id) do update set role = 'gm';
  return new;
end;
$$;

create trigger games_add_creator
  after insert on public.games
  for each row execute function private.add_creator_as_gm();

create function private.protect_game_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.gm_id is distinct from old.gm_id then
    raise exception using errcode = '42501', message = 'the game owner cannot be reassigned';
  end if;
  return new;
end;
$$;

create trigger games_protect_owner
  before update on public.games
  for each row execute function private.protect_game_owner();

create function private.validate_character_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_stats jsonb;
  stat jsonb;
  stat_definition jsonb;
  field_key text;
  caller uuid := auth.uid();
  caller_is_gm boolean;
  previous_fields jsonb := '{}'::jsonb;
begin
  select coalesce(g.template->'stats', '[]'::jsonb)
    into template_stats
  from public.games g
  where g.id = new.game_id;

  template_stats := coalesce(template_stats, '[]'::jsonb);
  caller_is_gm := caller is null or private.is_game_gm(new.game_id, caller);
  new.fields := coalesce(new.fields, '{}'::jsonb);

  if new.faction_id is not null and not exists (
    select 1 from public.factions f
    where f.id = new.faction_id and f.game_id = new.game_id
  ) then
    raise exception using errcode = '23514', message = 'faction must belong to the character game';
  end if;

  for stat in select value from jsonb_array_elements(template_stats) loop
    field_key := stat->>'key';
    if field_key is not null and not (new.fields ? field_key) and stat ? 'default' then
      new.fields := jsonb_set(new.fields, array[field_key], stat->'default');
    end if;
  end loop;

  if tg_op = 'UPDATE' then
    previous_fields := coalesce(old.fields, '{}'::jsonb);
    if not caller_is_gm and (
      new.user_id is distinct from old.user_id
      or new.game_id is distinct from old.game_id
      or new.is_npc is distinct from old.is_npc
      or new.faction_id is distinct from old.faction_id
    ) then
      raise exception using errcode = '42501',
        message = 'only a GM can change ownership, game, faction or NPC status';
    end if;
  end if;

  for field_key in select jsonb_object_keys(new.fields) loop
    select value into stat_definition
    from jsonb_array_elements(template_stats)
    where value->>'key' = field_key;

    if stat_definition is null then
      raise exception 'field "%" is not in the game template', field_key;
    end if;

    case stat_definition->>'type'
      when 'number' then
        if jsonb_typeof(new.fields->field_key) <> 'number' then
          raise exception 'field "%" must be a number', field_key;
        end if;
        if stat_definition ? 'min'
           and (new.fields->>field_key)::numeric < (stat_definition->>'min')::numeric then
          raise exception 'field "%" is below its minimum', field_key;
        end if;
        if stat_definition ? 'max'
           and (new.fields->>field_key)::numeric > (stat_definition->>'max')::numeric then
          raise exception 'field "%" is above its maximum', field_key;
        end if;
      when 'text' then
        if jsonb_typeof(new.fields->field_key) <> 'string'
           or char_length(new.fields->>field_key) > 4000 then
          raise exception 'field "%" must be text no longer than 4000 characters', field_key;
        end if;
      when 'boolean' then
        if jsonb_typeof(new.fields->field_key) <> 'boolean' then
          raise exception 'field "%" must be a boolean', field_key;
        end if;
      else
        raise exception 'field "%" has an unsupported type', field_key;
    end case;
  end loop;

  if not caller_is_gm then
    for field_key in
      select jsonb_object_keys(new.fields)
      union
      select jsonb_object_keys(previous_fields)
    loop
      if tg_op = 'INSERT'
         or coalesce(previous_fields->field_key, 'null'::jsonb)
            is distinct from coalesce(new.fields->field_key, 'null'::jsonb) then
        select value into stat_definition
        from jsonb_array_elements(template_stats)
        where value->>'key' = field_key;

        if not coalesce((stat_definition->>'player_editable')::boolean, false)
           and coalesce(new.fields->field_key, 'null'::jsonb)
               is distinct from coalesce(stat_definition->'default', 'null'::jsonb) then
          raise exception 'field "%" is not player-editable', field_key;
        end if;
      end if;
    end loop;
  end if;

  return new;
end;
$$;

create trigger characters_validate
  before insert or update on public.characters
  for each row execute function private.validate_character_write();

create function private.audit_character_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.fields is distinct from new.fields or old.name is distinct from new.name then
    insert into public.character_changes (
      character_id, game_id, changed_by, old_fields, new_fields, old_name, new_name
    )
    values (
      new.id, new.game_id, auth.uid(), old.fields, new.fields, old.name, new.name
    );
  end if;
  return null;
end;
$$;

create trigger characters_audit
  after update on public.characters
  for each row execute function private.audit_character_change();

create function private.rearm_zone_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.trigger_mode is distinct from old.trigger_mode
     or new.dwell_seconds is distinct from old.dwell_seconds
     or new.exit_buffer_m is distinct from old.exit_buffer_m
     or new.one_shot is distinct from old.one_shot
     or new.radius_m is distinct from old.radius_m
     or new.geog::text is distinct from old.geog::text
     or new.active is distinct from old.active then
    delete from private.zone_state where zone_id = new.id;
  end if;
  return null;
end;
$$;

create trigger zones_rearm_on_change
  after update on public.zones
  for each row execute function private.rearm_zone_on_change();

-- Zone evaluation remains internal and is called only by the ingest RPC.
create function private.emit_zone_event(
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
  character_id uuid;
  event_status text;
  visible_to_player boolean;
begin
  select c.id into character_id
  from public.characters c
  where c.game_id = p_zone.game_id
    and c.user_id = p_user_id
    and not c.is_npc
  limit 1;

  event_status := case
    when p_event_type = 'zone_enter' and p_zone.trigger_mode = 'gm_confirm'
      then 'pending'
    else 'confirmed'
  end;
  visible_to_player := (
    p_event_type = 'zone_enter' and p_zone.trigger_mode = 'auto'
  );

  insert into public.game_events (
    game_id, profile_id, character_id, zone_id, type, status,
    player_visible, payload, created_at
  )
  values (
    p_zone.game_id, p_user_id, character_id, p_zone.id, p_event_type,
    event_status, visible_to_player, p_zone.payload, p_at_time
  );
end;
$$;

create function private.evaluate_zones(
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
             + make_interval(secs => zone_row.dwell_seconds) then
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

-- Public RPCs.
create function public.join_game(code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.games%rowtype;
  recent_failures integer;
  normalized_code text := upper(trim(coalesce(code, '')));
  caller uuid := auth.uid();
begin
  if caller is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated.');
  end if;

  select count(*) into recent_failures
  from private.join_attempts ja
  where ja.profile_id = caller
    and not ja.success
    and ja.attempted_at > now() - interval '15 minutes';

  if recent_failures >= 8 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Too many join attempts. Wait 15 minutes and try again.'
    );
  end if;

  if normalized_code !~ '^[0-9A-F]{8}$' then
    insert into private.join_attempts (profile_id, code, success)
    values (caller, left(normalized_code, 16), false);
    return jsonb_build_object('ok', false, 'error', 'Invalid game code.');
  end if;

  select * into game_row
  from public.games g
  where g.join_code = normalized_code and g.status <> 'finished';

  if not found then
    insert into private.join_attempts (profile_id, code, success)
    values (caller, normalized_code, false);
    return jsonb_build_object(
      'ok', false,
      'error', 'Invalid or finished game code.'
    );
  end if;

  insert into private.join_attempts (profile_id, code, success)
  values (caller, normalized_code, true);

  insert into public.game_players (game_id, profile_id)
  values (game_row.id, caller)
  on conflict (game_id, profile_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'joined_game_id', game_row.id,
    'joined_game_name', game_row.name,
    'game_template', game_row.template
  );
end;
$$;

create function public.set_location_consent(
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

create function public.ingest_pings(
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
  consent_is_active boolean;
  ping jsonb;
  ping_index integer := 0;
  batch_size integer;
  accepted_count integer := 0;
  inserted_ping_id bigint;
  current_lat double precision;
  current_lng double precision;
  current_position extensions.geography;
  current_accuracy real;
  current_recorded_at timestamptz;
  current_battery real;
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

  select gp.sharing_enabled
         and gp.location_consent_at is not null
         and (
           gp.consent_revoked_at is null
           or gp.consent_revoked_at < gp.location_consent_at
         )
         and game.status = 'active'
    into consent_is_active
  from public.game_players gp
  join public.games game on game.id = gp.game_id
  where gp.game_id = g and gp.profile_id = caller;

  if not coalesce(consent_is_active, false) then
    return jsonb_build_object(
      'accepted', 0,
      'reason', 'no_active_consent_or_game'
    );
  end if;

  -- Validate the whole batch before any insert.
  for ping in select value from jsonb_array_elements(pings) as item(value) loop
    ping_index := ping_index + 1;
    if jsonb_typeof(ping) is distinct from 'object' then
      raise exception using errcode = '22023',
        message = format('ping %s must be an object', ping_index);
    end if;

    begin
      current_lat := (ping->>'lat')::double precision;
      current_lng := (ping->>'lng')::double precision;
      current_accuracy := nullif(ping->>'accuracy', '')::real;
      current_recorded_at := (ping->>'recorded_at')::timestamptz;
      current_battery := nullif(ping->>'battery', '')::real;
    exception
      when invalid_text_representation
        or numeric_value_out_of_range
        or datetime_field_overflow then
        raise exception using errcode = '22023',
          message = format('ping %s contains an invalid value', ping_index);
    end;

    if current_lat is null
       or current_lat::text in ('NaN', 'Infinity', '-Infinity')
       or current_lat < -90 or current_lat > 90 then
      raise exception using errcode = '22023',
        message = format('ping %s latitude is out of range', ping_index);
    end if;
    if current_lng is null
       or current_lng::text in ('NaN', 'Infinity', '-Infinity')
       or current_lng < -180 or current_lng > 180 then
      raise exception using errcode = '22023',
        message = format('ping %s longitude is out of range', ping_index);
    end if;
    if current_accuracy is not null and (
      current_accuracy::text in ('NaN', 'Infinity', '-Infinity')
      or current_accuracy < 0 or current_accuracy > 10000
    ) then
      raise exception using errcode = '22023',
        message = format('ping %s accuracy is out of range', ping_index);
    end if;
    if current_battery is not null and (
      current_battery::text in ('NaN', 'Infinity', '-Infinity')
      or current_battery < 0 or current_battery > 100
    ) then
      raise exception using errcode = '22023',
        message = format('ping %s battery is out of range', ping_index);
    end if;
    if current_recorded_at is null
       or not isfinite(current_recorded_at)
       or current_recorded_at < now() - interval '24 hours'
       or current_recorded_at > now() + interval '5 minutes' then
      raise exception using errcode = '22023',
        message = format('ping %s timestamp is outside the accepted window', ping_index);
    end if;
  end loop;

  current_battery := null;
  for ping in
    select value
    from jsonb_array_elements(pings) as item(value)
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
      perform private.evaluate_zones(
        g, caller, current_position, current_recorded_at
      );
      accepted_count := accepted_count + 1;
    end if;
  end loop;

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
  'Validates and idempotently ingests up to 500 points for a consenting player.';

-- Security-invoker views preserve base-table RLS.
create view public.zones_view
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
  extensions.st_asgeojson(z.geog)::json as geojson
from public.zones z;

create view public.player_positions_view
with (security_invoker = true)
as
select
  pp.game_id,
  pp.profile_id,
  profile.username,
  extensions.st_y(pp.geog::extensions.geometry) as lat,
  extensions.st_x(pp.geog::extensions.geometry) as lng,
  pp.accuracy_m,
  pp.battery_pct,
  pp.recorded_at,
  pp.updated_at
from public.player_positions pp
join public.profiles profile on profile.id = pp.profile_id;

-- Consolidated RLS policies.
create policy profiles_select_authenticated
  on public.profiles for select to authenticated
  using (true);
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy games_select_member
  on public.games for select to authenticated
  using (
    gm_id = (select auth.uid())
    or private.is_game_member(id, (select auth.uid()))
  );
create policy games_insert_owner
  on public.games for insert to authenticated
  with check (gm_id = (select auth.uid()));
create policy games_update_gm
  on public.games for update to authenticated
  using (private.is_game_gm(id, (select auth.uid())))
  with check (private.is_game_gm(id, (select auth.uid())));
create policy games_delete_owner
  on public.games for delete to authenticated
  using (gm_id = (select auth.uid()));

create policy game_players_select_member
  on public.game_players for select to authenticated
  using (private.is_game_member(game_id, (select auth.uid())));
create policy game_players_insert_gm
  on public.game_players for insert to authenticated
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy game_players_update_gm
  on public.game_players for update to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())))
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy game_players_delete_gm_or_self
  on public.game_players for delete to authenticated
  using (
    private.is_game_gm(game_id, (select auth.uid()))
    or profile_id = (select auth.uid())
  );

create policy factions_select_member
  on public.factions for select to authenticated
  using (private.is_game_member(game_id, (select auth.uid())));
create policy factions_insert_gm
  on public.factions for insert to authenticated
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy factions_update_gm
  on public.factions for update to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())))
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy factions_delete_gm
  on public.factions for delete to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())));

create policy characters_select_own_or_gm
  on public.characters for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_game_gm(game_id, (select auth.uid()))
  );
create policy characters_insert_own_or_gm
  on public.characters for insert to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and not is_npc
      and private.is_game_member(game_id, (select auth.uid()))
    )
    or private.is_game_gm(game_id, (select auth.uid()))
  );
create policy characters_update_own_or_gm
  on public.characters for update to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_game_gm(game_id, (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or private.is_game_gm(game_id, (select auth.uid()))
  );
create policy characters_delete_own_or_gm
  on public.characters for delete to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_game_gm(game_id, (select auth.uid()))
  );

create policy zones_gm_select
  on public.zones for select to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())));
create policy zones_gm_insert
  on public.zones for insert to authenticated
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy zones_gm_update
  on public.zones for update to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())))
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy zones_gm_delete
  on public.zones for delete to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())));

create policy positions_select
  on public.player_positions for select to authenticated
  using (
    private.is_game_gm(game_id, (select auth.uid()))
    or profile_id = (select auth.uid())
    or exists (
      select 1
      from public.games game
      where game.id = player_positions.game_id
        and (
          (
            game.location_visibility = 'all'
            and private.is_game_member(game.id, (select auth.uid()))
          )
          or (
            game.location_visibility = 'faction'
            and private.same_faction(
              game.id,
              (select auth.uid()),
              player_positions.profile_id
            )
          )
        )
    )
  );

create policy events_select
  on public.game_events for select to authenticated
  using (
    private.is_game_gm(game_id, (select auth.uid()))
    or (
      profile_id = (select auth.uid())
      and player_visible
    )
  );
create policy events_insert_gm
  on public.game_events for insert to authenticated
  with check (private.is_game_gm(game_id, (select auth.uid())));
create policy events_update_gm
  on public.game_events for update to authenticated
  using (private.is_game_gm(game_id, (select auth.uid())))
  with check (private.is_game_gm(game_id, (select auth.uid())));

create policy push_tokens_own
  on public.push_tokens for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

create policy character_changes_select
  on public.character_changes for select to authenticated
  using (
    private.is_game_gm(game_id, (select auth.uid()))
    or exists (
      select 1
      from public.characters character
      where character.id = character_changes.character_id
        and character.user_id = (select auth.uid())
    )
  );

-- Explicit least-privilege Data API grants.
revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;
revoke all privileges on all functions in schema public from public, anon, authenticated;
revoke all privileges on all tables in schema private from public, anon, authenticated;
revoke all privileges on all sequences in schema private from public, anon, authenticated;
revoke all privileges on all functions in schema private from public, anon, authenticated;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;

grant select on public.profiles, public.games, public.game_players,
  public.factions, public.characters, public.zones, public.player_positions,
  public.game_events, public.push_tokens, public.character_changes
to authenticated;

grant update on public.profiles to authenticated;
grant insert, update, delete on public.games, public.game_players,
  public.factions, public.characters, public.zones
to authenticated;
grant insert, update on public.game_events to authenticated;
grant insert, update, delete on public.push_tokens to authenticated;
grant select on public.zones_view, public.player_positions_view to authenticated;
grant usage on sequence public.game_events_seq_seq to authenticated;

grant execute on function private.is_game_member(uuid, uuid) to authenticated;
grant execute on function private.is_game_gm(uuid, uuid) to authenticated;
grant execute on function private.same_faction(uuid, uuid, uuid) to authenticated;
grant execute on function public.join_game(text) to authenticated;
grant execute on function public.set_location_consent(uuid, boolean) to authenticated;
grant execute on function public.ingest_pings(uuid, jsonb, bigint) to authenticated;

comment on function public.join_game(text) is
  'Rate-limited game join endpoint for authenticated users.';
comment on function public.set_location_consent(uuid, boolean) is
  'Records explicit location consent or revocation for the authenticated member.';
