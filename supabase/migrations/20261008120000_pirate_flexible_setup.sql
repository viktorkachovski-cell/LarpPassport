-- Owner decision 2026-10-08: the event layout (five crews of up to four, 5
-- bearing riddles, 4 oath riddles, 3 lighthouses) is a plan, not a gate. A GM
-- may open charting with any number of crews, players and sites, for example
-- two players and one lighthouse in a test run.
--
-- pirate_validate keeps blocking only what would break play:
--   * no crew at all;
--   * a crew of two or more players without a captain (captains lock at
--     charting, so that crew could never use the compass);
--   * no secret treasure point (the compass reads towards it);
--   * a riddle without an answer;
--   * overlapping site zones (a player inside both cannot claim either);
--   * a lighthouse that is not a circle (the reading starts at its centre).
-- Differences from the event plan come back as `warnings` and do not block.
--
-- gm_pirate_overview also returns each site's prompt, so the GM can edit a
-- site without retyping it. Prompts are shown to players at the site anyway;
-- answers and oath words stay out of the overview.

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
  warnings text[] := array[]::text[];
  crew_count integer;
  player_count integer;
  missing_crew_count integer;
  empty_crew_count integer;
  large_crew_count integer;
  captainless_count integer;
  bearing_count integer;
  oath_count integer;
  lighthouse_count integer;
  missing_answers integer;
  overlap_count integer;
  non_circle_lighthouse_count integer;
  far_lighthouse_count integer;
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

  -- Crews and players.
  select count(*)::integer into crew_count from public.factions where game_id = g;
  select count(*)::integer into player_count
  from public.game_players gp where gp.game_id = g and gp.role = 'player';
  select count(*)::integer into missing_crew_count
  from public.game_players gp
  left join public.characters c on c.game_id = gp.game_id and c.user_id = gp.profile_id and not c.is_npc
  left join public.factions f on f.id = c.faction_id and f.game_id = g
  where gp.game_id = g and gp.role = 'player' and (c.id is null or f.id is null);
  select count(*) filter (where crew_size = 0),
         count(*) filter (where crew_size > 4),
         count(*) filter (where crew_size > 1 and private.pirate_captain(g, crew_id) is null)
    into empty_crew_count, large_crew_count, captainless_count
  from (
    select f.id as crew_id, count(gp.profile_id) as crew_size
    from public.factions f
    left join public.characters c on c.faction_id = f.id and c.game_id = g and not c.is_npc
    left join public.game_players gp on gp.game_id = g and gp.profile_id = c.user_id and gp.role = 'player'
    where f.game_id = g
    group by f.id
  ) crews;
  if crew_count = 0 then
    issues := pg_catalog.array_append(issues, 'At least one crew is required');
  end if;
  if captainless_count > 0 then
    issues := pg_catalog.array_append(issues, 'Every crew needs a captain');
  end if;
  if crew_count not in (0, 5) then
    warnings := pg_catalog.array_append(warnings,
      'The event plan has 5 crews; this game has ' || crew_count);
  end if;
  if missing_crew_count > 0 then
    warnings := pg_catalog.array_append(warnings,
      missing_crew_count || ' player(s) have no crew yet and cannot claim riddles until they get one');
  end if;
  if empty_crew_count > 0 then
    warnings := pg_catalog.array_append(warnings,
      empty_crew_count || ' crew(s) have no players yet');
  end if;
  if large_crew_count > 0 then
    warnings := pg_catalog.array_append(warnings,
      large_crew_count || ' crew(s) have more than four players');
  end if;

  -- Sites.
  select count(*) filter (where s.kind = 'riddle' and s.reward = 'bearing'),
         count(*) filter (where s.kind = 'riddle' and s.reward = 'oath'),
         count(*) filter (where s.kind = 'lighthouse'),
         count(*) filter (where s.kind = 'riddle' and s.answer_hash is null),
         count(*) filter (where s.kind = 'lighthouse' and z.shape <> 'circle')
    into bearing_count, oath_count, lighthouse_count, missing_answers, non_circle_lighthouse_count
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.active
  where s.game_id = g;
  if treasure_point is null then
    issues := pg_catalog.array_append(issues, 'The secret treasure point is required');
  end if;
  if missing_answers > 0 then
    issues := pg_catalog.array_append(issues, 'Every riddle needs an answer');
  end if;
  if non_circle_lighthouse_count > 0 then
    issues := pg_catalog.array_append(issues, 'Lighthouses must be circles');
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
  if bearing_count <> 5 then
    warnings := pg_catalog.array_append(warnings,
      'Bearing riddles: ' || bearing_count || ' of the 5 planned');
  end if;
  if oath_count <> 4 then
    warnings := pg_catalog.array_append(warnings,
      'Oath riddles: ' || oath_count || ' of the 4 planned');
  end if;
  if lighthouse_count <> 3 then
    warnings := pg_catalog.array_append(warnings,
      'Lighthouses: ' || lighthouse_count || ' of the 3 planned');
  end if;
  if treasure_point is not null then
    select count(*)::integer into far_lighthouse_count
    from private.pirate_sites s
    join public.zones z on z.id = s.zone_id and z.active
    where s.game_id = g and s.kind = 'lighthouse'
      and extensions.st_distance(z.geog, treasure_point) not between 200 and 1500;
    if far_lighthouse_count > 0 then
      warnings := pg_catalog.array_append(warnings,
        far_lighthouse_count || ' lighthouse(s) are not 200 to 1500 metres from the treasure; their bearings cross poorly');
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'ready', pg_catalog.cardinality(issues) = 0,
    'issues', pg_catalog.to_jsonb(issues),
    'warnings', pg_catalog.to_jsonb(warnings),
    'counts', pg_catalog.jsonb_build_object(
      'crews', crew_count, 'players', player_count,
      'bearing_riddles', bearing_count, 'oath_riddles', oath_count,
      'lighthouses', lighthouse_count
    )
  );
end;
$$;

-- Unchanged except that each site row carries its prompt.
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
