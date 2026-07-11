-- Server-owned state for the time-traveller elimination game.
create table private.hunt_rounds (
  game_id uuid primary key references public.games(id) on delete cascade,
  status text not null check (status in ('active', 'finished')),
  started_by uuid not null references public.profiles(id),
  winner_id uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  check (
    (status = 'active' and winner_id is null and finished_at is null)
    or (status = 'finished' and winner_id is not null and finished_at is not null)
  )
);

create table private.hunt_players (
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  target_profile_id uuid,
  state text not null default 'alive' check (state in ('alive', 'eliminated')),
  hidden_until timestamptz,
  eliminated_at timestamptz,
  eliminated_by uuid references public.profiles(id),
  primary key (game_id, profile_id),
  unique (game_id, target_profile_id),
  check (target_profile_id is null or target_profile_id <> profile_id),
  check (
    (state = 'alive' and eliminated_at is null and eliminated_by is null)
    or (state = 'eliminated' and eliminated_at is not null and eliminated_by is not null)
  ),
  foreign key (game_id, target_profile_id)
    references private.hunt_players(game_id, profile_id)
    deferrable initially deferred
);

create table private.hunt_claims (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  hunter_id uuid not null references public.profiles(id),
  victim_id uuid not null references public.profiles(id),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  response_by uuid references public.profiles(id),
  check (hunter_id <> victim_id),
  check (
    (status = 'pending' and responded_at is null and response_by is null)
    or (status <> 'pending' and responded_at is not null and response_by is not null)
  )
);

create index hunt_players_game_state_idx
  on private.hunt_players (game_id, state);
create index hunt_claims_game_time_idx
  on private.hunt_claims (game_id, requested_at desc);
create unique index hunt_claims_pending_hunter_idx
  on private.hunt_claims (game_id, hunter_id)
  where status = 'pending';
create unique index hunt_claims_pending_victim_idx
  on private.hunt_claims (game_id, victim_id)
  where status = 'pending';

alter table private.hunt_rounds enable row level security;
alter table private.hunt_players enable row level security;
alter table private.hunt_claims enable row level security;

create policy private_hunt_rounds_deny_clients
  on private.hunt_rounds for all to anon, authenticated
  using (false) with check (false);
create policy private_hunt_players_deny_clients
  on private.hunt_players for all to anon, authenticated
  using (false) with check (false);
create policy private_hunt_claims_deny_clients
  on private.hunt_claims for all to anon, authenticated
  using (false) with check (false);

create function private.emit_hunt_event(
  p_game_id uuid,
  p_profile_id uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (
    game_id, profile_id, type, status, player_visible, payload
  )
  values (
    p_game_id, p_profile_id, p_type, 'confirmed', true,
    coalesce(p_payload, '{}'::jsonb)
  );
$$;

create function private.hunt_distance_band(p_distance_m double precision)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_distance_m <= 25 then 'immediate'
    when p_distance_m <= 100 then 'close'
    when p_distance_m <= 300 then 'nearby'
    when p_distance_m <= 1000 then 'distant'
    else 'far'
  end;
$$;

create function private.protect_active_hunt_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_game uuid := coalesce(new.game_id, old.game_id);
begin
  if not exists (
    select 1
    from private.hunt_rounds round
    where round.game_id = affected_game and round.status = 'active'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    raise exception using errcode = '55000',
      message = 'players cannot join while the hunt is active';
  elsif tg_op = 'DELETE' and old.role = 'player' then
    raise exception using errcode = '55000',
      message = 'participants cannot leave while the hunt is active';
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    raise exception using errcode = '55000',
      message = 'participant roles cannot change while the hunt is active';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger game_players_protect_active_hunt
  before insert or update or delete on public.game_players
  for each row execute function private.protect_active_hunt_membership();

create function private.protect_active_hunt_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from private.hunt_rounds round
    where round.game_id = new.id and round.status = 'active'
  ) and (
    new.status <> 'active'
    or new.location_visibility <> 'gm_only'
  ) then
    raise exception using errcode = '55000',
      message = 'an active hunt must remain active and GM-only';
  end if;
  return new;
end;
$$;

create trigger games_protect_active_hunt
  before update on public.games
  for each row execute function private.protect_active_hunt_game();

create function public.get_hunt_status(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  round_row private.hunt_rounds%rowtype;
  player_row private.hunt_players%rowtype;
  target_row private.hunt_players%rowtype;
  own_position public.player_positions%rowtype;
  target_position public.player_positions%rowtype;
  target_name text;
  winner_name text;
  incoming_claim jsonb;
  outgoing_claim jsonb;
  target_json jsonb;
  proximity_json jsonb;
  distance_m double precision;
  alive_count integer;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_member(g, caller) then
    raise exception using errcode = '42501', message = 'not a member of this game';
  end if;

  select * into round_row
  from private.hunt_rounds round
  where round.game_id = g;

  if not found then
    return jsonb_build_object(
      'phase', 'not_started',
      'participant', false,
      'alive', false
    );
  end if;

  select * into player_row
  from private.hunt_players player
  where player.game_id = g and player.profile_id = caller;

  select count(*)::integer into alive_count
  from private.hunt_players player
  where player.game_id = g and player.state = 'alive';

  if round_row.winner_id is not null then
    select character.name into winner_name
    from public.characters character
    where character.game_id = g
      and character.user_id = round_row.winner_id
      and not character.is_npc
    limit 1;
  end if;

  if not found or player_row.profile_id is null then
    return jsonb_build_object(
      'phase', round_row.status,
      'participant', false,
      'alive', false,
      'alive_count', alive_count,
      'winner', case when round_row.winner_id is null then null else
        jsonb_build_object('character_name', winner_name) end
    );
  end if;

  select jsonb_build_object(
    'id', claim.id,
    'requested_at', claim.requested_at
  ) into incoming_claim
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.victim_id = caller
    and claim.status = 'pending'
  order by claim.requested_at desc
  limit 1;

  select jsonb_build_object(
    'id', claim.id,
    'requested_at', claim.requested_at
  ) into outgoing_claim
  from private.hunt_claims claim
  where claim.game_id = g
    and claim.hunter_id = caller
    and claim.status = 'pending'
  order by claim.requested_at desc
  limit 1;

  if round_row.status = 'active'
     and player_row.state = 'alive'
     and player_row.target_profile_id is not null then
    select * into target_row
    from private.hunt_players target
    where target.game_id = g
      and target.profile_id = player_row.target_profile_id;

    select character.name into target_name
    from public.characters character
    where character.game_id = g
      and character.user_id = player_row.target_profile_id
      and not character.is_npc
    limit 1;

    if target_row.hidden_until > now() then
      proximity_json := jsonb_build_object(
        'state', 'cloaked',
        'available_at', target_row.hidden_until
      );
    else
      select * into own_position
      from public.player_positions position
      where position.game_id = g and position.profile_id = caller;

      select * into target_position
      from public.player_positions position
      where position.game_id = g
        and position.profile_id = player_row.target_profile_id;

      if own_position.profile_id is null or target_position.profile_id is null then
        proximity_json := jsonb_build_object('state', 'waiting_for_location');
      elsif own_position.recorded_at < now() - interval '2 minutes'
         or target_position.recorded_at < now() - interval '2 minutes' then
        proximity_json := jsonb_build_object(
          'state', 'stale',
          'last_seen_at', target_position.recorded_at
        );
      else
        distance_m := extensions.st_distance(
          own_position.geog,
          target_position.geog
        );
        proximity_json := jsonb_build_object(
          'state', 'available',
          'band', private.hunt_distance_band(distance_m),
          'distance_m', (round(distance_m::numeric / 10) * 10)::integer,
          'last_seen_at', target_position.recorded_at
        );
      end if;
    end if;

    target_json := jsonb_build_object(
      'character_name', target_name,
      'proximity', proximity_json
    );
  end if;

  return jsonb_build_object(
    'phase', round_row.status,
    'participant', true,
    'alive', player_row.state = 'alive',
    'alive_count', alive_count,
    'hidden_until', player_row.hidden_until,
    'target', target_json,
    'incoming_claim', incoming_claim,
    'outgoing_claim', outgoing_claim,
    'winner', case when round_row.winner_id is null then null else
      jsonb_build_object(
        'character_name', winner_name,
        'is_self', round_row.winner_id = caller
      ) end
  );
end;
$$;

create function public.get_hunt_admin(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  round_row private.hunt_rounds%rowtype;
  players_json jsonb := '[]'::jsonb;
  claims_json jsonb := '[]'::jsonb;
  winner_name text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

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

create function public.start_hunt(g uuid)
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
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

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

  delete from private.hunt_claims where game_id = g;
  delete from private.hunt_players where game_id = g;
  delete from private.hunt_rounds where game_id = g;

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

create function public.reset_hunt(g uuid)
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
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

  delete from private.hunt_claims where game_id = g;
  delete from private.hunt_players where game_id = g;
  delete from private.hunt_rounds where game_id = g;

  update public.games set status = 'draft' where id = g;

  return jsonb_build_object('phase', 'not_started');
end;
$$;

create function public.request_elimination(g uuid)
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || g::text, 0)
  );

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

create function public.respond_elimination(
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
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;

  select * into claim_record
  from private.hunt_claims existing
  where existing.id = claim_id;

  if not found or claim_record.victim_id <> caller then
    raise exception using errcode = '42501',
      message = 'only the claimed target can respond';
  end if;

  hunt_game_id := claim_record.game_id;
  hunt_hunter_id := claim_record.hunter_id;
  hunt_victim_id := claim_record.victim_id;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('hunt:' || hunt_game_id::text, 0)
  );

  select * into claim_record
  from private.hunt_claims existing
  where existing.id = claim_id
  for update;

  if claim_record.status <> 'pending' then
    return jsonb_build_object('ok', true, 'status', claim_record.status);
  end if;

  if not confirm_elimination then
    update private.hunt_claims
    set status = 'rejected', responded_at = now(), response_by = caller
    where id = claim_id;

    perform private.emit_hunt_event(
      hunt_game_id, hunt_hunter_id, 'elimination_rejected',
      jsonb_build_object('claim_id', claim_id)
    );
    perform private.emit_hunt_event(
      hunt_game_id, hunt_victim_id, 'elimination_rejected',
      jsonb_build_object('claim_id', claim_id)
    );

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
  set status = 'confirmed', responded_at = now(), response_by = caller
  where id = claim_id;

  update public.game_players
  set sharing_enabled = false, consent_revoked_at = now()
  where game_id = hunt_game_id and profile_id = hunt_victim_id;
  delete from public.player_positions
  where game_id = hunt_game_id and profile_id = hunt_victim_id;

  perform private.emit_hunt_event(
    hunt_game_id,
    hunt_victim_id,
    'eliminated',
    jsonb_build_object('claim_id', claim_id)
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
        'claim_id', claim_id,
        'hidden_until', cloak_until
      )
    );
  end if;

  return public.get_hunt_status(hunt_game_id);
end;
$$;

revoke all privileges on table private.hunt_rounds,
  private.hunt_players, private.hunt_claims
from public, anon, authenticated;

revoke all on function private.emit_hunt_event(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.hunt_distance_band(double precision)
  from public, anon, authenticated;
revoke all on function private.protect_active_hunt_membership()
  from public, anon, authenticated;
revoke all on function private.protect_active_hunt_game()
  from public, anon, authenticated;

revoke all on function public.get_hunt_status(uuid) from public, anon, authenticated;
revoke all on function public.get_hunt_admin(uuid) from public, anon, authenticated;
revoke all on function public.start_hunt(uuid) from public, anon, authenticated;
revoke all on function public.reset_hunt(uuid) from public, anon, authenticated;
revoke all on function public.request_elimination(uuid) from public, anon, authenticated;
revoke all on function public.respond_elimination(uuid, boolean)
  from public, anon, authenticated;

grant execute on function public.get_hunt_status(uuid) to authenticated;
grant execute on function public.get_hunt_admin(uuid) to authenticated;
grant execute on function public.start_hunt(uuid) to authenticated;
grant execute on function public.reset_hunt(uuid) to authenticated;
grant execute on function public.request_elimination(uuid) to authenticated;
grant execute on function public.respond_elimination(uuid, boolean)
  to authenticated;

comment on function public.get_hunt_status(uuid) is
  'Returns only the caller hunt state, assigned target, and proximity.';
comment on function public.get_hunt_admin(uuid) is
  'Returns the full hunt chain and claims to a game GM.';
comment on function public.start_hunt(uuid) is
  'Randomizes eligible players into a secret circular target chain.';
comment on function public.request_elimination(uuid) is
  'Creates an idempotent confirmation request against the caller target.';
comment on function public.respond_elimination(uuid, boolean) is
  'Lets the claimed target reject or atomically confirm an elimination.';
