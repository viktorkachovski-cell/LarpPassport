-- Parley is consent based: a target player shows a short-lived code and a
-- second player joins it. All mutations use the same per-game advisory lock.
create function private.pirate_parley_presence(
  p_game_id uuid, p_profile_id uuid, p_phase text, p_treasure extensions.geography
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare own_point extensions.geography;
begin
  select position.geog into own_point from public.player_positions position
  where position.game_id = p_game_id and position.profile_id = p_profile_id
    and position.recorded_at >= now() - interval '120 seconds';
  if own_point is null then return 'stale'; end if;
  if exists (select 1 from private.pirate_sites site
             join public.zones zone on zone.id = site.zone_id and zone.active
             join private.zone_state state on state.zone_id = zone.id
               and state.profile_id = p_profile_id and state.inside
             where site.game_id = p_game_id and site.kind = 'harbour') then
    return 'safe_harbour';
  end if;
  if p_phase = 'hoard' and p_treasure is not null
     and extensions.st_dwithin(own_point, p_treasure, 100) then
    return 'treasure_exclusion';
  end if;
  return null;
end;
$$;
revoke all on function private.pirate_parley_presence(uuid, uuid, text, extensions.geography)
  from public, anon, authenticated;

create function private.emit_pirate_parley_event(p_game_id uuid, p_parley_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare session record;
begin
  select target_faction, attacker_faction, state, winner_faction, plunder
    into session from private.pirate_parleys where id = p_parley_id and game_id = p_game_id;
  if not found then return; end if;
  perform private.emit_pirate_crew_event(p_game_id, session.target_faction, 'pirate_parley',
    pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'state', session.state,
      'winner_faction', session.winner_faction, 'plunder', session.plunder));
  if session.attacker_faction is not null then
    perform private.emit_pirate_crew_event(p_game_id, session.attacker_faction, 'pirate_parley',
      pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'state', session.state,
        'winner_faction', session.winner_faction, 'plunder', session.plunder));
  end if;
end;
$$;
revoke all on function private.emit_pirate_parley_event(uuid, uuid) from public, anon, authenticated;

create function private.pirate_queue_dispute(p_game_id uuid, p_parley_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, type, status, player_visible, payload)
  values (p_game_id, 'pirate_dispute', 'pending', false,
    pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'reason', p_reason));
$$;
revoke all on function private.pirate_queue_dispute(uuid, uuid, text) from public, anon, authenticated;

create function private.pirate_sweep_parleys(p_game_id uuid)
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
      and parley.updated_at <= now() - interval '300 seconds' and parley.voided_at is null
    returning parley.id
  loop
    perform private.pirate_queue_dispute(p_game_id, expired.id, 'Parley timed out');
    perform private.emit_pirate_parley_event(p_game_id, expired.id);
  end loop;
end;
$$;
revoke all on function private.pirate_sweep_parleys(uuid) from public, anon, authenticated;

create function public.open_parley(g uuid)
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
    game_id, target_faction, target_profile, code, code_expires_at, state
  ) values (g, crew_id, caller, new_code, now() + interval '90 seconds', 'open')
  returning id, code_expires_at into session_id, expires_at;
  perform private.emit_pirate_parley_event(g, session_id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session_id,
    'code', new_code, 'code_expires_at', expires_at);
end;
$$;

create function public.join_parley(g uuid, code text, idem uuid)
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
  own_point extensions.geography;
  target_point extensions.geography;
  apart boolean;
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
  blocked := private.pirate_parley_presence(g, caller, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  blocked := private.pirate_parley_presence(g, session.target_profile, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', 'target_' || blocked); end if;
  if exists (select 1 from private.pirate_mercy mercy
             where mercy.game_id = g and mercy.faction_id in (crew_id, session.target_faction)
               and mercy.until_at > now()) then
    return pg_catalog.jsonb_build_object('status', 'mercy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and parley.state in ('open', 'joined', 'yielded', 'fighting', 'awaiting_choice', 'disputed')
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
  select position.geog into own_point from public.player_positions position
  where position.game_id = g and position.profile_id = caller;
  select position.geog into target_point from public.player_positions position
  where position.game_id = g and position.profile_id = session.target_profile;
  apart := extensions.st_distance(own_point, target_point) > 75;
  update private.pirate_parleys
  set attacker_faction = crew_id, attacker_profile = caller, join_idem = idem,
      far_apart = apart, state = 'joined', updated_at = now()
  where id = session.id;
  perform private.emit_pirate_parley_event(g, session.id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
    'state', 'joined', 'far_apart', apart);
end;
$$;

revoke all on function public.open_parley(uuid) from public, anon;
revoke all on function public.join_parley(uuid, text, uuid) from public, anon;
grant execute on function public.open_parley(uuid) to authenticated;
grant execute on function public.join_parley(uuid, text, uuid) to authenticated;
