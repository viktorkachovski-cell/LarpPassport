-- Audited GM recovery controls and prospective rule configuration.
-- Player privacy, direct RPCs, per-game advisory locks and historical rewards remain intact.

create function private.pirate_default_settings()
returns jsonb language sql immutable set search_path = '' as $$
  select '{"riddle_payouts":[20,15,10,5],"treasure_percent":40,
    "yield_percent":10,"yield_min":3,"fight_percent":25,"fight_min":5,
    "mercy_seconds":900,"pair_cooldown_seconds":1800,
    "attack_window_seconds":3600,"attack_limit":3,
    "code_ttl_seconds":90,"session_timeout_seconds":300,
    "answer_lockout_seconds":120,"answer_attempt_limit":3}'::jsonb;
$$;
revoke all on function private.pirate_default_settings() from public, anon, authenticated;

create function private.pirate_settings(g uuid)
returns jsonb language sql stable set search_path = '' as $$
  select private.pirate_default_settings() || pirate.settings
  from private.pirate_games pirate where pirate.game_id = g;
$$;
revoke all on function private.pirate_settings(uuid) from public, anon, authenticated;

create table private.pirate_gm_audit (
  id bigint generated always as identity primary key,
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text not null check (char_length(trim(reason)) between 3 and 300),
  before_state jsonb, after_state jsonb,
  created_at timestamptz not null default now()
);
create index pirate_gm_audit_game_page_idx on private.pirate_gm_audit(game_id, created_at desc, id desc);
create index pirate_gm_audit_actor_idx on private.pirate_gm_audit(actor_id);
alter table private.pirate_gm_audit enable row level security;
create policy deny_all on private.pirate_gm_audit for all to anon,authenticated using(false) with check(false);
revoke all on private.pirate_gm_audit from public, anon, authenticated;

create table private.pirate_gm_claim_requests (
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  idem uuid not null, request_hash text not null,
  result jsonb not null, created_at timestamptz not null default now(),
  primary key(game_id, actor_id, idem)
);
alter table private.pirate_gm_claim_requests enable row level security;
create policy deny_all on private.pirate_gm_claim_requests for all to anon,authenticated using(false) with check(false);
create index pirate_gm_claim_requests_actor_idx on private.pirate_gm_claim_requests(actor_id);
revoke all on private.pirate_gm_claim_requests from public, anon, authenticated;
alter table private.pirate_claims add column gm_reason text
  check (gm_reason is null or char_length(trim(gm_reason)) between 3 and 300);
alter table private.pirate_attempts add column lockout_until timestamptz;
update private.pirate_attempts set lockout_until=created_at+interval '120 seconds'
where not ok and result->>'status'='locked_out';

-- Session snapshots prevent edits from rewriting an existing encounter's terms.
alter table private.pirate_parleys add column rules jsonb not null default private.pirate_default_settings();
alter table private.pirate_parleys add column pair_cooldown_until timestamptz;
update private.pirate_parleys set pair_cooldown_until = updated_at + interval '30 minutes'
where state = 'resolved';

create function private.pirate_require_gm(g uuid)
returns uuid language plpgsql set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception using errcode='28000',message='not authenticated'; end if;
  if g is null then raise exception using errcode='22023',message='game is required'; end if;
  if not private.is_game_gm(g,actor) then raise exception using errcode='42501',message='GM access required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text,0));
  if not exists(select 1 from private.pirate_games p join public.games game on game.id=p.game_id
    where p.game_id=g and game.phase is not null) then
    raise exception using errcode='55000',message='Pirate mode is not enabled';
  end if;
  return actor;
end;
$$;
revoke all on function private.pirate_require_gm(uuid) from public, anon, authenticated;

create function private.pirate_audit(g uuid, actor uuid, action text, reason text, old_state jsonb, new_state jsonb)
returns void language sql set search_path = '' as $$
  insert into private.pirate_gm_audit(game_id,actor_id,action,reason,before_state,after_state)
  values(g,actor,action,reason,old_state,new_state);
$$;
revoke all on function private.pirate_audit(uuid,uuid,text,text,jsonb,jsonb) from public, anon, authenticated;

create function public.gm_set_pirate_settings(g uuid, settings jsonb, reason text, expected_settings jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := private.pirate_require_gm(g);
  clean_reason text := btrim(reason);
  defaults jsonb := private.pirate_default_settings();
  current_settings jsonb := private.pirate_settings(g);
  entry record; item jsonb; upper_bound integer; lower_bound integer; new_settings jsonb; normalized_payouts jsonb;
begin
  if clean_reason is null or char_length(clean_reason) not between 3 and 300
    or settings is null or jsonb_typeof(settings) <> 'object' then
    raise exception using errcode='22023',message='settings object and correction reason are required';
  end if;
  if (select phase from public.games where id=g)='finished' then return jsonb_build_object('status','wrong_phase'); end if;
  if expected_settings is not null and expected_settings<>current_settings then
    return jsonb_build_object('status','settings_changed');
  end if;
  for entry in select * from jsonb_each(settings) loop
    if not defaults ? entry.key then raise exception using errcode='22023',message='unknown Pirate setting'; end if;
    if entry.key='riddle_payouts' then
      if jsonb_typeof(entry.value) <> 'array' then raise exception using errcode='22023',message='riddle payouts must be an array'; end if;
      if jsonb_array_length(entry.value) not between 1 and 20 then raise exception using errcode='22023',message='use one to twenty payout ranks'; end if;
      normalized_payouts := '[]'::jsonb;
      for item in select value from jsonb_array_elements(entry.value) loop
        if jsonb_typeof(item)<>'number' then raise exception using errcode='22023',message='payouts must be whole doubloons from 0 to 1000'; end if;
        if item::text::numeric not between 0 and 1000 or item::text::numeric<>trunc(item::text::numeric) then
          raise exception using errcode='22023',message='payouts must be whole doubloons from 0 to 1000';
        end if;
        normalized_payouts := normalized_payouts || to_jsonb(item::text::numeric::integer);
      end loop;
      settings := jsonb_set(settings,array[entry.key],normalized_payouts);
    else
      lower_bound := case entry.key when 'attack_window_seconds' then 60 when 'attack_limit' then 1
        when 'code_ttl_seconds' then 30 when 'session_timeout_seconds' then 60
        when 'answer_lockout_seconds' then 30 when 'answer_attempt_limit' then 1 else 0 end;
      upper_bound := case entry.key when 'treasure_percent' then 100 when 'yield_percent' then 100
        when 'fight_percent' then 100 when 'yield_min' then 1000 when 'fight_min' then 1000
        when 'attack_window_seconds' then 86400 when 'attack_limit' then 100 when 'code_ttl_seconds' then 600
        when 'session_timeout_seconds' then 3600 when 'answer_lockout_seconds' then 600
        when 'answer_attempt_limit' then 10 else 7200 end;
      if jsonb_typeof(entry.value)<>'number' then raise exception using errcode='22023',message='settings must be bounded whole numbers'; end if;
      if entry.value::text::numeric not between lower_bound and upper_bound
        or entry.value::text::numeric<>trunc(entry.value::text::numeric) then
        raise exception using errcode='22023',message='setting is outside its allowed range';
      end if;
      settings := jsonb_set(settings,array[entry.key],to_jsonb(entry.value::text::numeric::integer));
    end if;
  end loop;
  new_settings := current_settings || settings;
  if new_settings <> current_settings then
    update private.pirate_games set settings=new_settings,updated_at=now() where game_id=g;
    perform private.pirate_audit(g,actor,'settings',clean_reason,current_settings,new_settings);
    perform private.emit_pirate_event(g,'pirate_ruling',jsonb_build_object('action','settings',
      'reason',clean_reason,'message','The Admiralty changed rules for new claims and Parleys: ' || clean_reason));
  end if;
  return jsonb_build_object('status','ok','settings',new_settings);
end;
$$;
revoke all on function public.gm_set_pirate_settings(uuid,jsonb,text,jsonb) from public,anon;
grant execute on function public.gm_set_pirate_settings(uuid,jsonb,text,jsonb) to authenticated;

create function public.gm_set_mercy(g uuid, crew uuid, minutes integer, reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.pirate_require_gm(g); clean_reason text := btrim(reason); old_state jsonb; expiry timestamptz;
begin
  if crew is null or minutes is null or minutes not between 0 and 120 or clean_reason is null
    or char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode='22023',message='crew, 0 to 120 minutes and correction reason are required';
  end if;
  if not exists(select 1 from public.factions f where f.id=crew and f.game_id=g) then
    raise exception using errcode='22023',message='crew is not in this game';
  end if;
  select jsonb_build_object('until',until_at,'source_parley_id',source_parley_id) into old_state
  from private.pirate_mercy where game_id=g and faction_id=crew;
  expiry := now()+make_interval(mins=>minutes);
  insert into private.pirate_mercy(game_id,faction_id,until_at,source_parley_id) values(g,crew,expiry,null)
  on conflict(game_id,faction_id) do update set until_at=excluded.until_at,source_parley_id=null;
  perform private.pirate_audit(g,actor,'mercy',clean_reason,old_state,jsonb_build_object('crew',crew,'until',expiry));
  perform private.emit_pirate_crew_event(g,crew,'pirate_ruling',jsonb_build_object('action','mercy',
    'reason',clean_reason,'mercy_until',expiry,'message','The Admiralty set Mercy to ' || minutes || ' minutes: ' || clean_reason));
  return jsonb_build_object('status','ok','mercy_until',expiry);
end;
$$;
revoke all on function public.gm_set_mercy(uuid,uuid,integer,text) from public,anon;
grant execute on function public.gm_set_mercy(uuid,uuid,integer,text) to authenticated;

create function public.gm_replace_captain(g uuid, crew uuid, captain uuid, reason text, expected_captain uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.pirate_require_gm(g); clean_reason text := btrim(reason); previous uuid;
begin
  if crew is null or captain is null or clean_reason is null or char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode='22023',message='crew, captain and correction reason are required';
  end if;
  if (select phase from public.games where id=g)='finished' then return jsonb_build_object('status','wrong_phase'); end if;
  if not exists(select 1 from public.factions f join public.characters c on c.faction_id=f.id and c.game_id=f.game_id
    join public.game_players gp on gp.game_id=c.game_id and gp.profile_id=c.user_id and gp.role='player'
    where f.game_id=g and f.id=crew and c.user_id=captain and not c.is_npc) then
    return jsonb_build_object('status','not_in_crew');
  end if;
  previous := private.pirate_captain(g,crew);
  if expected_captain is not null and previous is distinct from expected_captain then
    return jsonb_build_object('status','captain_changed');
  end if;
  if previous=captain then return jsonb_build_object('status','ok','captain_id',captain); end if;
  insert into private.pirate_captains(game_id,faction_id,profile_id) values(g,crew,captain)
  on conflict on constraint pirate_captains_pkey do update set profile_id=excluded.profile_id;
  perform private.pirate_audit(g,actor,'captain',clean_reason,jsonb_build_object('crew',crew,'captain',previous),
    jsonb_build_object('crew',crew,'captain',captain));
  perform private.emit_pirate_crew_event(g,crew,'pirate_ruling',jsonb_build_object('action','captain',
    'reason',clean_reason,'captain_id',captain,'message','The Admiralty replaced the captain: ' || clean_reason));
  return jsonb_build_object('status','ok','captain_id',captain);
end;
$$;
revoke all on function public.gm_replace_captain(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.gm_replace_captain(uuid,uuid,uuid,text,uuid) to authenticated;

-- Both ordinary player claims and GM claims share the same award path.
create function private.pirate_award_riddle(g uuid, zone uuid, crew uuid, actor uuid, via_gm boolean, reason text)
returns jsonb language plpgsql set search_path = '' as $$
declare site record; claim_id uuid; solve_rank integer; payout integer; payouts jsonb; result jsonb;
begin
  select s.*,z.name as site_name into site from private.pirate_sites s join public.zones z on z.id=s.zone_id
  where s.game_id=g and s.zone_id=zone and s.kind='riddle';
  if not found then return jsonb_build_object('status','not_riddle'); end if;
  if exists(select 1 from private.pirate_claims c where c.game_id=g and c.zone_id=zone and c.faction_id=crew and c.voided_at is null) then
    return jsonb_build_object('status','already_claimed');
  end if;
  select count(*)::integer+1 into solve_rank from private.pirate_claims c where c.zone_id=zone and c.voided_at is null;
  payouts := private.pirate_settings(g)->'riddle_payouts';
  payout := (payouts->>least(solve_rank-1,jsonb_array_length(payouts)-1))::integer;
  insert into private.pirate_claims(game_id,zone_id,faction_id,claimed_by,rank,via_gm,gm_reason)
  values(g,zone,crew,actor,solve_rank,via_gm,reason) returning id into claim_id;
  if payout>0 then
    insert into private.pirate_ledger(game_id,faction_id,currency,delta,source,ref_id,actor_id,reason)
    values(g,crew,'doubloon',payout,'riddle',claim_id,actor,reason);
  end if;
  if site.reward='bearing' then
    insert into private.pirate_ledger(game_id,faction_id,currency,delta,source,ref_id,actor_id,reason)
    values(g,crew,'bearing',1,'riddle',claim_id,actor,reason);
    result := jsonb_build_object('status','ok','reward','bearing','amount',1);
  else
    result := jsonb_build_object('status','ok','reward','oath','oath_index',site.oath_index,'oath_word',site.oath_word);
  end if;
  return result || jsonb_build_object('claim_id',claim_id,'doubloons',payout,'rank',solve_rank,'site_name',site.site_name);
end;
$$;
revoke all on function private.pirate_award_riddle(uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;

create function public.gm_claim_for(g uuid, crew uuid, zone_id uuid, reason text, idem uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.pirate_require_gm(g); clean_reason text := btrim(reason); fingerprint text; prior record; result jsonb;
begin
  if crew is null or zone_id is null or idem is null or clean_reason is null or char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode='22023',message='crew, riddle, request ID and correction reason are required';
  end if;
  fingerprint := encode(extensions.digest(jsonb_build_array(crew,zone_id,clean_reason)::text,'sha256'),'hex');
  select r.request_hash,r.result into prior from private.pirate_gm_claim_requests r where r.game_id=g and r.actor_id=actor and r.idem=gm_claim_for.idem;
  if found then
    if prior.request_hash<>fingerprint then return jsonb_build_object('status','idempotency_conflict'); end if;
    return prior.result;
  end if;
  if not exists(select 1 from public.factions f where f.id=crew and f.game_id=g) then
    raise exception using errcode='22023',message='crew is not in this game';
  end if;
  result := private.pirate_award_riddle(g,zone_id,crew,actor,true,clean_reason);
  if result->>'status' not in ('ok','already_claimed') then return result; end if;
  insert into private.pirate_gm_claim_requests(game_id,actor_id,idem,request_hash,result) values(g,actor,idem,fingerprint,result);
  if result->>'status'='ok' then
    perform private.pirate_audit(g,actor,'claim',clean_reason,null,
      (result - 'oath_word') || jsonb_build_object('crew',crew,'zone_id',zone_id));
    perform private.emit_pirate_crew_event(g,crew,'pirate_claim',result || jsonb_build_object('via_gm',true,'reason',clean_reason,
      'message','The Admiralty granted your crew a riddle claim: ' || clean_reason));
  end if;
  return result;
end;
$$;
revoke all on function public.gm_claim_for(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.gm_claim_for(uuid,uuid,uuid,text,uuid) to authenticated;
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
  solver_name text;
  result jsonb;
  cfg jsonb;
  locked_until timestamptz;
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
  cfg := private.pirate_settings(g);
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

  select max(attempt.lockout_until) into locked_until from private.pirate_attempts attempt
  where attempt.game_id=g and attempt.zone_id=site.zone_id and attempt.faction_id=crew_id
    and attempt.lockout_until>now();
  if locked_until is not null then
    return pg_catalog.jsonb_build_object('status','locked_out','remaining_seconds',
      pg_catalog.ceil(extract(epoch from locked_until-now()))::integer);
  end if;
  select count(*)::integer into wrong_count from private.pirate_attempts attempt
  where attempt.game_id = g and attempt.zone_id = site.zone_id
    and attempt.faction_id = crew_id and not attempt.ok and attempt.lockout_until is null
    and attempt.created_at > now() - pg_catalog.make_interval(secs => (cfg->>'answer_lockout_seconds')::integer);
  if wrong_count >= (cfg->>'answer_attempt_limit')::integer then
    return pg_catalog.jsonb_build_object('status', 'locked_out', 'remaining_seconds', (cfg->>'answer_lockout_seconds')::integer);
  end if;
  answer_digest := pg_catalog.encode(
    extensions.digest(normalized || ':' || site.zone_id::text, 'sha256'), 'hex');
  if site.answer_hash is null or normalized = '' or answer_digest <> site.answer_hash then
    result := pg_catalog.jsonb_build_object('status', case when wrong_count + 1 >= (cfg->>'answer_attempt_limit')::integer then 'locked_out' else 'wrong' end,
      'attempts_remaining', greatest(0, (cfg->>'answer_attempt_limit')::integer - wrong_count - 1),
      'remaining_seconds', case when wrong_count + 1 >= (cfg->>'answer_attempt_limit')::integer then (cfg->>'answer_lockout_seconds')::integer else 0 end);
    insert into private.pirate_attempts (
      game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result, lockout_until
    ) values (g, site.zone_id, crew_id, caller, idem, request_hash, false, result,
      case when result->>'status'='locked_out' then now()+pg_catalog.make_interval(secs => (cfg->>'answer_lockout_seconds')::integer) end);
    return result;
  end if;

  result := private.pirate_award_riddle(g, site.zone_id, crew_id, caller, false, null);
  insert into private.pirate_attempts (
    game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
  ) values (g, site.zone_id, crew_id, caller, idem, request_hash, true, result);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_claim', result);
  return result;
end;
$$;

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
  if pg_catalog.abs(next_index - current_index) <> 1 then
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
        treasure_value = least(1000, pg_catalog.round(leader.balance * (private.pirate_settings(g)->>'treasure_percent')::numeric / 100)::integer),
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
                    else 'active' end
  where id = g;
  perform private.pirate_audit(g,caller,'phase',coalesce(nullif(clean_message,''),'Phase correction'),
    pg_catalog.jsonb_build_object('phase',current_phase),pg_catalog.jsonb_build_object('phase',next_phase));
  perform private.emit_pirate_event(g, 'pirate_phase', pg_catalog.jsonb_build_object(
    'phase', next_phase, 'message', coalesce(nullif(clean_message, ''),
      'Pirate phase: ' || next_phase)
  ));
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', next_phase);
end;
$$;

create or replace function public.open_parley(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  cfg jsonb;
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  code_bytes bytea;
  new_code text;
  code_available boolean := false;
  session_id uuid;
  expires_at timestamptz;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null then raise exception using errcode = '22023', message = 'game is required'; end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  cfg := private.pirate_settings(g);
  perform private.pirate_sweep_parleys(g);
  blocked := private.pirate_parley_presence(g, caller, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  if exists (select 1 from private.pirate_mercy mercy
             where mercy.game_id = g and mercy.faction_id = crew_id and mercy.until_at > now()) then
    return pg_catalog.jsonb_build_object('status', 'mercy');
  end if;
  select id, code, code_expires_at, target_profile into session
  from private.pirate_parleys parley
  where parley.game_id = g and parley.target_faction = crew_id
    and parley.state = 'open' and parley.voided_at is null
  order by parley.created_at desc limit 1;
  if found then
    if session.target_profile = caller then
      return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
        'code', session.code, 'code_expires_at', session.code_expires_at);
    end if;
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and parley.state in ('joined', 'yielded', 'fighting', 'awaiting_choice', 'disputed')
               and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)) then
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  for attempts in 1..10 loop
    code_bytes := extensions.gen_random_bytes(2);
    new_code := pg_catalog.lpad(((pg_catalog.get_byte(code_bytes, 0) * 256
      + pg_catalog.get_byte(code_bytes, 1)) % 10000)::text, 4, '0');
    if not exists (select 1 from private.pirate_parleys parley
                   where parley.game_id = g and parley.code = new_code
                     and parley.state = 'open') then
      code_available := true;
      exit;
    end if;
  end loop;
  if not code_available then
    raise exception using errcode = '55000', message = 'could not allocate a Parley code';
  end if;
  insert into private.pirate_parleys (
    game_id, target_faction, target_profile, code, code_expires_at, state, rules
  ) values (g, crew_id, caller, new_code, now() + pg_catalog.make_interval(secs => (cfg->>'code_ttl_seconds')::integer), 'open', cfg)
  returning id, code_expires_at into session_id, expires_at;
  perform private.emit_pirate_parley_event(g, session_id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session_id,
    'code', new_code, 'code_expires_at', expires_at);
end;
$$;

create or replace function public.join_parley(g uuid, code text, idem uuid)
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
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  previous record;
  recent_count integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or code is null or code !~ '^[0-9]{4}$' or idem is null then
    raise exception using errcode = '22023', message = 'game, four-digit code and request ID are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select parley.id, parley.code, parley.state into previous
  from private.pirate_parleys parley
  where parley.game_id = g and parley.attacker_profile = caller and parley.join_idem = idem;
  if found then
    return pg_catalog.jsonb_build_object('status', case when previous.code = code then 'ok' else 'idempotency_conflict' end,
      'parley_id', previous.id, 'state', previous.state);
  end if;
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select parley.id, parley.target_faction, parley.target_profile, parley.rules into session
  from private.pirate_parleys parley
  where parley.game_id = g and parley.code = join_parley.code
    and parley.state = 'open' and parley.code_expires_at > now() and parley.voided_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'invalid_code'); end if;
  if session.target_faction = crew_id then return pg_catalog.jsonb_build_object('status', 'same_crew'); end if;
  blocked := private.pirate_parley_pair_presence(g, caller, session.target_profile, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  if exists (select 1 from private.pirate_mercy mercy
             where mercy.game_id = g and mercy.faction_id in (crew_id, session.target_faction)
               and mercy.until_at > now()) then
    return pg_catalog.jsonb_build_object('status', 'mercy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and private.pirate_parley_live(parley.state)
               and parley.id <> session.id
               and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)) then
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and parley.state in ('resolved', 'disputed')
               and coalesce(parley.pair_cooldown_until,parley.updated_at + pg_catalog.make_interval(secs => (parley.rules->>'pair_cooldown_seconds')::integer)) > now()
               and ((parley.target_faction = session.target_faction and parley.attacker_faction = crew_id)
                 or (parley.target_faction = crew_id and parley.attacker_faction = session.target_faction))) then
    return pg_catalog.jsonb_build_object('status', 'pair_cooldown');
  end if;
  select count(*)::integer into recent_count from private.pirate_parleys parley
  where parley.game_id = g and parley.attacker_faction = crew_id
    and parley.created_at > now() - pg_catalog.make_interval(secs => (session.rules->>'attack_window_seconds')::integer) and parley.voided_at is null;
  if recent_count >= (session.rules->>'attack_limit')::integer then return pg_catalog.jsonb_build_object('status', 'hourly_limit'); end if;
  update private.pirate_parleys
  set attacker_faction = crew_id, attacker_profile = caller, join_idem = idem,
      far_apart = false, state = 'joined', updated_at = now()
  where id = session.id;
  perform private.emit_pirate_parley_event(g, session.id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
    'state', 'joined', 'far_apart', false);
end;
$$;

create or replace function private.pirate_sweep_parleys(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare expired record;
begin
  for expired in
    update private.pirate_parleys parley
    set state = 'expired', updated_at = now()
    where parley.game_id = p_game_id and parley.state = 'open'
      and parley.code_expires_at <= now() and parley.voided_at is null
    returning parley.id
  loop
    perform private.emit_pirate_parley_event(p_game_id, expired.id);
  end loop;
  for expired in
    update private.pirate_parleys parley
    set state = 'disputed', updated_at = now()
    where parley.game_id = p_game_id
      and parley.state in ('joined', 'yielded', 'fighting', 'awaiting_choice')
      and parley.updated_at <= now() - pg_catalog.make_interval(secs => (parley.rules->>'session_timeout_seconds')::integer) and parley.voided_at is null
    returning parley.id
  loop
    perform private.pirate_queue_dispute(p_game_id, expired.id, 'Parley timed out');
    perform private.emit_pirate_parley_event(p_game_id, expired.id);
  end loop;
end;
$$;

create or replace function private.pirate_resolve_transfer(
  p_game_id uuid, p_parley_id uuid, p_winner uuid, p_loser uuid,
  p_currency text, p_amount integer, p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
declare cfg jsonb;
begin
  select rules into cfg from private.pirate_parleys where id=p_parley_id and game_id=p_game_id;
  if p_amount < 0 or p_amount > private.pirate_parley_balance(p_game_id, p_loser, p_currency) then
    raise exception using errcode = '55000', message = 'Parley transfer would overdraw a crew';
  end if;
  if p_amount > 0 then
    insert into private.pirate_ledger (
      game_id, faction_id, currency, delta, source, ref_id, actor_id
    ) values
      (p_game_id, p_loser, p_currency, -p_amount, 'parley', p_parley_id, p_actor),
      (p_game_id, p_winner, p_currency, p_amount, 'parley', p_parley_id, p_actor);
  end if;
  update private.pirate_parleys
  set state = 'resolved', winner_faction = p_winner, plunder = p_currency, updated_at = now(),
      pair_cooldown_until = now() + pg_catalog.make_interval(secs => (cfg->>'pair_cooldown_seconds')::integer)
  where id = p_parley_id and game_id = p_game_id;
  insert into private.pirate_mercy (game_id, faction_id, until_at, source_parley_id)
  values (p_game_id, p_loser, now() + pg_catalog.make_interval(secs => (cfg->>'mercy_seconds')::integer), p_parley_id)
  on conflict (game_id, faction_id) do update
    set until_at = excluded.until_at, source_parley_id = excluded.source_parley_id;
  perform private.emit_pirate_parley_event(p_game_id, p_parley_id);
end;
$$;

create or replace function public.parley_report(g uuid, parley_id uuid, winner_faction uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  target_vote uuid;
  attacker_vote uuid;
  amount integer;
  loser_balance integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or winner_faction is null then
    raise exception using errcode = '22023', message = 'game, Parley and winner are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, attacker_profile, target_faction, attacker_faction,
         target_report, attacker_report, choice, state , rules into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if caller is distinct from session.target_profile
     and caller is distinct from session.attacker_profile then
    raise exception using errcode = '42501', message = 'only the two Parley players may report';
  end if;
  if winner_faction is distinct from session.target_faction
     and winner_faction is distinct from session.attacker_faction then
    raise exception using errcode = '22023', message = 'winner must be one of the two crews';
  end if;
  target_vote := session.target_report;
  attacker_vote := session.attacker_report;
  if caller = session.target_profile then
    if target_vote is not null and target_vote <> winner_faction then
      return pg_catalog.jsonb_build_object('status', 'already_reported');
    end if;
    target_vote := winner_faction;
  else
    if attacker_vote is not null and attacker_vote <> winner_faction then
      return pg_catalog.jsonb_build_object('status', 'already_reported');
    end if;
    attacker_vote := winner_faction;
  end if;
  if session.state not in ('yielded', 'fighting') then
    if target_vote = session.target_report and attacker_vote = session.attacker_report then
      return pg_catalog.jsonb_build_object('status', 'ok', 'state', session.state);
    end if;
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  if (caller = session.target_profile and session.target_report = winner_faction)
     or (caller = session.attacker_profile and session.attacker_report = winner_faction) then
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'awaiting_report');
  end if;
  blocked := private.pirate_parley_pair_presence(g, caller,
    case when caller = session.target_profile then session.attacker_profile else session.target_profile end,
    phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  update private.pirate_parleys
  set target_report = target_vote, attacker_report = attacker_vote, updated_at = now()
  where id = parley_id;
  if target_vote is null or attacker_vote is null then
    perform private.emit_pirate_parley_event(g, parley_id);
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'awaiting_report');
  end if;
  if target_vote <> attacker_vote
     or (session.choice = 'yield' and target_vote <> session.attacker_faction) then
    update private.pirate_parleys set state = 'disputed', updated_at = now() where id = parley_id;
    perform private.pirate_queue_dispute(g, parley_id, 'Players disagreed on the Parley outcome');
    perform private.emit_pirate_parley_event(g, parley_id);
    return pg_catalog.jsonb_build_object('status', 'disputed', 'state', 'disputed');
  end if;
  if session.choice = 'yield' then
    loser_balance := private.pirate_parley_balance(g, session.target_faction, 'doubloon');
    amount := least(loser_balance, greatest((session.rules->>'yield_min')::integer, pg_catalog.ceil(loser_balance * (session.rules->>'yield_percent')::numeric / 100)::integer));
    perform private.pirate_resolve_transfer(g, parley_id, session.attacker_faction,
      session.target_faction, 'doubloon', amount, caller);
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved', 'amount', amount);
  end if;
  update private.pirate_parleys
  set state = 'awaiting_choice', winner_faction = target_vote, updated_at = now()
  where id = parley_id;
  perform private.emit_pirate_parley_event(g, parley_id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'awaiting_choice',
    'winner_faction', target_vote);
end;
$$;

create or replace function public.parley_plunder(g uuid, parley_id uuid, currency text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  winner_profile uuid;
  loser uuid;
  loser_balance integer;
  amount integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or currency is null or currency not in ('bearing', 'doubloon') then
    raise exception using errcode = '22023', message = 'game, Parley and plunder choice are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, attacker_profile, target_faction, attacker_faction,
         winner_faction, choice, state, plunder , rules into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  winner_profile := case when session.winner_faction = session.target_faction
                     then session.target_profile else session.attacker_profile end;
  if session.winner_faction is null or caller <> winner_profile then
    raise exception using errcode = '42501', message = 'only the winning Parley player may choose plunder';
  end if;
  if session.state = 'resolved' and session.plunder = currency then
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved',
      'currency', currency, 'amount', coalesce((select sum(ledger.delta)::integer
        from private.pirate_ledger ledger where ledger.game_id = g
          and ledger.ref_id = parley_id and ledger.source = 'parley'
          and ledger.faction_id = session.winner_faction and ledger.currency = parley_plunder.currency), 0));
  end if;
  if session.state <> 'awaiting_choice' or session.choice <> 'fight' then
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  blocked := private.pirate_parley_pair_presence(g, caller,
    case when caller = session.target_profile then session.attacker_profile else session.target_profile end,
    phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  loser := case when session.winner_faction = session.target_faction
                then session.attacker_faction else session.target_faction end;
  loser_balance := private.pirate_parley_balance(g, loser, currency);
  if currency = 'bearing' then
    if loser_balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
    amount := 1;
  else
    amount := least(loser_balance, greatest((session.rules->>'fight_min')::integer, pg_catalog.ceil(loser_balance * (session.rules->>'fight_percent')::numeric / 100)::integer));
  end if;
  perform private.pirate_resolve_transfer(g, parley_id, session.winner_faction,
    loser, currency, amount, caller);
  return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved',
    'currency', currency, 'amount', amount);
end;
$$;

create or replace function public.gm_resolve_parley(
  g uuid, parley_id uuid, winner_faction uuid, currency text, reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  session record;
  loser uuid;
  balance integer;
  amount integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or winner_faction is null or currency is null
     or currency not in ('bearing', 'doubloon') or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'Parley ruling needs winner, currency and reason';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  perform private.pirate_sweep_parleys(g);
  select target_faction, attacker_faction, choice, state, voided_at , rules into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.voided_at is not null then return pg_catalog.jsonb_build_object('status', 'voided'); end if;
  if session.state <> 'disputed' then return pg_catalog.jsonb_build_object('status', 'wrong_state'); end if;
  if session.choice is null then return pg_catalog.jsonb_build_object('status', 'no_exchange'); end if;
  if winner_faction is distinct from session.target_faction
     and winner_faction is distinct from session.attacker_faction then
    raise exception using errcode = '22023', message = 'winner must be a Parley crew';
  end if;
  if session.choice = 'yield' and (winner_faction <> session.attacker_faction or currency <> 'doubloon') then
    return pg_catalog.jsonb_build_object('status', 'yield_requires_attacker_doubloons');
  end if;
  loser := case when winner_faction = session.target_faction
                then session.attacker_faction else session.target_faction end;
  balance := private.pirate_parley_balance(g, loser, currency);
  if session.choice = 'yield' then
    amount := least(balance, greatest((session.rules->>'yield_min')::integer, pg_catalog.ceil(balance * (session.rules->>'yield_percent')::numeric / 100)::integer));
  elsif currency = 'bearing' then
    if balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
    amount := 1;
  else
    amount := least(balance, greatest((session.rules->>'fight_min')::integer, pg_catalog.ceil(balance * (session.rules->>'fight_percent')::numeric / 100)::integer));
  end if;
  update private.pirate_parleys
  set resolved_by = caller, resolution_reason = clean_reason, updated_at = now()
  where id = parley_id;
  perform private.pirate_resolve_transfer(g, parley_id, winner_faction, loser, currency, amount, caller);
  update public.game_events
  set status = 'confirmed', resolved_at = now(), resolved_by = caller
  where game_id = g and type = 'pirate_dispute' and status = 'pending'
    and payload->>'parley_id' = parley_id::text;
  perform private.emit_pirate_crew_event(g, session.target_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'resolve_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty ruled on a Parley.'));
  perform private.emit_pirate_crew_event(g, session.attacker_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'resolve_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty ruled on a Parley.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'amount', amount, 'currency', currency);
end;
$$;

create or replace function public.get_pirate_state(g uuid)
returns jsonb
language plpgsql
volatile
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
  -- Lock before reading phase/settings so a refresh waiting behind a GM
  -- mutation returns the new state and sweeps the same authoritative state.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled
    into phase_name, is_paused, is_pvp_enabled
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;
  perform private.pirate_sweep_parleys(g);
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
    'plunder', parley.plunder, 'far_apart', parley.far_apart, 'rules', parley.rules)
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
    'settings', private.pirate_settings(g), 'readings', reading_list, 'mercy_until', mercy_end, 'active_parley', parley_info,
    'site_here', public.site_here(g),
    'band', case when is_captain then public.treasure_band(g)->>'band' end);
end;
$$;

-- GPS alerts disclose locations only through the existing GM-only overview.
create function private.pirate_crew_alerts(g uuid)
returns jsonb language sql stable set search_path = '' as $$
  with members as (
    select gp.profile_id,gp.sharing_enabled,c.faction_id,coalesce(c.name,p.username,'Player') as name,
      pos.recorded_at,pos.geog,
      gp.sharing_enabled and pos.recorded_at>=now()-interval '120 seconds' as fresh
    from public.game_players gp join public.profiles p on p.id=gp.profile_id
    left join public.characters c on c.game_id=gp.game_id and c.user_id=gp.profile_id and not c.is_npc
    left join public.player_positions pos on pos.game_id=gp.game_id and pos.profile_id=gp.profile_id
    where gp.game_id=g and gp.role='player'
  ), crew_alerts as (
    select f.id as crew_id,coalesce(f.name,'Unassigned') as crew_name,
      coalesce(jsonb_agg(jsonb_build_object('profile_id',m.profile_id,'name',m.name,
        'last_fix_at',m.recorded_at,'sharing_enabled',m.sharing_enabled) order by m.name)
        filter(where m.fresh is not true),'[]'::jsonb) as stale_players,
      count(*) filter(where m.fresh)::integer as fresh_players,
      (select round(max(extensions.st_distance(a.geog,b.geog)))::integer
        from members a join members b on a.faction_id=b.faction_id and a.profile_id<b.profile_id
        where a.faction_id=f.id and a.fresh and b.fresh) as spread_m
    from members m left join public.factions f on f.id=m.faction_id and f.game_id=g
    group by f.id,f.name
  )
  select coalesce(jsonb_agg(to_jsonb(a) order by a.crew_name),'[]'::jsonb) from crew_alerts a
  where jsonb_array_length(stale_players)>0 or spread_m>150;
$$;
revoke all on function private.pirate_crew_alerts(uuid) from public,anon,authenticated;

create index pirate_parleys_history_idx on private.pirate_parleys(game_id,created_at desc,id desc);
create index pirate_ledger_game_history_idx on private.pirate_ledger(game_id,created_at desc,id desc);

create function public.gm_pirate_history(g uuid, kind text default 'ledger', crew uuid default null,
  page_cursor jsonb default null, page_size integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare rows jsonb; page jsonb; last_row jsonb; cursor_at timestamptz; cursor_id text;
begin
  perform private.pirate_require_gm(g);
  if kind is null or kind not in ('ledger','readings','parleys','claims','audit')
    or page_size is null or page_size not between 1 and 100 then
    raise exception using errcode='22023',message='choose a history kind and page size from 1 to 100';
  end if;
  if crew is not null and not exists(select 1 from public.factions f where f.id=crew and f.game_id=g) then
    raise exception using errcode='22023',message='crew is not in this game';
  end if;
  if page_cursor is not null then
    if jsonb_typeof(page_cursor)<>'object' or jsonb_typeof(page_cursor->'at') is distinct from 'string'
      or jsonb_typeof(page_cursor->'id') is distinct from 'string' then
      raise exception using errcode='22023',message='invalid history cursor';
    end if;
    cursor_at := (page_cursor->>'at')::timestamptz; cursor_id := page_cursor->>'id';
  end if;
  perform private.pirate_sweep_parleys(g);
  with entries as (
    select l.id::text as id,l.created_at as at,jsonb_build_object('id',l.id::text,'at',l.created_at,
      'crew_name',f.name,'actor_name',p.username,'currency',l.currency,'delta',l.delta,
      'source',l.source,'ref_id',l.ref_id,'reason',l.reason) as data
    from private.pirate_ledger l join public.factions f on f.id=l.faction_id left join public.profiles p on p.id=l.actor_id
    where kind='ledger' and l.game_id=g and (crew is null or l.faction_id=crew)
    union all
    select r.id::text,r.created_at,jsonb_build_object('id',r.id::text,'at',r.created_at,'crew_name',f.name,
      'actor_name',p.username,'site_name',z.name,'shards',r.shards,'centre_deg',r.centre_deg,
      'half_width_deg',r.half_width_deg,'voided_at',r.voided_at,'reason',r.void_reason)
    from private.pirate_readings r join public.factions f on f.id=r.faction_id join public.zones z on z.id=r.zone_id
    left join public.profiles p on p.id=r.taken_by
    where kind='readings' and r.game_id=g and (crew is null or r.faction_id=crew)
    union all
    select s.id::text,s.created_at,jsonb_build_object('id',s.id::text,'at',s.created_at,'target_name',f.name,
      'attacker_name',a.name,'winner_name',w.name,'state',s.state,'choice',s.choice,'plunder',s.plunder,
      'target_report',s.target_report,'attacker_report',s.attacker_report,'updated_at',s.updated_at,
      'rules',s.rules,'reason',coalesce(s.void_reason,s.resolution_reason),'actor_name',p.username,
      'transferred',(select coalesce(sum(l.delta) filter(where l.delta>0),0) from private.pirate_ledger l
        where l.game_id=g and l.ref_id=s.id and l.source='parley'),'voided_at',s.voided_at)
    from private.pirate_parleys s join public.factions f on f.id=s.target_faction
    left join public.factions a on a.id=s.attacker_faction left join public.factions w on w.id=s.winner_faction
    left join public.profiles p on p.id=coalesce(s.voided_by,s.resolved_by)
    where kind='parleys' and s.game_id=g and (crew is null or crew in (s.target_faction,s.attacker_faction))
    union all
    select c.id::text,c.created_at,jsonb_build_object('id',c.id::text,'at',c.created_at,'crew_name',f.name,
      'site_name',z.name,'actor_name',p.username,'rank',c.rank,'via_gm',c.via_gm,'reason',coalesce(c.void_reason,c.gm_reason),
      'voided_at',c.voided_at)
    from private.pirate_claims c join public.factions f on f.id=c.faction_id join public.zones z on z.id=c.zone_id
    left join public.profiles p on p.id=c.claimed_by
    where kind='claims' and c.game_id=g and (crew is null or c.faction_id=crew)
    union all
    select a.id::text,a.created_at,jsonb_build_object('id',a.id::text,'at',a.created_at,'action',a.action,
      'actor_name',p.username,'reason',a.reason,'before',a.before_state,'after',a.after_state)
    from private.pirate_gm_audit a left join public.profiles p on p.id=a.actor_id
    where kind='audit' and a.game_id=g and (crew is null or a.after_state->>'crew'=crew::text)
  )
  select coalesce(jsonb_agg(data order by at desc,id desc),'[]'::jsonb) into rows
  from (select * from entries where page_cursor is null or (at,id)<(cursor_at,cursor_id)
    order by at desc,id desc limit page_size+1) bounded;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into page
  from jsonb_array_elements(rows) with ordinality where ordinality<=page_size;
  last_row := page->(jsonb_array_length(page)-1);
  return jsonb_build_object('items',page,'next_cursor',case when jsonb_array_length(rows)>page_size
    then jsonb_build_object('at',last_row->>'at','id',last_row->>'id') end);
end;
$$;
revoke all on function public.gm_pirate_history(uuid,text,uuid,jsonb,integer) from public,anon;
grant execute on function public.gm_pirate_history(uuid,text,uuid,jsonb,integer) to authenticated;

create or replace function public.gm_pirate_overview(g uuid)
returns jsonb
language plpgsql
volatile
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
  -- Lock before reading phase/settings so a refresh waiting behind a GM
  -- mutation returns the new state and sweeps the same authoritative state.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled,
         pirate.treasure_geog, pirate.treasure_value, pirate.treasure_basis, pirate.treasure_frozen_at
    into game_phase, game_paused, pvp_on, treasure, treasure_amount, treasure_basis_amount, treasure_frozen
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;
  perform private.pirate_sweep_parleys(g);

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
    'reward', site.reward, 'oath_index', site.oath_index, 'prompt', site.prompt,
    'answer_set', site.answer_hash is not null,
    'active', zone.active,
    'claims', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', claim.id, 'faction_id', claim.faction_id, 'crew_name', crew.name,
      'claimed_by_name', coalesce(solver.name,actor.username), 'rank', claim.rank,
      'via_gm',claim.via_gm,'gm_reason',claim.gm_reason,
      'claimed_at', claim.created_at) order by claim.created_at)
      from private.pirate_claims claim
      join public.factions crew on crew.id = claim.faction_id
      left join public.profiles actor on actor.id=claim.claimed_by
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
    'winner_faction', parley.winner_faction, 'plunder', parley.plunder, 'rules', parley.rules,
    'far_apart', parley.far_apart, 'created_at', parley.created_at
  ) order by parley.created_at desc), '[]'::jsonb) into parley_rows
  from private.pirate_parleys parley
  join public.factions target on target.id = parley.target_faction
  left join public.factions attacker on attacker.id = parley.attacker_faction
  where parley.game_id = g and parley.voided_at is null
    and private.pirate_parley_live(parley.state);

  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'phase', game_phase, 'paused', game_paused,
    'pvp_enabled', pvp_on, 'settings', private.pirate_settings(g), 'alerts', private.pirate_crew_alerts(g),
    'treasure', case when treasure is null then null else pg_catalog.jsonb_build_object(
      'lat', extensions.st_y(treasure::extensions.geometry),
      'lng', extensions.st_x(treasure::extensions.geometry),
      'value', treasure_amount, 'basis', treasure_basis_amount,
      'frozen_at', treasure_frozen) end,
    'crews', crew_rows, 'sites', site_rows, 'treasure_award', award_info,
    'parleys', parley_rows);
end;
$$;
