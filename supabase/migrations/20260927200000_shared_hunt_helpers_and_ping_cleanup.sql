-- Code-quality refactor. Shared preambles move into three private helpers and
-- every caller keeps its error codes, messages, lock key and statement order:
--   private.require_gm  - 28000 without a session, 42501 unless GM of the game
--   private.lock_game   - the per-game 'hunt:' transaction advisory lock
--   private.clear_hunt  - removes a game's round, players, claims and
--                         play-area breach state (start_hunt, reset_hunt)
-- private.hunt_band_edge_m now derives the edge from private.hunt_distance_band,
-- so the band thresholds exist once.
--
-- ingest_pings changes:
--   * the consent predicate is gp.sharing_enabled; the game_players CHECK
--     constraint already guarantees it implies live, unrevoked consent;
--   * the unused events piggyback is removed: responses no longer carry
--     events, latest_seq, profile.interval_s or profile.accuracy. Phones
--     read events through get_player_event_delivery. last_seen_seq stays in
--     the signature, ignored, so installed builds that still send it keep
--     resolving the RPC.

create function private.lock_game(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' || p_game_id::text, 0));
end;
$$;

create function private.require_gm(p_game_id uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(p_game_id, auth.uid()) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
end;
$$;

-- Callers hold private.lock_game(p_game_id).
create function private.clear_hunt(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from private.zone_state zs using public.zones z
    where zs.zone_id = z.id and z.game_id = p_game_id and z.zone_type = 'play_area';
  delete from private.hunt_claims where game_id = p_game_id;
  delete from private.hunt_players where game_id = p_game_id;
  delete from private.hunt_rounds where game_id = p_game_id;
end;
$$;

revoke all on function private.lock_game(uuid) from public, anon, authenticated;
revoke all on function private.require_gm(uuid) from public, anon, authenticated;
revoke all on function private.clear_hunt(uuid) from public, anon, authenticated;

comment on function private.lock_game(uuid) is
  'Per-game transaction lock serializing hunt, consent and ping writes.';
comment on function private.require_gm(uuid) is
  'Raises 28000 without a session and 42501 unless the caller is a GM of the game.';
comment on function private.clear_hunt(uuid) is
  'Deletes a game''s hunt round, players, claims and play-area breach state; caller holds lock_game.';

create or replace function private.hunt_band_edge_m(p_distance_m double precision)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case private.hunt_distance_band(p_distance_m)
    when 'immediate' then 25
    when 'close' then 100
    when 'nearby' then 300
    else 1000
  end;
$$;

create or replace function public.gm_get_join_code(g uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_gm(g);
  return (select game.join_code from public.games game where game.id = g);
end;
$$;

create or replace function public.get_hunt_admin(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  round_row private.hunt_rounds%rowtype;
  players_json jsonb := '[]'::jsonb;
  claims_json jsonb := '[]'::jsonb;
  winner_name text;
begin
  perform private.require_gm(g);

  select * into round_row
  from private.hunt_rounds round
  where round.game_id = g;

  if not found then
    return jsonb_build_object(
      'phase', 'not_started',
      'players', players_json,
      'claims', claims_json
    );
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'profile_id', player.profile_id,
      'username', profile.username,
      'character_name', character.name,
      'state', player.state,
      'target_profile_id', player.target_profile_id,
      'target_name', target_character.name,
      'hidden_until', player.hidden_until,
      'eliminated_at', player.eliminated_at,
      'eliminated_by', player.eliminated_by
    ) order by player.state desc, profile.username
  ), '[]'::jsonb) into players_json
  from private.hunt_players player
  join public.profiles profile on profile.id = player.profile_id
  left join public.characters character
    on character.game_id = player.game_id
   and character.user_id = player.profile_id
   and not character.is_npc
  left join public.characters target_character
    on target_character.game_id = player.game_id
   and target_character.user_id = player.target_profile_id
   and not target_character.is_npc
  where player.game_id = g;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', claim.id,
      'hunter_id', claim.hunter_id,
      'hunter_name', hunter_character.name,
      'victim_id', claim.victim_id,
      'victim_name', victim_character.name,
      'status', claim.status,
      'requested_at', claim.requested_at,
      'responded_at', claim.responded_at
    ) order by claim.requested_at desc
  ), '[]'::jsonb) into claims_json
  from private.hunt_claims claim
  left join public.characters hunter_character
    on hunter_character.game_id = claim.game_id
   and hunter_character.user_id = claim.hunter_id
   and not hunter_character.is_npc
  left join public.characters victim_character
    on victim_character.game_id = claim.game_id
   and victim_character.user_id = claim.victim_id
   and not victim_character.is_npc
  where claim.game_id = g;

  if round_row.winner_id is not null then
    select character.name into winner_name
    from public.characters character
    where character.game_id = g
      and character.user_id = round_row.winner_id
      and not character.is_npc
    limit 1;
  end if;

  return jsonb_build_object(
    'phase', round_row.status,
    'started_at', round_row.started_at,
    'finished_at', round_row.finished_at,
    'winner', case when round_row.winner_id is null then null else
      jsonb_build_object(
        'profile_id', round_row.winner_id,
        'character_name', winner_name
      ) end,
    'players', players_json,
    'claims', claims_json
  );
end;
$$;

create or replace function public.start_hunt(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  participants uuid[];
  participant_count integer;
  character_count integer;
  i integer;
begin
  perform private.require_gm(g);

  perform private.lock_game(g);

  if exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is already active';
  end if;

  select count(*)::integer,
         array_agg(player.profile_id order by pg_catalog.random())
    into participant_count, participants
  from public.game_players player
  where player.game_id = g and player.role = 'player';

  if participant_count < 2 then
    raise exception using errcode = '22023',
      message = 'at least two players are required';
  end if;

  select count(distinct character.user_id)::integer into character_count
  from public.characters character
  where character.game_id = g
    and not character.is_npc
    and character.user_id = any(participants);

  if character_count <> participant_count then
    raise exception using errcode = '22023',
      message = 'every player needs a character before the hunt starts';
  end if;

  perform private.clear_hunt(g);

  insert into private.hunt_rounds (game_id, status, started_by)
  values (g, 'active', caller);

  for i in 1..participant_count loop
    insert into private.hunt_players (
      game_id, profile_id, target_profile_id
    ) values (
      g,
      participants[i],
      participants[(i % participant_count) + 1]
    );
  end loop;

  update public.games
  set status = 'active', location_visibility = 'gm_only'
  where id = g;

  for i in 1..participant_count loop
    perform private.emit_hunt_event(
      g,
      participants[i],
      'hunt_started',
      jsonb_build_object('message', 'The hunt has begun. Your target is ready.')
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.reset_hunt(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_gm(g);
  perform private.lock_game(g);
  perform private.clear_hunt(g);

  update public.games set status = 'draft' where id = g;

  return jsonb_build_object('phase', 'not_started');
end;
$$;

create or replace function public.gm_eliminate_player(g uuid, victim_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  forced_victim_id uuid := victim_id;
  forced_hunter_id uuid;
  forced_claim_id uuid;
begin
  perform private.require_gm(g);

  perform private.lock_game(g);

  if not exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is not active';
  end if;

  if not exists (
    select 1 from private.hunt_players player
    where player.game_id = g
      and player.profile_id = forced_victim_id
      and player.state = 'alive'
  ) then
    raise exception using errcode = '22023', message = 'player is not alive';
  end if;

  select player.profile_id into forced_hunter_id
  from private.hunt_players player
  where player.game_id = g
    and player.state = 'alive'
    and player.target_profile_id = forced_victim_id;

  if forced_hunter_id is null then
    raise exception using errcode = '55000',
      message = 'target chain has no hunter for this player';
  end if;

  select claim.id into forced_claim_id
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.hunter_id = forced_hunter_id
    and claim.victim_id = forced_victim_id
    and claim.status = 'pending'
  limit 1;

  if forced_claim_id is null then
    insert into private.hunt_claims (game_id, hunter_id, victim_id)
    values (g, forced_hunter_id, forced_victim_id)
    returning id into forced_claim_id;
  end if;

  return private.resolve_hunt_claim(
    forced_claim_id,
    true,
    caller,
    true
  );
end;
$$;

create or replace function public.gm_restore_player(g uuid, profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  restore_id uuid := profile_id;
  restored private.hunt_players%rowtype;
  round_status text;
  predecessor_id uuid;
  restored_target_id uuid;
  alive_count integer;
  participant uuid;
begin
  perform private.require_gm(g);

  perform private.lock_game(g);

  select round.status into round_status
  from private.hunt_rounds round
  where round.game_id = g
  for update;

  if not found or round_status not in ('active', 'finished') then
    raise exception using errcode = '55000', message = 'hunt cannot restore players';
  end if;

  select * into restored
  from private.hunt_players player
  where player.game_id = g and player.profile_id = restore_id
  for update;

  if not found or restored.state <> 'eliminated' then
    raise exception using errcode = '22023', message = 'player is not eliminated';
  end if;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  if alive_count = 1 then
    select player.profile_id into predecessor_id
    from private.hunt_players player
    where player.game_id = g and player.state = 'alive';
    restored_target_id := predecessor_id;
  else
    select player.profile_id,
           coalesce(player.target_profile_id, player.pending_target_profile_id)
      into predecessor_id, restored_target_id
    from private.hunt_players player
    where player.game_id = g
      and player.profile_id = restored.eliminated_by
      and player.state = 'alive'
      and coalesce(
        player.target_profile_id,
        player.pending_target_profile_id
      ) is not null;

    if predecessor_id is null then
      select player.profile_id into restored_target_id
      from private.hunt_players player
      where player.game_id = g and player.state = 'alive'
      order by player.profile_id
      limit 1;

      select player.profile_id into predecessor_id
      from private.hunt_players player
      where player.game_id = g
        and player.state = 'alive'
        and player.target_profile_id = restored_target_id;
    end if;
  end if;

  if predecessor_id is null or restored_target_id is null then
    raise exception using errcode = '55000',
      message = 'target chain cannot accept the restored player';
  end if;

  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = caller
  where game_id = g and status = 'pending' and hunter_id = predecessor_id;

  update private.hunt_players
  set target_profile_id = restore_id,
      pending_target_profile_id = null
  where private.hunt_players.game_id = g
    and private.hunt_players.profile_id = predecessor_id;

  update private.hunt_players
  set state = 'alive',
      target_profile_id = restored_target_id,
      pending_target_profile_id = null,
      hidden_until = null,
      eliminated_at = null,
      eliminated_by = null
  where private.hunt_players.game_id = g
    and private.hunt_players.profile_id = restore_id;

  update private.hunt_rounds
  set status = 'active', winner_id = null, finished_at = null
  where game_id = g;

  update public.games
  set status = 'active', location_visibility = 'gm_only'
  where id = g;

  for participant in
    select player.profile_id from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g, participant, 'hunt_player_restored',
      jsonb_build_object(
        'profile_id', restore_id,
        'message', 'The GM restored a traveller and repaired the target chain.'
      )
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.gm_set_hunt_chain(g uuid, player_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  alive_count integer;
  supplied_count integer := coalesce(pg_catalog.cardinality(player_ids), 0);
  distinct_count integer;
  i integer;
  participant uuid;
begin
  perform private.require_gm(g);

  perform private.lock_game(g);

  if not exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is not active';
  end if;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  select count(distinct supplied.profile_id)::integer into distinct_count
  from pg_catalog.unnest(player_ids) as supplied(profile_id);

  if alive_count < 2
     or supplied_count <> alive_count
     or distinct_count <> alive_count
     or exists (
       select 1 from private.hunt_players player
       where player.game_id = g
         and player.state = 'alive'
         and not (player.profile_id = any(player_ids))
     ) then
    raise exception using errcode = '22023',
      message = 'chain must contain every living player exactly once';
  end if;

  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = caller
  where game_id = g and status = 'pending';

  update private.hunt_players
  set target_profile_id = null,
      pending_target_profile_id = null
  where game_id = g and state = 'alive';

  for i in 1..alive_count loop
    update private.hunt_players
    set target_profile_id = player_ids[(i % alive_count) + 1]
    where game_id = g and profile_id = player_ids[i] and state = 'alive';
  end loop;

  for participant in
    select player.profile_id from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g, participant, 'hunt_chain_changed',
      jsonb_build_object('message', 'The GM corrected the target chain.')
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.gm_assign_next_target(g uuid, hunter_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assign_hunter_id uuid := hunter_id;
  next_target_id uuid;
begin
  perform private.require_gm(g);

  perform private.lock_game(g);

  select player.pending_target_profile_id into next_target_id
  from private.hunt_players player
  where player.game_id = g
    and player.profile_id = assign_hunter_id
    and player.state = 'alive'
  for update;

  if not found or next_target_id is null then
    raise exception using errcode = '22023',
      message = 'player is not waiting for a target assignment';
  end if;
  if not exists (
    select 1 from private.hunt_players target
    where target.game_id = g
      and target.profile_id = next_target_id
      and target.state = 'alive'
  ) then
    raise exception using errcode = '55000', message = 'suggested target is not alive';
  end if;

  update private.hunt_players
  set target_profile_id = next_target_id,
      pending_target_profile_id = null
  where game_id = g and profile_id = assign_hunter_id;

  perform private.emit_hunt_event(
    g,
    assign_hunter_id,
    'hunt_target_assigned',
    jsonb_build_object('message', 'The GM assigned your next target.')
  );

  return public.get_hunt_admin(g);
end;
$$;

create or replace function public.request_elimination(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  hunter private.hunt_players%rowtype;
  existing_claim private.hunt_claims%rowtype;
  claim_id uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  perform private.lock_game(g);

  if not exists (
    select 1 from private.hunt_rounds round
    where round.game_id = g and round.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'hunt is not active';
  end if;

  select * into hunter
  from private.hunt_players player
  where player.game_id = g and player.profile_id = caller
  for update;

  if not found or hunter.state <> 'alive' or hunter.target_profile_id is null then
    raise exception using errcode = '42501', message = 'not an active hunter';
  end if;

  select * into existing_claim
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.hunter_id = caller
    and claim.status = 'pending'
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', true,
      'claim_id', existing_claim.id,
      'already_pending', true
    );
  end if;

  insert into private.hunt_claims (game_id, hunter_id, victim_id)
  values (g, caller, hunter.target_profile_id)
  returning id into claim_id;

  perform private.emit_hunt_event(
    g,
    hunter.target_profile_id,
    'elimination_requested',
    jsonb_build_object('claim_id', claim_id)
  );
  perform private.emit_hunt_event(
    g,
    caller,
    'elimination_claimed',
    jsonb_build_object('claim_id', claim_id)
  );

  return jsonb_build_object('ok', true, 'claim_id', claim_id);
end;
$$;

create or replace function private.resolve_hunt_claim(
  p_claim_id uuid,
  p_confirm_elimination boolean,
  p_responder uuid,
  p_gm_override boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_record private.hunt_claims%rowtype;
  hunter private.hunt_players%rowtype;
  victim private.hunt_players%rowtype;
  hunt_game_id uuid;
  hunt_hunter_id uuid;
  hunt_victim_id uuid;
  remaining integer;
  round_status text;
  cloak_until timestamptz;
  winner_name text;
  participant uuid;
begin
  select * into claim_record
  from private.hunt_claims existing
  where existing.id = p_claim_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'elimination claim not found';
  end if;

  hunt_game_id := claim_record.game_id;
  perform private.lock_game(hunt_game_id);

  select * into claim_record
  from private.hunt_claims existing
  where existing.id = p_claim_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'elimination claim not found';
  end if;

  hunt_hunter_id := claim_record.hunter_id;
  hunt_victim_id := claim_record.victim_id;

  if p_gm_override then
    if not private.is_game_gm(hunt_game_id, p_responder) then
      raise exception using errcode = '42501', message = 'GM access required';
    end if;
  elsif hunt_victim_id <> p_responder then
    raise exception using errcode = '42501',
      message = 'only the claimed target can respond';
  end if;

  if claim_record.status <> 'pending' then
    if p_gm_override then
      return public.get_hunt_admin(hunt_game_id);
    end if;
    return public.get_hunt_status(hunt_game_id);
  end if;

  if not p_confirm_elimination then
    update private.hunt_claims
    set status = 'rejected', responded_at = now(), response_by = p_responder
    where id = p_claim_id;

    perform private.emit_hunt_event(
      hunt_game_id, hunt_hunter_id, 'elimination_rejected',
      jsonb_build_object(
        'claim_id', p_claim_id,
        'gm_override', p_gm_override
      )
    );
    perform private.emit_hunt_event(
      hunt_game_id, hunt_victim_id, 'elimination_rejected',
      jsonb_build_object(
        'claim_id', p_claim_id,
        'gm_override', p_gm_override
      )
    );

    if p_gm_override then
      return public.get_hunt_admin(hunt_game_id);
    end if;
    return public.get_hunt_status(hunt_game_id);
  end if;

  select round.status into round_status
  from private.hunt_rounds round
  where round.game_id = hunt_game_id
  for update;

  if not found or round_status <> 'active' then
    raise exception using errcode = '55000', message = 'hunt is not active';
  end if;

  select * into hunter
  from private.hunt_players player
  where player.game_id = hunt_game_id
    and player.profile_id = hunt_hunter_id;
  select * into victim
  from private.hunt_players player
  where player.game_id = hunt_game_id
    and player.profile_id = hunt_victim_id;

  if hunter.state <> 'alive'
     or victim.state <> 'alive'
     or hunter.target_profile_id <> victim.profile_id then
    raise exception using errcode = '55000',
      message = 'the target chain changed before confirmation';
  end if;

  update private.hunt_players
  set state = 'eliminated',
      target_profile_id = null,
      hidden_until = null,
      eliminated_at = now(),
      eliminated_by = hunter.profile_id
  where game_id = hunt_game_id and profile_id = hunt_victim_id;

  select count(*)::integer into remaining
  from private.hunt_players player
  where player.game_id = hunt_game_id and player.state = 'alive';

  update private.hunt_claims
  set status = 'confirmed', responded_at = now(), response_by = p_responder
  where id = p_claim_id;

  -- Claims made by the newly eliminated player can no longer be valid.
  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = p_responder
  where game_id = hunt_game_id
    and status = 'pending'
    and id <> p_claim_id
    and hunter_id = hunt_victim_id;

  update public.game_players
  set sharing_enabled = false, consent_revoked_at = now()
  where game_id = hunt_game_id and profile_id = hunt_victim_id;
  delete from public.player_positions
  where game_id = hunt_game_id and profile_id = hunt_victim_id;

  perform private.emit_hunt_event(
    hunt_game_id,
    hunt_victim_id,
    'eliminated',
    jsonb_build_object(
      'claim_id', p_claim_id,
      'gm_override', p_gm_override
    )
  );

  if remaining = 1 then
    update private.hunt_players
    set target_profile_id = null
    where game_id = hunt_game_id and profile_id = hunt_hunter_id;

    update private.hunt_rounds
    set status = 'finished',
        winner_id = hunter.profile_id,
        finished_at = now()
    where game_id = hunt_game_id;

    update public.games set status = 'finished' where id = hunt_game_id;

    select character.name into winner_name
    from public.characters character
    where character.game_id = hunt_game_id
      and character.user_id = hunt_hunter_id
      and not character.is_npc
    limit 1;

    for participant in
      select player.profile_id
      from private.hunt_players player
      where player.game_id = hunt_game_id
    loop
      perform private.emit_hunt_event(
        hunt_game_id,
        participant,
        'hunt_finished',
        jsonb_build_object('winner', winner_name)
      );
    end loop;
  else
    cloak_until := now() + interval '10 minutes';
    update private.hunt_players
    set target_profile_id = victim.target_profile_id,
        hidden_until = cloak_until
    where game_id = hunt_game_id and profile_id = hunt_hunter_id;

    perform private.emit_hunt_event(
      hunt_game_id,
      hunt_hunter_id,
      'elimination_confirmed',
      jsonb_build_object(
        'claim_id', p_claim_id,
        'hidden_until', cloak_until,
        'gm_override', p_gm_override
      )
    );
  end if;

  if p_gm_override then
    return public.get_hunt_admin(hunt_game_id);
  end if;
  return public.get_hunt_status(hunt_game_id);
end;
$$;

create or replace function public.set_location_consent(
  g uuid,
  grant_consent boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  perform private.lock_game(g);

  if grant_consent and exists (
    select 1 from private.hunt_players hp
    where hp.game_id = g and hp.profile_id = caller and hp.state = 'eliminated'
  ) then
    raise exception using errcode = '55000', message = 'Eliminated players cannot share until restored by a GM.';
  end if;
  if grant_consent then
    update public.game_players
    set location_consent_at = now(),
        sharing_enabled = true,
        consent_revoked_at = null
    where game_id = g and profile_id = caller;
  else
    update public.game_players
    set consent_revoked_at = now(),
        sharing_enabled = false
    where game_id = g and profile_id = caller;
  end if;

  if not found then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;

  if not grant_consent then
    delete from public.player_positions
    where game_id = g and profile_id = caller;
  end if;

  insert into public.game_events (
    game_id, profile_id, type, status, player_visible
  )
  values (
    g,
    caller,
    case when grant_consent then 'consent_granted' else 'consent_revoked' end,
    'confirmed',
    false
  );
end;
$$;

create or replace function private.evaluate_zones(
  p_game_id uuid,
  p_user_id uuid,
  p_position extensions.geography,
  p_at_time timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  zone_row public.zones%rowtype;
  state_row private.zone_state%rowtype;
  is_inside boolean;
  near_boundary boolean;
  center_distance_m double precision;
  round_started_at timestamptz;

begin
  perform private.lock_game(p_game_id);
  select started_at into round_started_at from private.hunt_rounds
    where game_id = p_game_id and status = 'active';
  if p_at_time > now() then return; end if;
  for zone_row in
    select * from public.zones
    where game_id = p_game_id and active
  loop
    -- The anomaly boundary only matters during a live hunt round; skipping it
    -- otherwise avoids breach noise during setup and between rounds.
    if zone_row.zone_type = 'play_area' and (round_started_at is null or p_at_time < round_started_at) then
      continue;
    end if;

    if zone_row.shape = 'circle' then
      is_inside := extensions.st_dwithin(
        p_position, zone_row.geog, zone_row.radius_m
      );
    else
      is_inside := extensions.st_intersects(p_position, zone_row.geog);
    end if;

    insert into private.zone_state (zone_id, profile_id)
    values (zone_row.id, p_user_id)
    on conflict (zone_id, profile_id) do nothing;

    select * into state_row
    from private.zone_state
    where zone_id = zone_row.id and profile_id = p_user_id
    for update;

    if state_row.last_evaluated_at is not null and p_at_time <= state_row.last_evaluated_at then continue; end if;
    update private.zone_state set last_evaluated_at = p_at_time
      where zone_id = zone_row.id and profile_id = p_user_id;

    if zone_row.zone_type = 'play_area' then
      if zone_row.shape = 'circle' then
        center_distance_m := extensions.st_distance(p_position, zone_row.geog);
        near_boundary := is_inside and center_distance_m >= greatest(
          zone_row.radius_m - zone_row.warning_distance_m,
          0::double precision
        );
      else
        near_boundary := is_inside and extensions.st_dwithin(
          p_position,
          extensions.st_boundary(
            zone_row.geog::extensions.geometry
          )::extensions.geography,
          zone_row.warning_distance_m
        );
      end if;

      if is_inside then
        if near_boundary and not state_row.warning_active then
          perform private.emit_play_area_event(
            zone_row, p_user_id, 'zone_boundary_warning', p_at_time
          );
        end if;

        update private.zone_state
        set inside = true,
            inside_since = coalesce(inside_since, p_at_time),
            warning_active = near_boundary,
            outside_active = false,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
      elsif state_row.inside
            and not state_row.outside_active
            and not extensions.st_dwithin(
              p_position,
              zone_row.geog,
              case
                when zone_row.shape = 'circle'
                  then zone_row.radius_m + zone_row.exit_buffer_m
                else zone_row.exit_buffer_m
              end
            ) then
        update private.hunt_claims
        set status = 'rejected', responded_at = now(), response_by = p_user_id
        where game_id = p_game_id
          and hunter_id = p_user_id
          and status = 'pending'
          and requested_at <= p_at_time;

        perform private.emit_play_area_event(
          zone_row, p_user_id, 'zone_boundary_exit', p_at_time
        );

        update private.zone_state
        set inside = false,
            inside_since = null,
            fired_at = null,
            warning_active = false,
            outside_active = true,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
      end if;

      continue;
    end if;

    if is_inside then
      if not state_row.inside then
        update private.zone_state
        set inside = true,
            inside_since = p_at_time,
            fired_at = null,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
        state_row.inside_since := p_at_time;
        state_row.fired_at := null;
      end if;

      if state_row.fired_at is null
         and not (zone_row.one_shot and state_row.trigger_count > 0)
         and p_at_time >= state_row.inside_since
             + pg_catalog.make_interval(secs => zone_row.dwell_seconds) then
        update private.zone_state
        set fired_at = p_at_time,
            trigger_count = state_row.trigger_count + 1,
            updated_at = now()
        where zone_id = zone_row.id and profile_id = p_user_id;
        perform private.emit_zone_event(
          zone_row, p_user_id, 'zone_enter', p_at_time
        );
      end if;
    elsif state_row.inside and not extensions.st_dwithin(
      p_position,
      zone_row.geog,
      case
        when zone_row.shape = 'circle'
          then zone_row.radius_m + zone_row.exit_buffer_m
        else zone_row.exit_buffer_m
      end
    ) then
      update private.zone_state
      set inside = false,
          inside_since = null,
          fired_at = null,
          updated_at = now()
      where zone_id = zone_row.id and profile_id = p_user_id;

      if state_row.fired_at is not null then
        perform private.emit_zone_event(
          zone_row, p_user_id, 'zone_exit', p_at_time
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.ingest_pings(
  g uuid,
  pings jsonb,
  last_seen_seq bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  member_row record;
  reject_reason text;
  ping jsonb;
  batch_size integer;
  accepted_count integer := 0;
  rejected_count integer := 0;
  valid_pings jsonb := '[]'::jsonb;
  ping_is_valid boolean;
  inserted_ping_id bigint;
  current_lat double precision;
  current_lng double precision;
  current_position extensions.geography;
  current_accuracy real;
  current_recorded_at timestamptz;
  current_battery real;
  evaluation_cutoff timestamptz;
  near_zone boolean := false;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  if jsonb_typeof(pings) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'pings must be a JSON array';
  end if;

  batch_size := jsonb_array_length(pings);
  if batch_size < 1 or batch_size > 500 then
    raise exception using errcode = '22023',
      message = 'pings must contain between 1 and 500 points';
  end if;
  if octet_length(pings::text) > 262144 then
    raise exception using errcode = '22023',
      message = 'pings payload exceeds 256 KiB';
  end if;

  perform private.lock_game(g);

  -- sharing_enabled implies live consent (game_players CHECK constraint).
  select gp.sharing_enabled, game.status as game_status
    into member_row
  from public.game_players gp
  join public.games game on game.id = gp.game_id
  where gp.game_id = g and gp.profile_id = caller;

  if not found then
    reject_reason := 'not_member';
  elsif member_row.game_status = 'finished' then
    reject_reason := 'game_finished';
  elsif exists (select 1 from private.hunt_players hp where hp.game_id = g and hp.profile_id = caller and hp.state = 'eliminated') then
    reject_reason := 'eliminated';
  elsif not member_row.sharing_enabled then
    reject_reason := 'no_consent';
  end if;

  if reject_reason is not null then
    return jsonb_build_object(
      'accepted', 0,
      'rejected', batch_size,
      'reason', reject_reason
    );
  end if;

  -- Per-point validation: invalid points are skipped and counted, never fatal.
  for ping in select value from jsonb_array_elements(pings) as item(value) loop
    ping_is_valid := false;

    if jsonb_typeof(ping) = 'object' then
      begin
        current_lat := (ping->>'lat')::double precision;
        current_lng := (ping->>'lng')::double precision;
        current_accuracy := nullif(ping->>'accuracy', '')::real;
        current_recorded_at := (ping->>'recorded_at')::timestamptz;
        current_battery := nullif(ping->>'battery', '')::real;

        ping_is_valid :=
          current_lat is not null
          and current_lat::text not in ('NaN', 'Infinity', '-Infinity')
          and current_lat between -90 and 90
          and current_lng is not null
          and current_lng::text not in ('NaN', 'Infinity', '-Infinity')
          and current_lng between -180 and 180
          and (
            current_accuracy is null
            or (
              current_accuracy::text not in ('NaN', 'Infinity', '-Infinity')
              and current_accuracy between 0 and 10000
            )
          )
          and (
            current_battery is null
            or (
              current_battery::text not in ('NaN', 'Infinity', '-Infinity')
              and current_battery between 0 and 100
            )
          )
          and current_recorded_at is not null
          and isfinite(current_recorded_at)
          and current_recorded_at >= now() - interval '24 hours'
          and current_recorded_at <= now() + interval '5 minutes';
      exception
        when invalid_text_representation
          or numeric_value_out_of_range
          or datetime_field_overflow then
          ping_is_valid := false;
      end;
    end if;

    if ping_is_valid then
      valid_pings := valid_pings || jsonb_build_array(ping);
    else
      rejected_count := rejected_count + 1;
    end if;
  end loop;

  select min(sampled_at) into evaluation_cutoff from (
    select distinct (value->>'recorded_at')::timestamptz as sampled_at
    from jsonb_array_elements(valid_pings) item(value)
    where (value->>'recorded_at')::timestamptz > now() - interval '10 minutes'
      and (value->>'recorded_at')::timestamptz <= now()
      and not exists (select 1 from private.location_pings lp
        where lp.game_id = g and lp.profile_id = caller
          and lp.recorded_at = (value->>'recorded_at')::timestamptz)
    order by sampled_at desc limit 50
  ) newest;
  current_battery := null;
  for ping in
    select value
    from jsonb_array_elements(valid_pings) as item(value)
    order by (value->>'recorded_at')::timestamptz asc
  loop
    current_lat := (ping->>'lat')::double precision;
    current_lng := (ping->>'lng')::double precision;
    current_position := extensions.st_setsrid(
      extensions.st_makepoint(current_lng, current_lat),
      4326
    )::extensions.geography;
    current_accuracy := nullif(ping->>'accuracy', '')::real;
    current_recorded_at := (ping->>'recorded_at')::timestamptz;
    current_battery := coalesce(
      nullif(ping->>'battery', '')::real,
      current_battery
    );
    inserted_ping_id := null;

    insert into private.location_pings (
      game_id, profile_id, geog, accuracy_m, recorded_at
    )
    values (
      g, caller, current_position, current_accuracy, current_recorded_at
    )
    on conflict (game_id, profile_id, recorded_at) do nothing
    returning id into inserted_ping_id;

    if inserted_ping_id is not null then
      accepted_count := accepted_count + 1;
      -- Only recent points are gameplay-relevant, and a full offline dump
      -- must never exceed the API statement timeout.
      if current_recorded_at >= evaluation_cutoff and current_recorded_at <= now() then
        perform private.evaluate_zones(
          g, caller, current_position, current_recorded_at
        );
      end if;
    end if;
  end loop;

  if jsonb_array_length(valid_pings) > 0 then
    insert into public.player_positions (
      game_id, profile_id, geog, accuracy_m, recorded_at, battery_pct, updated_at
    )
    values (
      g, caller, current_position, current_accuracy,
      current_recorded_at, current_battery, now()
    )
    on conflict (game_id, profile_id) do update
    set geog = excluded.geog,
        accuracy_m = excluded.accuracy_m,
        recorded_at = excluded.recorded_at,
        battery_pct = excluded.battery_pct,
        updated_at = now()
    where excluded.recorded_at >= player_positions.recorded_at;

    select exists (
      select 1
      from public.zones z
      where z.game_id = g
        and z.active
        and extensions.st_dwithin(
          current_position,
          z.geog,
          250 + coalesce(z.radius_m, 0)
        )
    ) into near_zone;
  end if;

  return jsonb_build_object(
    'accepted', accepted_count,
    'rejected', rejected_count,
    'profile', jsonb_build_object(
      'mode', case when near_zone then 'near' else 'far' end
    )
  );
end;
$$;

comment on function public.ingest_pings(uuid, jsonb, bigint) is
  'Idempotently ingests up to 500 points for a sharing player in an unfinished game; invalid points are skipped and counted. last_seen_seq is ignored (kept for installed clients).';
