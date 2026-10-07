-- The on-site Ghost Captain verifies the spoken oath outside the app, then
-- records the one active treasure award for the game.
create function public.gm_award_treasure(g uuid, faction_id uuid, reason text)
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

create function public.gm_void_treasure(g uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  award record;
  amount integer;
  balance integer;
  crew_name text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'game and correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select id, faction_id into award from private.pirate_treasure_awards
  where game_id = g and voided_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_awarded'); end if;
  select coalesce(sum(delta), 0)::integer into amount from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.ref_id = award.id and ledger.source = 'treasure';
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = award.faction_id and ledger.currency = 'doubloon';
  if balance < amount then return pg_catalog.jsonb_build_object('status', 'insufficient_balance'); end if;
  update private.pirate_treasure_awards
  set voided_at = now(), voided_by = caller, void_reason = clean_reason
  where id = award.id;
  if amount > 0 then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, reason, actor_id)
    values (g, award.faction_id, 'doubloon', -amount, 'treasure', award.id, clean_reason, caller);
  end if;
  select faction.name into crew_name from public.factions faction where faction.id = award.faction_id;
  perform private.emit_pirate_event(g, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'void_treasure', 'crew_name', crew_name,
      'reason', clean_reason, 'message', 'The treasure award was corrected by the GM.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'award_id', award.id, 'amount_reversed', amount);
end;
$$;

revoke all on function public.gm_award_treasure(uuid, uuid, text) from public, anon;
revoke all on function public.gm_void_treasure(uuid, text) from public, anon;
grant execute on function public.gm_award_treasure(uuid, uuid, text) to authenticated;
grant execute on function public.gm_void_treasure(uuid, text) to authenticated;
