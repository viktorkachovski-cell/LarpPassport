-- First GM-only Pirate setup operations. No player-facing Pirate RPC is
-- exposed until its state transition and denial tests have been added.
create function private.pirate_normalize_answer(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(value)), '[^a-z0-9]+', '', 'g');
$$;
revoke all on function private.pirate_normalize_answer(text) from public, anon, authenticated;

create function public.pirate_enable(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game_status text;
  current_phase text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select status, phase into game_status, current_phase from public.games where id = g;
  if game_status is null then
    raise exception using errcode = '22023', message = 'game not found';
  end if;
  if exists (select 1 from private.pirate_games where game_id = g) then
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', current_phase);
  end if;
  if game_status <> 'draft' or current_phase is not null then
    raise exception using errcode = '55000', message = 'only a draft ordinary game can enable Pirate mode';
  end if;
  insert into private.pirate_games (game_id) values (g);
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', 'setup');
end;
$$;

create function public.pirate_set_site(
  g uuid, zone_id uuid, kind text, reward text,
  oath_index smallint, oath_word text, prompt text, answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  zone_record record;
  previous_hash text;
  normalized text;
  new_hash text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or zone_id is null or kind is null then
    raise exception using errcode = '22023', message = 'game, zone and kind are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if not exists (select 1 from private.pirate_games where game_id = g) then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  if (select phase from public.games where id = g) <> 'setup' then
    raise exception using errcode = '55000', message = 'Pirate site setup is closed';
  end if;
  select z.shape, z.trigger_mode, z.zone_type, z.active into zone_record
  from public.zones z where z.id = zone_id and z.game_id = g;
  if not found then
    raise exception using errcode = '22023', message = 'zone is not in this game';
  end if;
  if zone_record.zone_type <> 'event' or not zone_record.active then
    raise exception using errcode = '22023', message = 'Pirate site needs an active event zone';
  end if;
  if kind not in ('riddle', 'cache', 'lighthouse', 'harbour', 'treasure') then
    raise exception using errcode = '22023', message = 'invalid Pirate site kind';
  end if;
  if kind = 'lighthouse' and zone_record.shape <> 'circle' then
    raise exception using errcode = '22023', message = 'lighthouse must be a circle';
  end if;
  if kind in ('riddle', 'cache', 'lighthouse') and zone_record.trigger_mode <> 'silent' then
    raise exception using errcode = '22023', message = 'this Pirate site needs a silent zone';
  end if;
  if kind = 'treasure' and zone_record.trigger_mode <> 'gm_confirm' then
    raise exception using errcode = '22023', message = 'treasure zone needs GM confirmation';
  end if;
  if kind = 'riddle' then
    if reward is null or reward not in ('bearing', 'oath') then
      raise exception using errcode = '22023', message = 'riddle reward must be bearing or oath';
    end if;
    if reward = 'oath' and (oath_index is null or oath_word is null or pg_catalog.btrim(oath_word) = '') then
      raise exception using errcode = '22023', message = 'oath index and word are required';
    end if;
    if reward = 'bearing' and (oath_index is not null or oath_word is not null) then
      raise exception using errcode = '22023', message = 'bearing riddles cannot contain oath words';
    end if;
  elsif reward is not null or oath_index is not null or oath_word is not null then
    raise exception using errcode = '22023', message = 'only riddles have a reward or oath word';
  end if;
  if kind in ('riddle', 'cache') and (prompt is null or pg_catalog.btrim(prompt) = '') then
    raise exception using errcode = '22023', message = 'riddle or cache prompt is required';
  end if;
  if kind not in ('riddle', 'cache') and answer is not null then
    raise exception using errcode = '22023', message = 'this site has no answer';
  end if;

  select s.answer_hash into previous_hash from private.pirate_sites s where s.zone_id = pirate_set_site.zone_id;
  if answer is not null then
    if pg_catalog.char_length(answer) > 100 then
      raise exception using errcode = '22023', message = 'answer is too long';
    end if;
    normalized := private.pirate_normalize_answer(answer);
    if normalized = '' then
      raise exception using errcode = '22023', message = 'answer must contain English letters or digits';
    end if;
    new_hash := pg_catalog.encode(extensions.digest(normalized || ':' || zone_id::text, 'sha256'), 'hex');
  elsif kind in ('riddle', 'cache') then
    new_hash := previous_hash;
  end if;
  if kind in ('riddle', 'cache') and new_hash is null then
    raise exception using errcode = '22023', message = 'answer is required for this site';
  end if;

  insert into private.pirate_sites (
    zone_id, game_id, kind, reward, oath_index, oath_word, prompt, answer_hash
  ) values (
    zone_id, g, kind, reward, oath_index, oath_word, prompt, new_hash
  ) on conflict (zone_id) do update set
    kind = excluded.kind,
    reward = excluded.reward,
    oath_index = excluded.oath_index,
    oath_word = excluded.oath_word,
    prompt = excluded.prompt,
    answer_hash = excluded.answer_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'zone_id', zone_id, 'answer_set', new_hash is not null);
end;
$$;

create function public.pirate_clear_site(g uuid, zone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or zone_id is null then
    raise exception using errcode = '22023', message = 'game and zone are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if (select phase from public.games where id = g) <> 'setup' then
    raise exception using errcode = '55000', message = 'Pirate site setup is closed';
  end if;
  if exists (select 1 from private.pirate_claims where game_id = g and pirate_claims.zone_id = pirate_clear_site.zone_id)
     or exists (select 1 from private.pirate_attempts where game_id = g and pirate_attempts.zone_id = pirate_clear_site.zone_id)
     or exists (select 1 from private.pirate_readings where game_id = g and pirate_readings.zone_id = pirate_clear_site.zone_id) then
    return pg_catalog.jsonb_build_object('status', 'history_exists');
  end if;
  delete from private.pirate_sites where game_id = g and pirate_sites.zone_id = pirate_clear_site.zone_id;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'not_found' end);
end;
$$;

create function public.pirate_set_treasure(g uuid, lat double precision, lng double precision, value integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or lat is null or lng is null or value is null
     or lat < -90 or lat > 90 or lng < -180 or lng > 180
     or value < 0 or value > 1000 then
    raise exception using errcode = '22023', message = 'invalid treasure point or value';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if (select phase from public.games where id = g) not in ('setup', 'charting')
     or exists (select 1 from private.pirate_readings where game_id = g) then
    raise exception using errcode = '55000', message = 'treasure point is locked';
  end if;
  update private.pirate_games
  set treasure_geog = extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      treasure_value = value, updated_at = now()
  where game_id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$$;

create function public.pirate_validate(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  issues text[] := array[]::text[];
  crew_count integer;
  missing_crew_count integer;
  wrong_size_count integer;
  bearing_count integer;
  oath_count integer;
  cache_count integer;
  lighthouse_count integer;
  harbour_count integer;
  treasure_count integer;
  missing_answers integer;
  overlap_count integer;
  bad_lighthouse_count integer;
  treasure_point extensions.geography(Point, 4326);
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  select treasure_geog into treasure_point from private.pirate_games where game_id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;

  select count(*)::integer into crew_count from public.factions where game_id = g;
  if crew_count <> 4 then
    issues := pg_catalog.array_append(issues, 'Exactly four crews are required');
  end if;
  select count(*)::integer into missing_crew_count
  from public.game_players gp
  left join public.characters c on c.game_id = gp.game_id and c.user_id = gp.profile_id and not c.is_npc
  left join public.factions f on f.id = c.faction_id and f.game_id = g
  where gp.game_id = g and gp.role = 'player' and (c.id is null or f.id is null);
  if missing_crew_count > 0 then
    issues := pg_catalog.array_append(issues, 'Every player needs a character in a crew');
  end if;
  select count(*)::integer into wrong_size_count from (
    select f.id from public.factions f
    left join public.characters c on c.faction_id = f.id and c.game_id = g and not c.is_npc
    left join public.game_players gp on gp.game_id = g and gp.profile_id = c.user_id and gp.role = 'player'
    where f.game_id = g
    group by f.id having count(gp.profile_id) not between 3 and 4
  ) wrong_sizes;
  if wrong_size_count > 0 then
    issues := pg_catalog.array_append(issues, 'Each crew needs three or four players');
  end if;

  select count(*) filter (where s.kind = 'riddle' and s.reward = 'bearing'),
         count(*) filter (where s.kind = 'riddle' and s.reward = 'oath'),
         count(*) filter (where s.kind = 'cache'),
         count(*) filter (where s.kind = 'lighthouse'),
         count(*) filter (where s.kind = 'harbour'),
         count(*) filter (where s.kind = 'treasure'),
         count(*) filter (where s.kind in ('riddle', 'cache') and s.answer_hash is null)
    into bearing_count, oath_count, cache_count, lighthouse_count,
         harbour_count, treasure_count, missing_answers
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.active
  where s.game_id = g;
  if bearing_count <> 7 then issues := pg_catalog.array_append(issues, 'Seven bearing riddles are required'); end if;
  if oath_count <> 4 then issues := pg_catalog.array_append(issues, 'Four oath riddles are required'); end if;
  if cache_count <> 8 then issues := pg_catalog.array_append(issues, 'Eight caches are required'); end if;
  if lighthouse_count <> 6 then issues := pg_catalog.array_append(issues, 'Six lighthouses are required'); end if;
  if harbour_count <> 3 then issues := pg_catalog.array_append(issues, 'Three Safe Harbours are required'); end if;
  if treasure_count <> 1 or treasure_point is null then
    issues := pg_catalog.array_append(issues, 'A treasure zone and secret point are required');
  end if;
  if missing_answers > 0 then
    issues := pg_catalog.array_append(issues, 'Every riddle and cache needs an answer');
  end if;
  if oath_count = 4 and (
    select count(distinct s.oath_index) from private.pirate_sites s
    join public.zones z on z.id = s.zone_id and z.active
    where s.game_id = g and s.reward = 'oath'
  ) <> 4 then
    issues := pg_catalog.array_append(issues, 'Oath words must cover indexes one to four');
  end if;
  select count(*)::integer into overlap_count
  from private.pirate_sites a
  join private.pirate_sites b on b.game_id = a.game_id and b.zone_id > a.zone_id
  join public.zones za on za.id = a.zone_id and za.active
  join public.zones zb on zb.id = b.zone_id and zb.active
  where a.game_id = g and extensions.st_dwithin(
    za.geog, zb.geog, pg_catalog.coalesce(za.radius_m, 0) + pg_catalog.coalesce(zb.radius_m, 0)
  );
  if overlap_count > 0 then
    issues := pg_catalog.array_append(issues, 'Pirate site zones overlap');
  end if;
  if treasure_point is not null then
    select count(*)::integer into bad_lighthouse_count
    from private.pirate_sites s join public.zones z on z.id = s.zone_id
    where s.game_id = g and s.kind = 'lighthouse'
      and (z.shape <> 'circle' or extensions.st_distance(z.geog, treasure_point) not between 200 and 1500);
    if bad_lighthouse_count > 0 then
      issues := pg_catalog.array_append(issues, 'Lighthouses must be circles 200 to 1500 metres from treasure');
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'ready', pg_catalog.cardinality(issues) = 0,
    'issues', pg_catalog.to_jsonb(issues),
    'counts', pg_catalog.jsonb_build_object(
      'crews', crew_count, 'bearing_riddles', bearing_count, 'oath_riddles', oath_count,
      'caches', cache_count, 'lighthouses', lighthouse_count,
      'harbours', harbour_count, 'treasure_sites', treasure_count
    )
  );
end;
$$;

revoke all on function public.pirate_enable(uuid) from public, anon;
revoke all on function public.pirate_set_site(uuid, uuid, text, text, smallint, text, text, text) from public, anon;
revoke all on function public.pirate_clear_site(uuid, uuid) from public, anon;
revoke all on function public.pirate_set_treasure(uuid, double precision, double precision, integer) from public, anon;
revoke all on function public.pirate_validate(uuid) from public, anon;
grant execute on function public.pirate_enable(uuid) to authenticated;
grant execute on function public.pirate_set_site(uuid, uuid, text, text, smallint, text, text, text) to authenticated;
grant execute on function public.pirate_clear_site(uuid, uuid) to authenticated;
grant execute on function public.pirate_set_treasure(uuid, double precision, double precision, integer) to authenticated;
grant execute on function public.pirate_validate(uuid) to authenticated;
