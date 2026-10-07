-- Disagreement stops automated scoring. A GM can rule with an audit reason,
-- or void the Parley and append exact compensating ledger entries.
create function public.gm_resolve_parley(
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
  select target_faction, attacker_faction, choice, state, voided_at into session
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
    amount := pg_catalog.least(balance, pg_catalog.greatest(3, pg_catalog.ceil(balance * 0.10)::integer));
  elsif currency = 'bearing' then
    if balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
    amount := 1;
  else
    amount := pg_catalog.least(balance, pg_catalog.greatest(5, pg_catalog.ceil(balance * 0.25)::integer));
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

create function public.gm_void_parley(g uuid, parley_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  session record;
  deficit integer;
  reversal_count integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'Parley and correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select target_faction, attacker_faction, voided_at into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.voided_at is not null then return pg_catalog.jsonb_build_object('status', 'already_voided'); end if;
  select count(*)::integer into deficit from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.ref_id = parley_id and ledger.source = 'parley'
    and ledger.delta > 0
    and private.pirate_parley_balance(g, ledger.faction_id, ledger.currency) < ledger.delta;
  if deficit > 0 then return pg_catalog.jsonb_build_object('status', 'insufficient_balance'); end if;
  insert into private.pirate_ledger (
    game_id, faction_id, currency, delta, source, ref_id, reason, actor_id
  ) select g, ledger.faction_id, ledger.currency, -ledger.delta,
           'gm', parley_id, clean_reason, caller
    from private.pirate_ledger ledger
    where ledger.game_id = g and ledger.ref_id = parley_id and ledger.source = 'parley';
  get diagnostics reversal_count = row_count;
  update private.pirate_parleys
  set state = 'voided', voided_at = now(), voided_by = caller,
      void_reason = clean_reason, updated_at = now()
  where id = parley_id;
  delete from private.pirate_mercy mercy
  where mercy.game_id = g and mercy.source_parley_id = parley_id;
  update public.game_events
  set status = 'dismissed', resolved_at = now(), resolved_by = caller
  where game_id = g and type = 'pirate_dispute' and status = 'pending'
    and payload->>'parley_id' = parley_id::text;
  perform private.emit_pirate_parley_event(g, parley_id);
  perform private.emit_pirate_crew_event(g, session.target_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'void_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty voided a Parley.'));
  if session.attacker_faction is not null then
    perform private.emit_pirate_crew_event(g, session.attacker_faction, 'pirate_ruling',
      pg_catalog.jsonb_build_object('action', 'void_parley', 'reason', clean_reason,
        'parley_id', parley_id, 'message', 'The Admiralty voided a Parley.'));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reversal_rows', reversal_count);
end;
$$;

revoke all on function public.gm_resolve_parley(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.gm_void_parley(uuid, uuid, text) from public, anon;
grant execute on function public.gm_resolve_parley(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.gm_void_parley(uuid, uuid, text) to authenticated;
