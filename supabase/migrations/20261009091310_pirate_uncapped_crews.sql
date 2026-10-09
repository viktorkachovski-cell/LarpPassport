-- Attendance is uncapped. Five crews remains a planning target only.
-- Keep structural validation and captain requirements for any crew size.

create or replace function public.pirate_validate(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  issues text[] := array[]::text[];
  warnings text[] := array[]::text[];
  crew_count integer;
  player_count integer;
  missing_crew_count integer;
  empty_crew_count integer;
  captainless_count integer;
  bearing_count integer;
  oath_count integer;
  lighthouse_count integer;
  missing_answers integer;
  overlap_count integer;
  non_circle_lighthouse_count integer;
  far_lighthouse_count integer;
  centred_lighthouse_count integer;
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

  -- Crews and players.
  select count(*)::integer into crew_count from public.factions where game_id = g;
  select count(*)::integer into player_count
  from public.game_players gp where gp.game_id = g and gp.role = 'player';
  select count(*)::integer into missing_crew_count
  from public.game_players gp
  left join public.characters c on c.game_id = gp.game_id and c.user_id = gp.profile_id and not c.is_npc
  left join public.factions f on f.id = c.faction_id and f.game_id = g
  where gp.game_id = g and gp.role = 'player' and (c.id is null or f.id is null);
  select count(*) filter (where crew_size = 0),
         count(*) filter (where crew_size > 1 and private.pirate_captain(g, crew_id) is null)
    into empty_crew_count, captainless_count
  from (
    select f.id as crew_id, count(gp.profile_id) as crew_size
    from public.factions f
    left join public.characters c on c.faction_id = f.id and c.game_id = g and not c.is_npc
    left join public.game_players gp on gp.game_id = g and gp.profile_id = c.user_id and gp.role = 'player'
    where f.game_id = g
    group by f.id
  ) crews;
  if crew_count = 0 then
    issues := pg_catalog.array_append(issues, 'At least one crew is required');
  end if;
  if captainless_count > 0 then
    issues := pg_catalog.array_append(issues, 'Every crew needs a captain');
  end if;
  if crew_count not in (0, 5) then
    warnings := pg_catalog.array_append(warnings,
      'The event plan has 5 crews; this game has ' || crew_count);
  end if;
  if missing_crew_count > 0 then
    warnings := pg_catalog.array_append(warnings,
      missing_crew_count || ' player(s) have no crew yet and cannot claim riddles until they get one');
  end if;
  if empty_crew_count > 0 then
    warnings := pg_catalog.array_append(warnings,
      empty_crew_count || ' crew(s) have no players yet');
  end if;

  -- Sites.
  select count(*) filter (where s.kind = 'riddle' and s.reward = 'bearing'),
         count(*) filter (where s.kind = 'riddle' and s.reward = 'oath'),
         count(*) filter (where s.kind = 'lighthouse'),
         count(*) filter (where s.kind = 'riddle' and s.answer_hash is null),
         count(*) filter (where s.kind = 'lighthouse' and z.shape <> 'circle')
    into bearing_count, oath_count, lighthouse_count, missing_answers, non_circle_lighthouse_count
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.active
  where s.game_id = g;
  if treasure_point is null then
    issues := pg_catalog.array_append(issues, 'The secret treasure point is required');
  end if;
  if missing_answers > 0 then
    issues := pg_catalog.array_append(issues, 'Every riddle needs an answer');
  end if;
  if non_circle_lighthouse_count > 0 then
    issues := pg_catalog.array_append(issues, 'Lighthouses must be circles');
  end if;
  select count(*)::integer into overlap_count
  from private.pirate_sites a
  join private.pirate_sites b on b.game_id = a.game_id and b.zone_id > a.zone_id
  join public.zones za on za.id = a.zone_id and za.active
  join public.zones zb on zb.id = b.zone_id and zb.active
  where a.game_id = g and extensions.st_dwithin(
    za.geog, zb.geog, coalesce(za.radius_m, 0) + coalesce(zb.radius_m, 0)
  );
  if overlap_count > 0 then
    issues := pg_catalog.array_append(issues, 'Pirate site zones overlap');
  end if;
  if bearing_count <> 5 then
    warnings := pg_catalog.array_append(warnings,
      'Bearing riddles: ' || bearing_count || ' of the 5 planned');
  end if;
  if oath_count <> 4 then
    warnings := pg_catalog.array_append(warnings,
      'Oath riddles: ' || oath_count || ' of the 4 planned');
  end if;
  if lighthouse_count <> 3 then
    warnings := pg_catalog.array_append(warnings,
      'Lighthouses: ' || lighthouse_count || ' of the 3 planned');
  end if;
  if treasure_point is not null then
    select count(*) filter (where extensions.st_distance(z.geog, treasure_point) < 1),
           count(*) filter (where extensions.st_distance(z.geog, treasure_point) not between 200 and 1500)
      into centred_lighthouse_count, far_lighthouse_count
    from private.pirate_sites s
    join public.zones z on z.id = s.zone_id and z.active
    where s.game_id = g and s.kind = 'lighthouse';
    if centred_lighthouse_count > 0 then
      issues := pg_catalog.array_append(issues, 'A lighthouse cannot be centred on the treasure point');
    end if;
    if far_lighthouse_count > 0 then
      warnings := pg_catalog.array_append(warnings,
        far_lighthouse_count || ' lighthouse(s) are not 200 to 1500 metres from the treasure; their bearings cross poorly');
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ready', pg_catalog.cardinality(issues) = 0,
    'issues', pg_catalog.to_jsonb(issues),
    'warnings', pg_catalog.to_jsonb(warnings),
    'counts', pg_catalog.jsonb_build_object(
      'crews', crew_count, 'players', player_count,
      'bearing_riddles', bearing_count, 'oath_riddles', oath_count,
      'lighthouses', lighthouse_count
    )
  );
end;
$$;

-- New successful riddle claims pay 20/15/10/5, then 5 for every later crew.
-- Preserve historical claims, ledger entries and saved idempotent responses.
alter table private.pirate_claims drop constraint pirate_claims_rank_check;
alter table private.pirate_claims alter column rank type integer;
alter table private.pirate_claims add constraint pirate_claims_rank_check check (rank >= 1);

create or replace function public.claim_site(g uuid, answer text, idem uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  game_phase text;
  game_paused boolean;
  secret bytea;
  normalized text;
  request_hash text;
  prior record;
  site record;
  candidate_count integer;
  answer_digest text;
  wrong_count integer;
  claim_id uuid;
  solver_name text;
  solve_rank integer;
  payout integer;
  result jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or answer is null or idem is null or pg_catalog.char_length(answer) > 100 then
    raise exception using errcode = '22023', message = 'game, bounded answer and request ID are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  normalized := private.pirate_normalize_answer(answer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.hmac_secret
    into game_phase, game_paused, secret
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  request_hash := pg_catalog.encode(
    extensions.hmac(pg_catalog.convert_to('claim:' || normalized || ':' || g::text, 'UTF8'), secret, 'sha256'), 'hex');
  select attempt.request_hash, attempt.result into prior
  from private.pirate_attempts attempt
  where attempt.game_id = g and attempt.profile_id = caller and attempt.idem = claim_site.idem;
  if found then
    if prior.request_hash <> request_hash then
      return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return prior.result;
  end if;
  if game_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if game_phase not in ('charting', 'cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;

  select count(*)::integer into candidate_count
  from private.pirate_current_sites(g, caller) current_site
  where current_site.kind = 'riddle';
  if candidate_count = 0 then return pg_catalog.jsonb_build_object('status', 'no_site'); end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select * into site from private.pirate_current_sites(g, caller) current_site
  where current_site.kind = 'riddle' limit 1;
  -- One claim per crew: a crewmate's later correct answer earns nothing.
  select solver.name into solver_name from private.pirate_claims claim
  left join public.characters solver on solver.game_id = claim.game_id
    and solver.user_id = claim.claimed_by and not solver.is_npc
  where claim.zone_id = site.zone_id and claim.faction_id = crew_id
    and claim.voided_at is null;
  if found then
    return pg_catalog.jsonb_build_object('status', 'already_claimed', 'claimed_by_name', solver_name);
  end if;

  select count(*)::integer into wrong_count from private.pirate_attempts attempt
  where attempt.game_id = g and attempt.zone_id = site.zone_id
    and attempt.faction_id = crew_id and not attempt.ok
    and attempt.created_at > now() - interval '120 seconds';
  if wrong_count >= 3 then
    return pg_catalog.jsonb_build_object('status', 'locked_out', 'remaining_seconds', 120);
  end if;
  answer_digest := pg_catalog.encode(
    extensions.digest(normalized || ':' || site.zone_id::text, 'sha256'), 'hex');
  if site.answer_hash is null or normalized = '' or answer_digest <> site.answer_hash then
    result := pg_catalog.jsonb_build_object('status', case when wrong_count + 1 >= 3 then 'locked_out' else 'wrong' end,
      'attempts_remaining', greatest(0, 3 - wrong_count - 1),
      'remaining_seconds', case when wrong_count + 1 >= 3 then 120 else 0 end);
    insert into private.pirate_attempts (
      game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
    ) values (g, site.zone_id, crew_id, caller, idem, request_hash, false, result);
    return result;
  end if;

  select count(*)::integer + 1 into solve_rank from private.pirate_claims claim
  where claim.zone_id = site.zone_id and claim.voided_at is null;
  payout := case solve_rank when 1 then 20 when 2 then 15 when 3 then 10 else 5 end;
  insert into private.pirate_claims (game_id, zone_id, faction_id, claimed_by, rank)
  values (g, site.zone_id, crew_id, caller, solve_rank)
  returning id into claim_id;
  if payout > 0 then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'doubloon', payout, 'riddle', claim_id, caller);
  end if;
  if site.reward = 'bearing' then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'bearing', 1, 'riddle', claim_id, caller);
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'bearing', 'amount', 1);
  else
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'oath',
      'oath_index', site.oath_index, 'oath_word', site.oath_word);
  end if;
  result := result || pg_catalog.jsonb_build_object(
    'doubloons', payout, 'rank', solve_rank, 'site_name', site.site_name);
  insert into private.pirate_attempts (
    game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
  ) values (g, site.zone_id, crew_id, caller, idem, request_hash, true, result);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_claim', result);
  return result;
end;
$$;

