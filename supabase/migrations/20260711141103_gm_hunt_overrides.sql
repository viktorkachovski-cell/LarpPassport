create function private.resolve_hunt_claim(
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
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || hunt_game_id::text, 0)
  );

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

create or replace function public.respond_elimination(
  claim_id uuid,
  confirm_elimination boolean
)
returns jsonb
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

  return private.resolve_hunt_claim(
    claim_id,
    confirm_elimination,
    caller,
    false
  );
end;
$$;

create function public.gm_resolve_elimination(
  claim_id uuid,
  confirm_elimination boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  override_claim_id uuid := claim_id;
  claim_game_id uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  select claim.game_id into claim_game_id
  from private.hunt_claims claim
  where claim.id = override_claim_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'elimination claim not found';
  end if;
  if not private.is_game_gm(claim_game_id, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  return private.resolve_hunt_claim(
    override_claim_id,
    confirm_elimination,
    caller,
    true
  );
end;
$$;

create function public.gm_eliminate_player(g uuid, victim_id uuid)
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
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

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

create function public.gm_restore_player(g uuid, profile_id uuid)
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
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

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
    select player.profile_id, player.target_profile_id
      into predecessor_id, restored_target_id
    from private.hunt_players player
    where player.game_id = g
      and player.profile_id = restored.eliminated_by
      and player.state = 'alive'
      and player.target_profile_id is not null;

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
  where game_id = g
    and status = 'pending'
    and hunter_id = predecessor_id;

  update private.hunt_players
  set target_profile_id = restore_id
  where private.hunt_players.game_id = g
    and private.hunt_players.profile_id = predecessor_id;

  update private.hunt_players
  set state = 'alive',
      target_profile_id = restored_target_id,
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
    select player.profile_id
    from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g,
      participant,
      'hunt_player_restored',
      jsonb_build_object(
        'profile_id', restore_id,
        'message', 'The GM restored a traveller and repaired the target chain.'
      )
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

create function public.gm_set_hunt_chain(g uuid, player_ids uuid[])
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
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

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
       select 1
       from private.hunt_players player
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
  set target_profile_id = null
  where game_id = g and state = 'alive';

  for i in 1..alive_count loop
    update private.hunt_players
    set target_profile_id = player_ids[(i % alive_count) + 1]
    where game_id = g and profile_id = player_ids[i] and state = 'alive';
  end loop;

  for participant in
    select player.profile_id
    from private.hunt_players player
    where player.game_id = g
  loop
    perform private.emit_hunt_event(
      g,
      participant,
      'hunt_chain_changed',
      jsonb_build_object('message', 'The GM corrected the target chain.')
    );
  end loop;

  return public.get_hunt_admin(g);
end;
$$;

revoke all on function private.resolve_hunt_claim(uuid, boolean, uuid, boolean)
  from public, anon, authenticated;

revoke all on function public.gm_resolve_elimination(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.gm_eliminate_player(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.gm_restore_player(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.gm_set_hunt_chain(uuid, uuid[])
  from public, anon, authenticated;

grant execute on function public.gm_resolve_elimination(uuid, boolean)
  to authenticated;
grant execute on function public.gm_eliminate_player(uuid, uuid)
  to authenticated;
grant execute on function public.gm_restore_player(uuid, uuid)
  to authenticated;
grant execute on function public.gm_set_hunt_chain(uuid, uuid[])
  to authenticated;

comment on function public.gm_resolve_elimination(uuid, boolean) is
  'GM-only override for accepting or rejecting a pending elimination claim.';
comment on function public.gm_eliminate_player(uuid, uuid) is
  'GM-only direct elimination that preserves the circular target chain.';
comment on function public.gm_restore_player(uuid, uuid) is
  'GM-only restoration that reinserts an eliminated player into the target chain.';
comment on function public.gm_set_hunt_chain(uuid, uuid[]) is
  'GM-only replacement of the complete ordered living-player target chain.';
