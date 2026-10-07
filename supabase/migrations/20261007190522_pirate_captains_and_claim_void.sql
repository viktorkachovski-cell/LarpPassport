-- Owner decisions 2026-10-07:
--   * every crew has one captain. A one-player crew's player is its captain
--     automatically; the GM chooses the captain of a larger crew during setup.
--     Captains lock when charting starts;
--   * only the captain uses the compass: lighthouse readings, the distance
--     band and the reading logbook;
--   * rewards already pool per crew (one claim per crew per riddle, the first
--     correct answer from any crewmate wins); a later crewmate is told who
--     solved it;
--   * gm_void_claim (game guide 7.6) reverses a mistaken or cheated claim.

create table private.pirate_captains (
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  faction_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- NULL when the sole player of a crew became captain at charting.
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  constraint pirate_captains_pkey primary key (game_id, faction_id),
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
alter table private.pirate_captains enable row level security;
create policy pirate_captains_deny_clients on private.pirate_captains
  for all to anon, authenticated using (false) with check (false);
revoke all on private.pirate_captains from public, anon, authenticated;

-- A crew's captain: its stored captain while still a player in that crew,
-- otherwise its only player. NULL when a larger crew has no valid captain.
create function private.pirate_captain(p_game_id uuid, p_faction_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  with members as (
    select member.user_id as profile_id
    from public.characters member
    join public.game_players player on player.game_id = member.game_id
      and player.profile_id = member.user_id and player.role = 'player'
    where member.game_id = p_game_id and member.faction_id = p_faction_id
      and not member.is_npc
  )
  select coalesce(
    (select captain.profile_id from private.pirate_captains captain
     where captain.game_id = p_game_id and captain.faction_id = p_faction_id
       and captain.profile_id in (select profile_id from members)),
    (select (array_agg(profile_id))[1] from members having count(*) = 1));
$$;
revoke all on function private.pirate_captain(uuid, uuid) from public, anon, authenticated;

-- GM-only, setup only: charting locks the captains.
create function public.pirate_set_captain(g uuid, crew uuid, captain uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game_phase text;
  captain_name text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or crew is null or captain is null then
    raise exception using errcode = '22023', message = 'game, crew and captain are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase into game_phase from public.games game
  join private.pirate_games pirate on pirate.game_id = game.id
  where game.id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  if game_phase <> 'setup' then return pg_catalog.jsonb_build_object('status', 'locked'); end if;
  select member.name into captain_name from public.characters member
  join public.game_players player on player.game_id = member.game_id
    and player.profile_id = member.user_id and player.role = 'player'
  where member.game_id = g and member.user_id = captain
    and member.faction_id = crew and not member.is_npc;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_in_crew'); end if;
  insert into private.pirate_captains (game_id, faction_id, profile_id, assigned_by)
  values (g, crew, captain, caller)
  on conflict on constraint pirate_captains_pkey do update
  set profile_id = excluded.profile_id, assigned_by = excluded.assigned_by, assigned_at = now();
  perform private.emit_pirate_crew_event(g, crew, 'pirate_captain', pg_catalog.jsonb_build_object(
    'captain_name', captain_name,
    'message', captain_name || ' is your captain and carries the compass.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'captain_name', captain_name);
end;
$$;

revoke all on function public.pirate_set_captain(uuid, uuid, uuid) from public, anon;
grant execute on function public.pirate_set_captain(uuid, uuid, uuid) to authenticated;

-- Voids a riddle claim and reverses its shard and doubloons. The oath word
-- disappears with the claim, and the crew may solve the riddle again; a new
-- claim ranks after the claims still standing. A frozen treasure value stays.
create function public.gm_void_claim(g uuid, claim_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  claim record;
  doubloons integer;
  shards integer;
  doubloon_balance integer;
  shard_balance integer;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or claim_id is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'game, claim and correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select pirate_claim.id, pirate_claim.faction_id, pirate_claim.voided_at,
         crew.name as crew_name, zone.name as site_name
    into claim
  from private.pirate_claims pirate_claim
  join public.factions crew on crew.id = pirate_claim.faction_id
  join public.zones zone on zone.id = pirate_claim.zone_id
  where pirate_claim.id = gm_void_claim.claim_id and pirate_claim.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if claim.voided_at is not null then
    return pg_catalog.jsonb_build_object('status', 'already_voided');
  end if;

  select coalesce(sum(ledger.delta) filter (where ledger.currency = 'doubloon'), 0)::integer,
         coalesce(sum(ledger.delta) filter (where ledger.currency = 'bearing'), 0)::integer
    into doubloons, shards
  from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.ref_id = claim.id and ledger.source = 'riddle';
  select coalesce(sum(ledger.delta) filter (where ledger.currency = 'doubloon'), 0)::integer,
         coalesce(sum(ledger.delta) filter (where ledger.currency = 'bearing'), 0)::integer
    into doubloon_balance, shard_balance
  from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = claim.faction_id;
  -- Balances never go below zero. A crew that already lost the reward in a
  -- Parley must be corrected another way.
  if doubloon_balance < doubloons or shard_balance < shards then
    return pg_catalog.jsonb_build_object('status', 'insufficient_balance');
  end if;

  update private.pirate_claims
  set voided_at = now(), voided_by = caller, void_reason = clean_reason
  where id = claim.id;
  insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, reason, actor_id)
  select g, claim.faction_id, reversal.currency, -reversal.amount, 'riddle', claim.id, clean_reason, caller
  from (values ('doubloon', doubloons), ('bearing', shards)) reversal(currency, amount)
  where reversal.amount > 0;
  perform private.emit_pirate_event(g, 'pirate_ruling', pg_catalog.jsonb_build_object(
    'action', 'void_claim', 'crew_name', claim.crew_name, 'site_name', claim.site_name,
    'reason', clean_reason,
    'message', 'The Admiralty has ruled: ' || claim.crew_name || '''s claim at '
      || claim.site_name || ' is void. ' || clean_reason));
  return pg_catalog.jsonb_build_object('status', 'ok', 'claim_id', claim.id,
    'doubloons_reversed', doubloons, 'shards_reversed', shards);
end;
$$;

revoke all on function public.gm_void_claim(uuid, uuid, text) from public, anon;
grant execute on function public.gm_void_claim(uuid, uuid, text) to authenticated;

-- Setup also needs a captain for every crew.
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
  crew_count integer;
  missing_crew_count integer;
  wrong_size_count integer;
  captainless_count integer;
  bearing_count integer;
  oath_count integer;
  lighthouse_count integer;
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
  if crew_count <> 5 then
    issues := pg_catalog.array_append(issues, 'Exactly five crews are required');
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
    group by f.id having count(gp.profile_id) not between 1 and 4
  ) wrong_sizes;
  if wrong_size_count > 0 then
    issues := pg_catalog.array_append(issues, 'Each crew needs one to four players');
  end if;
  select count(*)::integer into captainless_count from public.factions f
  where f.game_id = g and private.pirate_captain(g, f.id) is null;
  if captainless_count > 0 then
    issues := pg_catalog.array_append(issues, 'Every crew needs a captain');
  end if;

  select count(*) filter (where s.kind = 'riddle' and s.reward = 'bearing'),
         count(*) filter (where s.kind = 'riddle' and s.reward = 'oath'),
         count(*) filter (where s.kind = 'lighthouse'),
         count(*) filter (where s.kind = 'riddle' and s.answer_hash is null)
    into bearing_count, oath_count, lighthouse_count, missing_answers
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.active
  where s.game_id = g;
  if bearing_count <> 5 then issues := pg_catalog.array_append(issues, 'Five bearing riddles are required'); end if;
  if oath_count <> 4 then issues := pg_catalog.array_append(issues, 'Four oath riddles are required'); end if;
  if lighthouse_count <> 3 then issues := pg_catalog.array_append(issues, 'Three lighthouses are required'); end if;
  if treasure_point is null then
    issues := pg_catalog.array_append(issues, 'The secret treasure point is required');
  end if;
  if missing_answers > 0 then
    issues := pg_catalog.array_append(issues, 'Every riddle needs an answer');
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
    za.geog, zb.geog, coalesce(za.radius_m, 0) + coalesce(zb.radius_m, 0)
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
      'lighthouses', lighthouse_count
    )
  );
end;
$$;

-- Unchanged except that charting stores the automatic one-player captains.
create or replace function public.pirate_set_phase(g uuid, next_phase text, message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phases constant text[] := array['setup', 'charting', 'cursed', 'truce', 'hunt', 'hoard', 'recall', 'finished'];
  current_phase text;
  current_index integer;
  next_index integer;
  clean_message text := pg_catalog.btrim(message);
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or next_phase is null then
    raise exception using errcode = '22023', message = 'game and phase are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  next_index := pg_catalog.array_position(phases, next_phase);
  if next_index is null then
    raise exception using errcode = '22023', message = 'invalid Pirate phase';
  end if;
  if clean_message is not null and pg_catalog.char_length(clean_message) > 300 then
    raise exception using errcode = '22023', message = 'phase message is too long';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase into current_phase from public.games game
  join private.pirate_games pirate on pirate.game_id = game.id
  where game.id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  current_index := pg_catalog.array_position(phases, current_phase);
  if current_index is null then
    raise exception using errcode = '55000', message = 'invalid current Pirate phase';
  end if;
  if current_phase = next_phase then
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', current_phase);
  end if;
  if current_phase = 'finished' or pg_catalog.abs(next_index - current_index) <> 1 then
    raise exception using errcode = '55000', message = 'Pirate phase can move only one step';
  end if;
  if current_phase = 'setup' and next_phase = 'charting'
     and not (public.pirate_validate(g)->>'ready')::boolean then
    raise exception using errcode = '55000', message = 'Pirate setup is not ready';
  end if;
  -- Charting locks the captains: a one-player crew's player becomes a stored
  -- captain, so a late second crewmate cannot leave the crew without one.
  if current_phase = 'setup' and next_phase = 'charting' then
    insert into private.pirate_captains (game_id, faction_id, profile_id)
    select g, faction.id, private.pirate_captain(g, faction.id)
    from public.factions faction
    where faction.game_id = g and private.pirate_captain(g, faction.id) is not null
    on conflict on constraint pirate_captains_pkey do nothing;
  end if;
  -- The first entry into `hoard` freezes the treasure value from the leading
  -- crew's doubloons. Re-entering `hoard` later reuses the frozen value.
  if next_phase = 'hoard' then
    update private.pirate_games pirate
    set treasure_basis = leader.balance,
        treasure_value = least(1000, pg_catalog.round(leader.balance * 0.40)::integer),
        treasure_frozen_at = now(), updated_at = now()
    from (
      select coalesce(max(crew.balance), 0)::integer as balance
      from (
        select coalesce(sum(ledger.delta), 0) as balance
        from public.factions faction
        left join private.pirate_ledger ledger
          on ledger.game_id = g and ledger.faction_id = faction.id and ledger.currency = 'doubloon'
        where faction.game_id = g
        group by faction.id
      ) crew
    ) leader
    where pirate.game_id = g and pirate.treasure_frozen_at is null;
  end if;
  update public.games
  set phase = next_phase,
      status = case when next_phase = 'finished' then 'finished'
                    when next_phase = 'setup' then 'draft'
                    when next_phase = 'charting' then 'active'
                    else status end
  where id = g;
  perform private.emit_pirate_event(g, 'pirate_phase', pg_catalog.jsonb_build_object(
    'phase', next_phase, 'message', coalesce(nullif(clean_message, ''),
      'Pirate phase: ' || next_phase)
  ));
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', next_phase);
end;
$$;

-- Unchanged except that already_claimed names the crewmate who solved it.
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
  payout := coalesce((array[20, 15, 10, 5, 5])[solve_rank], 0);
  insert into private.pirate_claims (game_id, zone_id, faction_id, claimed_by, rank)
  values (g, site.zone_id, crew_id, caller, case when solve_rank <= 5 then solve_rank end)
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

-- Captain only; the reading event goes to the captain alone.
create or replace function public.compass_reading(g uuid)
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
  if caller is distinct from private.pirate_captain(g, crew_id) then
    return pg_catalog.jsonb_build_object('status', 'not_captain');
  end if;

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
  insert into public.game_events (game_id, profile_id, type, status, player_visible, payload)
  values (g, caller, 'pirate_reading', 'confirmed', true, response);
  return response;
end;
$$;

-- Captain only.
create or replace function public.treasure_band(g uuid)
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
  if caller is distinct from private.pirate_captain(g, crew_id) then
    return pg_catalog.jsonb_build_object('band', 'not_captain');
  end if;
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

-- Every crewmate sees the captain; only the captain gets readings and the band.
create or replace function public.get_pirate_state(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  player_role text;
  crew_id uuid;
  crew_name text;
  crew_color text;
  phase_name text;
  is_paused boolean;
  is_pvp_enabled boolean;
  shards integer;
  doubloons integer;
  oath_words jsonb;
  reading_list jsonb;
  mercy_end timestamptz;
  parley_info jsonb;
  captain_id uuid;
  captain_name text;
  is_captain boolean;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  select player.role into player_role from public.game_players player
  where player.game_id = g and player.profile_id = caller;
  if player_role is null then
    raise exception using errcode = '42501', message = 'game membership required';
  end if;
  select game.phase, pirate.paused, pirate.pvp_enabled
    into phase_name, is_paused, is_pvp_enabled
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;
  if player_role <> 'player' then
    return pg_catalog.jsonb_build_object('is_pirate', true, 'role', player_role,
      'phase', phase_name, 'paused', is_paused, 'pvp_enabled', is_pvp_enabled);
  end if;
  select faction.id, faction.name, faction.color into crew_id, crew_name, crew_color
  from public.characters character
  join public.factions faction on faction.id = character.faction_id and faction.game_id = g
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then
    return pg_catalog.jsonb_build_object('is_pirate', true, 'role', 'player',
      'phase', phase_name, 'paused', is_paused, 'pvp_enabled', is_pvp_enabled,
      'status', 'no_crew');
  end if;
  captain_id := private.pirate_captain(g, crew_id);
  is_captain := coalesce(caller = captain_id, false);
  select captain.name into captain_name from public.characters captain
  where captain.game_id = g and captain.user_id = captain_id and not captain.is_npc;
  select coalesce(sum(delta) filter (where currency = 'bearing'), 0)::integer,
         coalesce(sum(delta) filter (where currency = 'doubloon'), 0)::integer
    into shards, doubloons
  from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'index', site.oath_index, 'word', site.oath_word) order by site.oath_index), '[]'::jsonb)
    into oath_words
  from private.pirate_claims claim
  join private.pirate_sites site on site.zone_id = claim.zone_id
  where claim.game_id = g and claim.faction_id = crew_id
    and claim.voided_at is null and site.reward = 'oath';
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'lighthouse_name', zone.name, 'centre_deg', reading.centre_deg,
    'half_width_deg', reading.half_width_deg, 'level', reading.shards,
    'taken_at', reading.created_at) order by reading.created_at desc), '[]'::jsonb)
    into reading_list
  from private.pirate_readings reading
  join public.zones zone on zone.id = reading.zone_id and zone.game_id = g
  where reading.game_id = g and reading.faction_id = crew_id and reading.voided_at is null
    and is_captain;
  select mercy.until_at into mercy_end from private.pirate_mercy mercy
  where mercy.game_id = g and mercy.faction_id = crew_id and mercy.until_at > now();
  select pg_catalog.jsonb_build_object(
    'id', parley.id, 'state', parley.state,
    'role', case when parley.target_faction = crew_id then 'target' else 'attacker' end,
    'can_act', coalesce(caller = parley.target_profile
      or caller = parley.attacker_profile, false),
    'self_reported', case when caller = parley.target_profile then parley.target_report is not null
                          when caller = parley.attacker_profile then parley.attacker_report is not null
                          else false end,
    'code', case when parley.target_profile = caller and parley.state = 'open'
                 then parley.code else null end,
    'code_expires_at', parley.code_expires_at,
    'target_faction', parley.target_faction, 'attacker_faction', parley.attacker_faction,
    'opponent_name', case when parley.target_faction = crew_id then attacker.name else target.name end,
    'choice', parley.choice, 'winner_faction', parley.winner_faction,
    'plunder', parley.plunder, 'far_apart', parley.far_apart)
    into parley_info
  from private.pirate_parleys parley
  join public.factions target on target.id = parley.target_faction
  left join public.factions attacker on attacker.id = parley.attacker_faction
  where parley.game_id = g and parley.voided_at is null
    and private.pirate_parley_live(parley.state)
    and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)
  order by parley.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'role', 'player', 'phase', phase_name,
    'paused', is_paused, 'pvp_enabled', is_pvp_enabled,
    'crew', pg_catalog.jsonb_build_object('id', crew_id, 'name', crew_name, 'color', crew_color,
      'captain_name', captain_name),
    'is_captain', is_captain,
    'shards', shards, 'doubloons', doubloons, 'oath', oath_words,
    'readings', reading_list, 'mercy_until', mercy_end, 'active_parley', parley_info,
    'site_here', public.site_here(g),
    'band', case when is_captain then public.treasure_band(g)->>'band' end);
end;
$$;

-- Adds crew rosters, captains and who solved each claim (for gm_void_claim).
create or replace function public.gm_pirate_overview(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game_phase text;
  game_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  treasure_amount integer;
  treasure_basis_amount integer;
  treasure_frozen timestamptz;
  crew_rows jsonb;
  site_rows jsonb;
  award_info jsonb;
  parley_rows jsonb;
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
  select game.phase, pirate.paused, pirate.pvp_enabled,
         pirate.treasure_geog, pirate.treasure_value, pirate.treasure_basis, pirate.treasure_frozen_at
    into game_phase, game_paused, pvp_on, treasure, treasure_amount, treasure_basis_amount, treasure_frozen
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', faction.id, 'name', faction.name, 'color', faction.color,
    'captain_id', private.pirate_captain(g, faction.id),
    'members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'profile_id', member.user_id, 'name', member.name) order by member.name)
      from public.characters member
      join public.game_players player on player.game_id = member.game_id
        and player.profile_id = member.user_id and player.role = 'player'
      where member.game_id = g and member.faction_id = faction.id and not member.is_npc), '[]'::jsonb),
    'shards', coalesce((select sum(delta)::integer from private.pirate_ledger ledger
                       where ledger.game_id = g and ledger.faction_id = faction.id
                         and ledger.currency = 'bearing'), 0),
    'doubloons', coalesce((select sum(delta)::integer from private.pirate_ledger ledger
                          where ledger.game_id = g and ledger.faction_id = faction.id
                            and ledger.currency = 'doubloon'), 0),
    'oath_count', (select count(*) from private.pirate_claims claim
                   join private.pirate_sites site on site.zone_id = claim.zone_id
                   where claim.game_id = g and claim.faction_id = faction.id
                     and claim.voided_at is null and site.reward = 'oath'),
    'reading_count', (select count(*) from private.pirate_readings reading
                      where reading.game_id = g and reading.faction_id = faction.id
                        and reading.voided_at is null),
    'last_claim_at', (select max(claim.created_at) from private.pirate_claims claim
                      where claim.game_id = g and claim.faction_id = faction.id
                        and claim.voided_at is null),
    'mercy_until', (select mercy.until_at from private.pirate_mercy mercy
                    where mercy.game_id = g and mercy.faction_id = faction.id)
  ) order by faction.name), '[]'::jsonb) into crew_rows
  from public.factions faction where faction.game_id = g;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'zone_id', site.zone_id, 'name', zone.name, 'kind', site.kind,
    'reward', site.reward, 'oath_index', site.oath_index,
    'answer_set', site.answer_hash is not null,
    'active', zone.active,
    'claims', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', claim.id, 'faction_id', claim.faction_id, 'crew_name', crew.name,
      'claimed_by_name', solver.name, 'rank', claim.rank,
      'claimed_at', claim.created_at) order by claim.created_at)
      from private.pirate_claims claim
      join public.factions crew on crew.id = claim.faction_id
      left join public.characters solver on solver.game_id = claim.game_id
        and solver.user_id = claim.claimed_by and not solver.is_npc
      where claim.game_id = g and claim.zone_id = site.zone_id and claim.voided_at is null), '[]'::jsonb)
  ) order by zone.name), '[]'::jsonb) into site_rows
  from private.pirate_sites site join public.zones zone on zone.id = site.zone_id
  where site.game_id = g;

  select pg_catalog.jsonb_build_object('id', award.id, 'faction_id', award.faction_id,
    'crew_name', faction.name, 'awarded_at', award.created_at)
    into award_info
  from private.pirate_treasure_awards award
  join public.factions faction on faction.id = award.faction_id
  where award.game_id = g and award.voided_at is null;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', parley.id, 'state', parley.state, 'choice', parley.choice,
    'target_faction', parley.target_faction, 'target_name', target.name,
    'attacker_faction', parley.attacker_faction, 'attacker_name', attacker.name,
    'target_report', parley.target_report, 'attacker_report', parley.attacker_report,
    'winner_faction', parley.winner_faction, 'plunder', parley.plunder,
    'far_apart', parley.far_apart, 'created_at', parley.created_at
  ) order by parley.created_at desc), '[]'::jsonb) into parley_rows
  from private.pirate_parleys parley
  join public.factions target on target.id = parley.target_faction
  left join public.factions attacker on attacker.id = parley.attacker_faction
  where parley.game_id = g and parley.voided_at is null
    and private.pirate_parley_live(parley.state);

  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'phase', game_phase, 'paused', game_paused,
    'pvp_enabled', pvp_on,
    'treasure', case when treasure is null then null else pg_catalog.jsonb_build_object(
      'lat', extensions.st_y(treasure::extensions.geometry),
      'lng', extensions.st_x(treasure::extensions.geometry),
      'value', treasure_amount, 'basis', treasure_basis_amount,
      'frozen_at', treasure_frozen) end,
    'crews', crew_rows, 'sites', site_rows, 'treasure_award', award_info,
    'parleys', parley_rows);
end;
$$;

