-- resolve_hunt_claim now writes the confirmed outcome itself instead of
-- relying on two triggers that rewrote its updates:
--   * hunt_players_defer_target_assignment copied the victim's target into the
--     hunter's pending_target_profile_id on elimination and then nulled the
--     hunter's automatically inherited target_profile_id;
--   * hunt_claims_reject_after_confirmation rejected every other pending claim
--     in the game once one was confirmed.
-- End state is unchanged. Every other hunt_players writer (gm_set_hunt_chain,
-- gm_assign_next_target, gm_restore_player, cleanup_finished_hunt_assignments)
-- clears pending_target_profile_id in the same statement that sets a target,
-- so the deferral trigger never altered their writes; resolve_hunt_claim is
-- the only function that eliminates a player or confirms a claim.

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

  -- A confirmation voids every other open claim in the game; new claims wait
  -- until the GM has assigned the hunter's next target.
  update private.hunt_claims
  set status = 'rejected', responded_at = now(), response_by = p_responder
  where game_id = hunt_game_id
    and status = 'pending'
    and id <> p_claim_id;

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
    -- The victim's target is held for the GM (gm_assign_next_target), not
    -- inherited automatically.
    cloak_until := now() + interval '10 minutes';
    update private.hunt_players
    set target_profile_id = null,
        pending_target_profile_id = victim.target_profile_id,
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

drop trigger hunt_players_defer_target_assignment on private.hunt_players;
drop trigger hunt_claims_reject_after_confirmation on private.hunt_claims;
drop function private.defer_hunt_target_assignment();
drop function private.reject_competing_hunt_claims();
