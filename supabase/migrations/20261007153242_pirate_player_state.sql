-- A player receives only their own crew's state. Site and distance details
-- continue to pass through the dedicated server-side presence checks.
create function public.get_pirate_state(g uuid)
returns jsonb
language plpgsql
stable
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
  select game.phase, pirate.paused, pirate.pvp_enabled
    into phase_name, is_paused, is_pvp_enabled
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;
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
  where reading.game_id = g and reading.faction_id = crew_id and reading.voided_at is null;
  select mercy.until_at into mercy_end from private.pirate_mercy mercy
  where mercy.game_id = g and mercy.faction_id = crew_id and mercy.until_at > now();
  select pg_catalog.jsonb_build_object(
    'id', parley.id, 'state', parley.state,
    'role', case when parley.target_faction = crew_id then 'target' else 'attacker' end,
    'can_act', pg_catalog.coalesce(caller = parley.target_profile
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
    and parley.state in ('open', 'joined', 'fighting', 'awaiting_choice', 'disputed')
    and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)
  order by parley.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'role', 'player', 'phase', phase_name,
    'paused', is_paused, 'pvp_enabled', is_pvp_enabled,
    'crew', pg_catalog.jsonb_build_object('id', crew_id, 'name', crew_name, 'color', crew_color),
    'shards', shards, 'doubloons', doubloons, 'oath', oath_words,
    'readings', reading_list, 'mercy_until', mercy_end, 'active_parley', parley_info,
    'site_here', public.site_here(g), 'band', public.treasure_band(g)->>'band');
end;
$$;

revoke all on function public.get_pirate_state(uuid) from public, anon;
grant execute on function public.get_pirate_state(uuid) to authenticated;
