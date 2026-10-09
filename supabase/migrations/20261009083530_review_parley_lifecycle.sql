-- Review fixes, 2026-10-09. Applied migrations remain immutable.
-- Owner decision: enforce proximity and recheck both positions at every step.
-- Existing public RPC signatures and grants are preserved by CREATE OR REPLACE.

-- One presence check for both participants, used before every new decision.
-- The owner requires <=75 m, fresh fixes (<=120 s), and neither player
-- within the hoard's 100 m exclusion. Status names are relative to the caller.
create function private.pirate_parley_pair_presence(
  p_game_id uuid, p_actor uuid, p_other uuid, p_phase text,
  p_treasure extensions.geography
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare blocked text; own_point extensions.geography; other_point extensions.geography;
begin
  blocked := private.pirate_parley_presence(p_game_id, p_actor, p_phase, p_treasure);
  if blocked is not null then return blocked; end if;
  blocked := private.pirate_parley_presence(p_game_id, p_other, p_phase, p_treasure);
  if blocked is not null then return 'target_' || blocked; end if;
  select position.geog into own_point from public.player_positions position
  where position.game_id = p_game_id and position.profile_id = p_actor;
  select position.geog into other_point from public.player_positions position
  where position.game_id = p_game_id and position.profile_id = p_other;
  if not extensions.st_dwithin(own_point, other_point, 75) then return 'too_far'; end if;
  return null;
end;
$$;
revoke all on function private.pirate_parley_pair_presence(uuid, uuid, uuid, text, extensions.geography)
  from public, anon, authenticated;


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
  select parley.id, parley.target_faction, parley.target_profile into session
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
               and parley.updated_at > now() - interval '30 minutes'
               and ((parley.target_faction = session.target_faction and parley.attacker_faction = crew_id)
                 or (parley.target_faction = crew_id and parley.attacker_faction = session.target_faction))) then
    return pg_catalog.jsonb_build_object('status', 'pair_cooldown');
  end if;
  select count(*)::integer into recent_count from private.pirate_parleys parley
  where parley.game_id = g and parley.attacker_faction = crew_id
    and parley.created_at > now() - interval '1 hour' and parley.voided_at is null;
  if recent_count >= 3 then return pg_catalog.jsonb_build_object('status', 'hourly_limit'); end if;
  update private.pirate_parleys
  set attacker_faction = crew_id, attacker_profile = caller, join_idem = idem,
      far_apart = false, state = 'joined', updated_at = now()
  where id = session.id;
  perform private.emit_pirate_parley_event(g, session.id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
    'state', 'joined', 'far_apart', false);
end;
$$;

create or replace function public.parley_choice(g uuid, parley_id uuid, choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  session record;
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or choice is null or choice not in ('yield', 'fight') then
    raise exception using errcode = '22023', message = 'game, Parley and valid choice are required';
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
  select target_profile, attacker_profile, state, parley.choice as saved_choice into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.target_profile <> caller then
    raise exception using errcode = '42501', message = 'only the target player may choose';
  end if;
  if session.state in ('yielded', 'fighting') and session.saved_choice = choice then
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', session.state);
  end if;
  if session.state <> 'joined' then
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  blocked := private.pirate_parley_pair_presence(g, caller,
    case when caller = session.target_profile then session.attacker_profile else session.target_profile end,
    phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  update private.pirate_parleys
  set choice = parley_choice.choice,
      state = case when parley_choice.choice = 'yield' then 'yielded' else 'fighting' end,
      updated_at = now()
  where id = parley_id;
  perform private.emit_pirate_parley_event(g, parley_id);
  return pg_catalog.jsonb_build_object('status', 'ok',
    'state', case when choice = 'yield' then 'yielded' else 'fighting' end);
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
         target_report, attacker_report, choice, state into session
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
    amount := least(loser_balance, greatest(3, pg_catalog.ceil(loser_balance * 0.10)::integer));
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
         winner_faction, choice, state, plunder into session
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
    amount := least(loser_balance, greatest(5, pg_catalog.ceil(loser_balance * 0.25)::integer));
  end if;
  perform private.pirate_resolve_transfer(g, parley_id, session.winner_faction,
    loser, currency, amount, caller);
  return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved',
    'currency', currency, 'amount', amount);
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

create or replace function public.gm_adjust(g uuid, crew uuid, currency text, delta integer, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  crew_name text;
  balance integer;
  amount_text text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or crew is null or gm_adjust.currency is null or gm_adjust.delta is null
     or gm_adjust.currency not in ('bearing', 'doubloon')
     or gm_adjust.delta = 0 or gm_adjust.delta not between -1000 and 1000
     or clean_reason is null or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023',
      message = 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if not exists (select 1 from private.pirate_games pirate where pirate.game_id = g) then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  select faction.name into crew_name from public.factions faction
  where faction.id = gm_adjust.crew and faction.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;

  balance := private.pirate_parley_balance(g, gm_adjust.crew, gm_adjust.currency);
  if balance + gm_adjust.delta < 0 then
    return pg_catalog.jsonb_build_object('status', 'insufficient_balance', 'balance', balance);
  end if;

  insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, reason, actor_id)
  values (g, gm_adjust.crew, gm_adjust.currency, gm_adjust.delta, 'gm', clean_reason, caller);
  amount_text := case when gm_adjust.delta > 0 then '+' else '-' end
    || pg_catalog.abs(gm_adjust.delta)::text
    || case when gm_adjust.currency = 'bearing' then ' bearing shard' else ' doubloon' end
    || case when pg_catalog.abs(gm_adjust.delta) = 1 then '' else 's' end;
  perform private.emit_pirate_crew_event(g, gm_adjust.crew, 'pirate_ruling', pg_catalog.jsonb_build_object(
    'action', 'adjust', 'currency', gm_adjust.currency, 'delta', gm_adjust.delta,
    'reason', clean_reason,
    'message', 'The Admiralty has ruled: ' || amount_text || ' for ' || crew_name || '. ' || clean_reason));
  return pg_catalog.jsonb_build_object('status', 'ok', 'currency', gm_adjust.currency,
    'delta', gm_adjust.delta, 'balance', balance + gm_adjust.delta);
end;
$$;
