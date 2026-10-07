create function private.emit_pirate_event(p_game_id uuid, p_type text, p_payload jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, profile_id, type, status, player_visible, payload)
  select p_game_id, player.profile_id, p_type, 'confirmed', true, p_payload
  from public.game_players player
  where player.game_id = p_game_id and player.role = 'player';
$$;
revoke all on function private.emit_pirate_event(uuid, text, jsonb) from public, anon, authenticated;

create function public.pirate_set_phase(g uuid, next_phase text, message text)
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
  if current_phase = 'finished' or pg_catalog.abs(next_index - current_index) <> 1 then
    raise exception using errcode = '55000', message = 'Pirate phase can move only one step';
  end if;
  if current_phase = 'setup' and next_phase = 'charting'
     and not (public.pirate_validate(g)->>'ready')::boolean then
    raise exception using errcode = '55000', message = 'Pirate setup is not ready';
  end if;
  update public.games
  set phase = next_phase,
      status = case when next_phase = 'finished' then 'finished'
                    when next_phase = 'setup' then 'draft'
                    when next_phase = 'charting' then 'active'
                    else status end
  where id = g;
  perform private.emit_pirate_event(g, 'pirate_phase', pg_catalog.jsonb_build_object(
    'phase', next_phase, 'message', pg_catalog.coalesce(pg_catalog.nullif(clean_message, ''),
      'Pirate phase: ' || next_phase)
  ));
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', next_phase);
end;
$$;

create function public.pirate_set_paused(g uuid, paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or paused is null then
    raise exception using errcode = '22023', message = 'game and paused value are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  update private.pirate_games set paused = pirate_set_paused.paused, updated_at = now()
  where game_id = g and paused is distinct from pirate_set_paused.paused;
  if not found then
    if not exists (select 1 from private.pirate_games where game_id = g) then
      raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
    end if;
  else
    perform private.emit_pirate_event(g, 'pirate_phase',
      pg_catalog.jsonb_build_object('paused', paused, 'message',
        case when paused then 'The tide has stopped.' else 'The tide moves again.' end));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'paused', paused);
end;
$$;

create function public.pirate_set_pvp(g uuid, enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or enabled is null then
    raise exception using errcode = '22023', message = 'game and PvP value are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  update private.pirate_games set pvp_enabled = enabled, updated_at = now()
  where game_id = g and pvp_enabled is distinct from enabled;
  if not found then
    if not exists (select 1 from private.pirate_games where game_id = g) then
      raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
    end if;
  else
    perform private.emit_pirate_event(g, 'pirate_phase',
      pg_catalog.jsonb_build_object('pvp_enabled', enabled, 'message',
        case when enabled then 'Parley is open.' else 'Parley is closed.' end));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'pvp_enabled', enabled);
end;
$$;

revoke all on function public.pirate_set_phase(uuid, text, text) from public, anon;
revoke all on function public.pirate_set_paused(uuid, boolean) from public, anon;
revoke all on function public.pirate_set_pvp(uuid, boolean) from public, anon;
grant execute on function public.pirate_set_phase(uuid, text, text) to authenticated;
grant execute on function public.pirate_set_paused(uuid, boolean) to authenticated;
grant execute on function public.pirate_set_pvp(uuid, boolean) to authenticated;
