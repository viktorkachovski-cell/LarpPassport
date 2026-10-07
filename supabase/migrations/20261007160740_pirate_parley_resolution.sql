create function private.pirate_parley_balance(p_game_id uuid, p_faction_id uuid, p_currency text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(ledger.delta), 0)::integer from private.pirate_ledger ledger
  where ledger.game_id = p_game_id and ledger.faction_id = p_faction_id
    and ledger.currency = p_currency;
$$;
revoke all on function private.pirate_parley_balance(uuid, uuid, text) from public, anon, authenticated;

create function private.pirate_resolve_transfer(
  p_game_id uuid, p_parley_id uuid, p_winner uuid, p_loser uuid,
  p_currency text, p_amount integer, p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
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
  set state = 'resolved', winner_faction = p_winner, plunder = p_currency, updated_at = now()
  where id = p_parley_id and game_id = p_game_id;
  insert into private.pirate_mercy (game_id, faction_id, until_at, source_parley_id)
  values (p_game_id, p_loser, now() + interval '15 minutes', p_parley_id)
  on conflict (game_id, faction_id) do update
    set until_at = excluded.until_at, source_parley_id = excluded.source_parley_id;
  perform private.emit_pirate_parley_event(p_game_id, p_parley_id);
end;
$$;
revoke all on function private.pirate_resolve_transfer(uuid, uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated;

-- Yield and Fight both wait for independent reports from the exact two
-- players in the session. Choosing Yield alone never moves currency.
create function public.parley_choice(g uuid, parley_id uuid, choice text)
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
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, state, parley.choice as saved_choice into session
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

create function public.parley_report(g uuid, parley_id uuid, winner_faction uuid)
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
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
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

create function public.parley_plunder(g uuid, parley_id uuid, currency text)
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
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
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
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved');
  end if;
  if session.state <> 'awaiting_choice' or session.choice <> 'fight' then
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
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

revoke all on function public.parley_choice(uuid, uuid, text) from public, anon;
revoke all on function public.parley_report(uuid, uuid, uuid) from public, anon;
revoke all on function public.parley_plunder(uuid, uuid, text) from public, anon;
grant execute on function public.parley_choice(uuid, uuid, text) to authenticated;
grant execute on function public.parley_report(uuid, uuid, uuid) to authenticated;
grant execute on function public.parley_plunder(uuid, uuid, text) to authenticated;
