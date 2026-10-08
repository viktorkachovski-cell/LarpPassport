-- Game guide 7.6, gm_adjust: the GM adds or removes a crew's bearing shards
-- or doubloons, for example to test the compass or to correct an unfair
-- result. It adds a compensating `gm` ledger row with the GM and a mandatory
-- reason; history is never edited. A balance never goes below zero. Only the
-- crew is told (in its logbook), so other crews do not learn its balance.
-- Allowed in every phase. Doubloons added before `hoard` count towards the
-- frozen treasure value, as the guide's GM corrections do.

create function public.gm_adjust(g uuid, crew uuid, currency text, delta integer, reason text)
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
     or gm_adjust.delta = 0 or pg_catalog.abs(gm_adjust.delta) > 1000
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

  select coalesce(sum(ledger.delta), 0)::integer into balance
  from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = gm_adjust.crew
    and ledger.currency = gm_adjust.currency;
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

revoke all on function public.gm_adjust(uuid, uuid, text, integer, text) from public, anon;
grant execute on function public.gm_adjust(uuid, uuid, text, integer, text) to authenticated;
