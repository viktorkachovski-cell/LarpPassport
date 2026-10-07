-- Server-held presence and position are the only proof of being on site.
create function private.pirate_current_sites(p_game_id uuid, p_user_id uuid)
returns table (
  zone_id uuid, kind text, reward text, oath_index smallint, oath_word text,
  prompt text, answer_hash text, site_name text
)
language sql
stable
set search_path = ''
as $$
  select s.zone_id, s.kind, s.reward, s.oath_index, s.oath_word,
         s.prompt, s.answer_hash, z.name
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.game_id = p_game_id
  join private.zone_state state on state.zone_id = z.id and state.profile_id = p_user_id
  where s.game_id = p_game_id and z.active and state.inside
    and state.inside_since is not null
    and state.inside_since <= now() - pg_catalog.make_interval(secs => z.dwell_seconds);
$$;
revoke all on function private.pirate_current_sites(uuid, uuid) from public, anon, authenticated;

create function private.emit_pirate_crew_event(
  p_game_id uuid, p_faction_id uuid, p_type text, p_payload jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, profile_id, type, status, player_visible, payload)
  select p_game_id, player.profile_id, p_type, 'confirmed', true, p_payload
  from public.game_players player
  join public.characters character on character.game_id = player.game_id
    and character.user_id = player.profile_id and not character.is_npc
  where player.game_id = p_game_id and player.role = 'player'
    and character.faction_id = p_faction_id;
$$;
revoke all on function private.emit_pirate_crew_event(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create function public.site_here(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  site record;
  candidate_count integer;
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
  if not exists (select 1 from private.pirate_games where game_id = g) then
    return null;
  end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return null;
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  select count(*)::integer into candidate_count from private.pirate_current_sites(g, caller);
  if candidate_count = 0 then return null; end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select * into site from private.pirate_current_sites(g, caller) limit 1;
  return pg_catalog.jsonb_build_object(
    'site_name', site.site_name, 'kind', site.kind, 'reward', site.reward,
    'prompt', site.prompt,
    'claimed_by_my_crew', exists (
      select 1 from private.pirate_claims claim
      where claim.game_id = g and claim.zone_id = site.zone_id
        and claim.faction_id = crew_id and claim.voided_at is null
    )
  );
end;
$$;

create function public.claim_site(g uuid, answer text, idem uuid)
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
  cache_rank integer;
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
  where attempt.game_id = g and attempt.profile_id = caller and attempt.idem = idem;
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
  where current_site.kind in ('riddle', 'cache');
  if candidate_count = 0 then return pg_catalog.jsonb_build_object('status', 'no_site'); end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select * into site from private.pirate_current_sites(g, caller) current_site
  where current_site.kind in ('riddle', 'cache') limit 1;
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
      'attempts_remaining', pg_catalog.greatest(0, 3 - wrong_count - 1),
      'remaining_seconds', case when wrong_count + 1 >= 3 then 120 else 0 end);
    insert into private.pirate_attempts (
      game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
    ) values (g, site.zone_id, crew_id, caller, idem, request_hash, false, result);
    return result;
  end if;

  if site.kind = 'cache' then
    select count(*)::integer + 1 into cache_rank from private.pirate_claims claim
    where claim.zone_id = site.zone_id and claim.voided_at is null;
    if cache_rank > 4 then return pg_catalog.jsonb_build_object('status', 'fully_claimed'); end if;
    payout := (array[20, 15, 10, 5])[cache_rank];
  end if;
  insert into private.pirate_claims (game_id, zone_id, faction_id, claimed_by, rank)
  values (g, site.zone_id, crew_id, caller, cache_rank) returning id into claim_id;
  if site.kind = 'cache' then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'doubloon', payout, 'cache', claim_id, caller);
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'doubloon', 'amount', payout,
      'rank', cache_rank, 'site_name', site.site_name);
  elsif site.reward = 'bearing' then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'bearing', 1, 'riddle', claim_id, caller);
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'bearing', 'amount', 1,
      'site_name', site.site_name);
  else
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'oath',
      'oath_index', site.oath_index, 'oath_word', site.oath_word, 'site_name', site.site_name);
  end if;
  insert into private.pirate_attempts (
    game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
  ) values (g, site.zone_id, crew_id, caller, idem, request_hash, true, result);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_claim', result);
  return result;
end;
$$;

revoke all on function public.site_here(uuid) from public, anon;
revoke all on function public.claim_site(uuid, text, uuid) from public, anon;
grant execute on function public.site_here(uuid) to authenticated;
grant execute on function public.claim_site(uuid, text, uuid) to authenticated;
