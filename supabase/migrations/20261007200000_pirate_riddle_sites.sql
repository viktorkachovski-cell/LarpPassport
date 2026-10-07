-- Owner decisions 2026-10-07 (game guide v3.3, plus the owner's instruction to
-- drop the treasure site kind):
--   * five crews of up to four;
--   * the map has only riddles and lighthouses: 5 bearing riddles, 4 oath
--     riddles, 3 reading-only lighthouses. Caches, Safe Harbours and the
--     treasure site kind are gone; the treasure stays a secret GM-set point
--     on private.pirate_games, used by the compass and staffed by the NPC;
--   * a solved riddle gives its configured shard or oath word plus doubloons
--     by the order of correct answers: 20 / 15 / 10 / 5 / 5;
--   * the treasure is worth round(0.40 x the highest crew doubloon balance),
--     frozen once on the first entry into `hoard`.

drop index private.pirate_sites_one_treasure_idx;
alter table private.pirate_sites drop constraint pirate_sites_kind_check;
alter table private.pirate_sites
  add constraint pirate_sites_kind_check check (kind in ('riddle', 'lighthouse'));

alter table private.pirate_claims drop constraint pirate_claims_rank_check;
alter table private.pirate_claims
  add constraint pirate_claims_rank_check check (rank between 1 and 5);

-- treasure_value is null until the first `hoard` opening freezes it.
alter table private.pirate_games
  alter column treasure_value drop not null,
  alter column treasure_value drop default,
  add column treasure_basis integer check (treasure_basis >= 0),
  add column treasure_frozen_at timestamptz,
  add constraint pirate_games_treasure_frozen_check check (
    (treasure_frozen_at is null and treasure_basis is null and treasure_value is null)
    or (treasure_frozen_at is not null and treasure_basis is not null and treasure_value is not null));
update private.pirate_games set treasure_value = null where treasure_frozen_at is null;

create or replace function public.pirate_set_site(
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
  if kind not in ('riddle', 'lighthouse') then
    raise exception using errcode = '22023', message = 'invalid Pirate site kind';
  end if;
  if zone_record.trigger_mode <> 'silent' then
    raise exception using errcode = '22023', message = 'this Pirate site needs a silent zone';
  end if;
  if kind = 'lighthouse' then
    if zone_record.shape <> 'circle' then
      raise exception using errcode = '22023', message = 'lighthouse must be a circle';
    end if;
    if reward is not null or oath_index is not null or oath_word is not null or answer is not null then
      raise exception using errcode = '22023', message = 'a lighthouse has no reward or answer';
    end if;
  else
    if reward is null or reward not in ('bearing', 'oath') then
      raise exception using errcode = '22023', message = 'riddle reward must be bearing or oath';
    end if;
    if reward = 'oath' and (oath_index is null or oath_word is null or pg_catalog.btrim(oath_word) = '') then
      raise exception using errcode = '22023', message = 'oath index and word are required';
    end if;
    if reward = 'bearing' and (oath_index is not null or oath_word is not null) then
      raise exception using errcode = '22023', message = 'bearing riddles cannot contain oath words';
    end if;
    if prompt is null or pg_catalog.btrim(prompt) = '' then
      raise exception using errcode = '22023', message = 'riddle prompt is required';
    end if;
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
  elsif kind = 'riddle' then
    new_hash := previous_hash;
  end if;
  if kind = 'riddle' and new_hash is null then
    raise exception using errcode = '22023', message = 'answer is required for this site';
  end if;

  insert into private.pirate_sites (
    zone_id, game_id, kind, reward, oath_index, oath_word, prompt, answer_hash
  ) values (
    zone_id, g, kind, reward, oath_index, oath_word, prompt, new_hash
  ) on conflict on constraint pirate_sites_pkey do update set
    kind = excluded.kind,
    reward = excluded.reward,
    oath_index = excluded.oath_index,
    oath_word = excluded.oath_word,
    prompt = excluded.prompt,
    answer_hash = excluded.answer_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'zone_id', zone_id, 'answer_set', new_hash is not null);
end;
$$;

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

-- A solved riddle gives its configured reward plus doubloons by the order of
-- correct answers.
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
  if exists (select 1 from private.pirate_claims claim
             where claim.zone_id = site.zone_id and claim.faction_id = crew_id
               and claim.voided_at is null) then
    return pg_catalog.jsonb_build_object('status', 'already_claimed');
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

-- No Safe Harbours: only a stale position or the hoard exclusion blocks Parley.
create or replace function private.pirate_parley_presence(
  p_game_id uuid, p_profile_id uuid, p_phase text, p_treasure extensions.geography
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare own_point extensions.geography;
begin
  select position.geog into own_point from public.player_positions position
  where position.game_id = p_game_id and position.profile_id = p_profile_id
    and position.recorded_at >= now() - interval '120 seconds';
  if own_point is null then return 'stale'; end if;
  if p_phase = 'hoard' and p_treasure is not null
     and extensions.st_dwithin(own_point, p_treasure, 100) then
    return 'treasure_exclusion';
  end if;
  return null;
end;
$$;

-- The GM sets only the secret point; its value is frozen at `hoard`.
drop function public.pirate_set_treasure(uuid, double precision, double precision, integer);
create function public.pirate_set_treasure(g uuid, lat double precision, lng double precision)
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
  if g is null or lat is null or lng is null
     or lat < -90 or lat > 90 or lng < -180 or lng > 180 then
    raise exception using errcode = '22023', message = 'invalid treasure point';
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
      updated_at = now()
  where game_id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$$;
revoke all on function public.pirate_set_treasure(uuid, double precision, double precision) from public, anon;
grant execute on function public.pirate_set_treasure(uuid, double precision, double precision) to authenticated;

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

create or replace function public.gm_award_treasure(g uuid, faction_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  phase_name text;
  amount integer;
  crew_name text;
  award_id uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or faction_id is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'game, crew and reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.treasure_value into phase_name, amount
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then raise exception using errcode = '55000', message = 'Pirate mode is not enabled'; end if;
  if phase_name <> 'hoard' then return pg_catalog.jsonb_build_object('status', 'wrong_phase'); end if;
  if amount is null then return pg_catalog.jsonb_build_object('status', 'not_frozen'); end if;
  select faction.name into crew_name from public.factions faction
  where faction.game_id = g and faction.id = gm_award_treasure.faction_id;
  if crew_name is null then
    raise exception using errcode = '22023', message = 'crew is not in this game';
  end if;
  if exists (select 1 from private.pirate_treasure_awards award
             where award.game_id = g and award.voided_at is null) then
    return pg_catalog.jsonb_build_object('status', 'already_awarded');
  end if;
  insert into private.pirate_treasure_awards (game_id, faction_id, awarded_by)
  values (g, faction_id, caller) returning id into award_id;
  if amount > 0 then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, reason, actor_id)
    values (g, faction_id, 'doubloon', amount, 'treasure', award_id, clean_reason, caller);
  end if;
  perform private.emit_pirate_event(g, 'pirate_treasure',
    pg_catalog.jsonb_build_object('crew_name', crew_name, 'amount', amount,
      'message', crew_name || ' claimed the hoard.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'award_id', award_id,
    'crew_name', crew_name, 'amount', amount);
end;
$$;

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
      'id', claim.id, 'faction_id', claim.faction_id, 'rank', claim.rank,
      'claimed_at', claim.created_at) order by claim.created_at)
      from private.pirate_claims claim
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
