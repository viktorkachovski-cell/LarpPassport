-- GM-only operational snapshot. The answer hashes and game secret remain private.
create function public.gm_pirate_overview(g uuid)
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
         pirate.treasure_geog, pirate.treasure_value
    into game_phase, game_paused, pvp_on, treasure, treasure_amount
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
    and parley.state in ('open', 'joined', 'yielded', 'fighting', 'awaiting_choice', 'disputed');

  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'phase', game_phase, 'paused', game_paused,
    'pvp_enabled', pvp_on,
    'treasure', case when treasure is null then null else pg_catalog.jsonb_build_object(
      'lat', extensions.st_y(treasure::extensions.geometry),
      'lng', extensions.st_x(treasure::extensions.geometry),
      'value', treasure_amount) end,
    'crews', crew_rows, 'sites', site_rows, 'treasure_award', award_info,
    'parleys', parley_rows);
end;
$$;

revoke all on function public.gm_pirate_overview(uuid) from public, anon;
grant execute on function public.gm_pirate_overview(uuid) to authenticated;
