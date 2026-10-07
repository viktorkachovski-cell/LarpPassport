-- Bearings are computed only from server-held lighthouse and treasure points.
-- The game advisory lock serializes a reading with shard ledger changes.
create function public.compass_reading(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  treasure extensions.geography;
  secret bytea;
  balance integer;
  level smallint;
  half_width smallint;
  candidate_count integer;
  lighthouse record;
  previous record;
  hash_bytes bytea;
  unit_fraction numeric;
  true_deg double precision;
  arc_centre smallint;
  reading_time timestamptz;
  response jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.treasure_geog, pirate.hmac_secret
    into phase_name, is_paused, treasure, secret
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if treasure is null then return pg_catalog.jsonb_build_object('status', 'not_ready'); end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id and ledger.currency = 'bearing';
  if balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
  level := least(balance, 5)::smallint;
  half_width := (array[90, 45, 25, 12, 5])[level]::smallint;

  select count(*)::integer into candidate_count
  from private.pirate_current_sites(g, caller) current_site
  where current_site.kind = 'lighthouse';
  if candidate_count = 0 then return pg_catalog.jsonb_build_object('status', 'no_site'); end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select current_site.zone_id, current_site.site_name, zone.geog into lighthouse
  from private.pirate_current_sites(g, caller) current_site
  join public.zones zone on zone.id = current_site.zone_id
  where current_site.kind = 'lighthouse' limit 1;
  if not exists (select 1 from public.zones zone where zone.id = lighthouse.zone_id
                 and zone.shape = 'circle') then
    return pg_catalog.jsonb_build_object('status', 'not_ready');
  end if;

  select reading.centre_deg, reading.half_width_deg, reading.created_at into previous
  from private.pirate_readings reading
  where reading.zone_id = lighthouse.zone_id and reading.faction_id = crew_id
    and reading.shards = level and reading.voided_at is null;
  if found then
    return pg_catalog.jsonb_build_object('status', 'ok',
      'lighthouse_name', lighthouse.site_name, 'centre_deg', previous.centre_deg,
      'half_width_deg', previous.half_width_deg, 'level', level, 'taken_at', previous.created_at);
  end if;

  true_deg := pg_catalog.degrees(extensions.st_azimuth(lighthouse.geog, treasure));
  hash_bytes := extensions.hmac(
    pg_catalog.convert_to(crew_id::text || ':' || lighthouse.zone_id::text || ':' || level::text, 'UTF8'),
    secret, 'sha256');
  unit_fraction := (
    pg_catalog.get_byte(hash_bytes, 0)::numeric * 16777216
    + pg_catalog.get_byte(hash_bytes, 1)::numeric * 65536
    + pg_catalog.get_byte(hash_bytes, 2)::numeric * 256
    + pg_catalog.get_byte(hash_bytes, 3)::numeric
  ) / 4294967296.0;
  arc_centre := pg_catalog.mod(
    pg_catalog.round(true_deg + (2 * unit_fraction - 1) * 0.8 * half_width)::integer + 360,
    360)::smallint;
  insert into private.pirate_readings (
    game_id, zone_id, faction_id, shards, centre_deg, half_width_deg, taken_by
  ) values (g, lighthouse.zone_id, crew_id, level, arc_centre, half_width, caller)
  returning created_at into reading_time;
  response := pg_catalog.jsonb_build_object('status', 'ok',
    'lighthouse_name', lighthouse.site_name, 'centre_deg', arc_centre,
    'half_width_deg', half_width, 'level', level, 'taken_at', reading_time);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_reading', response);
  return response;
end;
$$;

create function public.treasure_band(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  treasure extensions.geography;
  own_point extensions.geography;
  balance integer;
  metres double precision;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('band', 'locked'); end if;
  select game.phase, pirate.paused, pirate.treasure_geog
    into phase_name, is_paused, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found or is_paused or phase_name not in ('cursed', 'hunt', 'hoard') or treasure is null then
    return pg_catalog.jsonb_build_object('band', 'locked');
  end if;
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id and ledger.currency = 'bearing';
  if balance < 3 then return pg_catalog.jsonb_build_object('band', 'locked'); end if;
  select position.geog into own_point from public.player_positions position
  where position.game_id = g and position.profile_id = caller
    and position.recorded_at >= now() - interval '120 seconds';
  if own_point is null then return pg_catalog.jsonb_build_object('band', 'stale'); end if;
  metres := extensions.st_distance(own_point, treasure);
  return pg_catalog.jsonb_build_object('band', case
    when metres <= 25 then '25' when metres <= 100 then '100' else 'far' end);
end;
$$;

revoke all on function public.compass_reading(uuid) from public, anon;
revoke all on function public.treasure_band(uuid) from public, anon;
grant execute on function public.compass_reading(uuid) to authenticated;
grant execute on function public.treasure_band(uuid) to authenticated;
