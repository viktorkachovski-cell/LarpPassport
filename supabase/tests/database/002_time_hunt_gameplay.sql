begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(42);

select extensions.has_table('private', 'hunt_rounds', 'hunt rounds are private');
select extensions.has_table('private', 'hunt_players', 'target assignments are private');
select extensions.has_table('private', 'hunt_claims', 'elimination claims are private');
select extensions.ok(
  not exists (
    select 1
    from pg_class table_class
    join pg_namespace schema on schema.oid = table_class.relnamespace
    left join pg_policy policy on policy.polrelid = table_class.oid
    where schema.nspname = 'private'
      and table_class.relname in ('hunt_rounds', 'hunt_players', 'hunt_claims')
    group by table_class.oid, table_class.relrowsecurity
    having not table_class.relrowsecurity or count(policy.polname) = 0
  ),
  'hunt tables have RLS and explicit deny policies'
);
select extensions.is(
  (select count(*)::integer
   from pg_proc function
   join pg_namespace schema on schema.oid = function.pronamespace
   where schema.nspname = 'public'
     and function.proname in (
       'get_hunt_status', 'get_hunt_admin', 'start_hunt', 'reset_hunt',
       'request_elimination', 'respond_elimination'
     )
     and has_function_privilege('authenticated', function.oid, 'EXECUTE')),
  6,
  'authenticated users can execute the six hunt RPCs'
);
select extensions.is(
  (select count(*)::integer
   from pg_proc function
   join pg_namespace schema on schema.oid = function.pronamespace
   where schema.nspname = 'public'
     and function.proname in (
       'get_hunt_status', 'get_hunt_admin', 'start_hunt', 'reset_hunt',
       'request_elimination', 'respond_elimination'
     )
     and has_function_privilege('anon', function.oid, 'EXECUTE')),
  0,
  'anonymous users cannot execute hunt RPCs'
);
select extensions.ok(
  not exists (
    select 1
    from pg_proc function
    join pg_namespace schema on schema.oid = function.pronamespace
    where schema.nspname = 'public'
      and function.proname in (
        'get_hunt_status', 'get_hunt_admin', 'start_hunt', 'reset_hunt',
        'request_elimination', 'respond_elimination'
      )
      and (
        not function.prosecdef
        or not coalesce(function.proconfig, '{}'::text[])
          @> array['search_path=""']
      )
  ),
  'hunt RPCs are hardened security-definer boundaries'
);
select extensions.is(
  (select count(*)::integer
   from information_schema.table_privileges
   where grantee = 'authenticated'
     and table_schema = 'private'
     and table_name in ('hunt_rounds', 'hunt_players', 'hunt_claims')),
  0,
  'clients have no direct hunt-table grants'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    '61000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hunt-gm@example.test', '', now(),
    '{"username":"hunt_gm"}'::jsonb, now(), now()
  ),
  (
    '62000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hunt-one@example.test', '', now(),
    '{"username":"hunt_one"}'::jsonb, now(), now()
  ),
  (
    '63000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hunt-two@example.test', '', now(),
    '{"username":"hunt_two"}'::jsonb, now(), now()
  ),
  (
    '64000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'hunt-three@example.test', '', now(),
    '{"username":"hunt_three"}'::jsonb, now(), now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-0000-0000-000000000001',
  true
);

insert into public.games (id, gm_id, name, join_code)
values (
  '71000000-0000-0000-0000-000000000001',
  '61000000-0000-0000-0000-000000000001',
  'Time Hunt Test',
  'B1C2D3E4'
);

insert into public.game_players (game_id, profile_id, role)
values
  (
    '71000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000002',
    'player'
  ),
  (
    '71000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000003',
    'player'
  ),
  (
    '71000000-0000-0000-0000-000000000001',
    '64000000-0000-0000-0000-000000000004',
    'player'
  );

insert into public.characters (id, game_id, user_id, name)
values
  (
    '72000000-0000-0000-0000-000000000002',
    '71000000-0000-0000-0000-000000000001',
    '62000000-0000-0000-0000-000000000002',
    'Chrononaut One'
  ),
  (
    '73000000-0000-0000-0000-000000000003',
    '71000000-0000-0000-0000-000000000001',
    '63000000-0000-0000-0000-000000000003',
    'Chrononaut Two'
  ),
  (
    '74000000-0000-0000-0000-000000000004',
    '71000000-0000-0000-0000-000000000001',
    '64000000-0000-0000-0000-000000000004',
    'Chrononaut Three'
  );

select public.start_hunt('71000000-0000-0000-0000-000000000001');

select extensions.is(
  public.get_hunt_admin('71000000-0000-0000-0000-000000000001')->>'phase',
  'active',
  'GM can start the hunt'
);
select extensions.ok(
  (select status = 'active' and location_visibility = 'gm_only'
   from public.games
   where id = '71000000-0000-0000-0000-000000000001'),
  'starting a hunt activates the game and enforces GM-only positions'
);
reset role;

select extensions.is(
  (select count(*)::integer
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and state = 'alive'),
  3,
  'all three players begin alive'
);
select extensions.is(
  (select count(*)::integer
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = target_profile_id),
  0,
  'no player is assigned themselves'
);
select extensions.is(
  (select count(distinct target_profile_id)::integer
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'),
  3,
  'every player is hunted by exactly one other player'
);
select extensions.is(
  (select count(*)::integer
   from private.hunt_players hunter
   join private.hunt_players target
     on target.game_id = hunter.game_id
    and target.profile_id = hunter.target_profile_id
    and target.state = 'alive'
   where hunter.game_id = '71000000-0000-0000-0000-000000000001'),
  3,
  'every assignment points to a living participant'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '61000000-0000-0000-0000-000000000001',
  true
);
select extensions.throws_ok(
  $$
    update public.game_players
    set role = 'gm'
    where game_id = '71000000-0000-0000-0000-000000000001'
      and profile_id = '62000000-0000-0000-0000-000000000002'
  $$,
  '55000',
  'participant roles cannot change while the hunt is active',
  'active hunt membership is immutable'
);
select extensions.throws_ok(
  $$
    update public.games
    set location_visibility = 'all'
    where id = '71000000-0000-0000-0000-000000000001'
  $$,
  '55000',
  'an active hunt must remain active and GM-only',
  'active hunt location privacy cannot be weakened'
);

select set_config(
  'request.jwt.claim.sub',
  '62000000-0000-0000-0000-000000000002',
  true
);
select extensions.is(
  public.get_hunt_status('71000000-0000-0000-0000-000000000001')->>'phase',
  'active',
  'player sees the active phase'
);
select extensions.ok(
  public.get_hunt_status('71000000-0000-0000-0000-000000000001')
    #>> '{target,character_name}' is not null,
  'player sees their target character'
);
select extensions.ok(
  not public.get_hunt_status('71000000-0000-0000-0000-000000000001')
    ? 'hunter'
  and not (
    public.get_hunt_status('71000000-0000-0000-0000-000000000001')->'target'
  ) ? 'profile_id',
  'player status reveals neither hunter nor target profile id'
);

select public.request_elimination(
  '71000000-0000-0000-0000-000000000001'
);
select extensions.ok(
  (public.request_elimination(
    '71000000-0000-0000-0000-000000000001'
  )->>'already_pending')::boolean,
  'repeated elimination requests are idempotent'
);
reset role;

select extensions.is(
  (select count(*)::integer
   from private.hunt_claims
   where game_id = '71000000-0000-0000-0000-000000000001'
     and hunter_id = '62000000-0000-0000-0000-000000000002'
     and status = 'pending'),
  1,
  'idempotent request creates one pending claim'
);

select set_config(
  'test.first_target',
  (select target_profile_id::text
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = '62000000-0000-0000-0000-000000000002'),
  true
);
select set_config(
  'test.first_claim',
  (select id::text
   from private.hunt_claims
   where game_id = '71000000-0000-0000-0000-000000000001'
     and hunter_id = '62000000-0000-0000-0000-000000000002'
     and status = 'pending'),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.first_target'), true);
select extensions.ok(
  public.get_hunt_status('71000000-0000-0000-0000-000000000001')
    ->'incoming_claim' is not null,
  'target receives the confirmation request without hunter identity'
);
select extensions.ok(
  (public.respond_elimination(
    current_setting('test.first_claim')::uuid,
    false
  )->>'alive')::boolean,
  'target can reject an invalid elimination'
);
reset role;

select extensions.is(
  (select status
   from private.hunt_claims
   where id = current_setting('test.first_claim')::uuid),
  'rejected',
  'rejected claim is recorded'
);
select extensions.is(
  (select state
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = current_setting('test.first_target')::uuid),
  'alive',
  'rejection does not eliminate the target'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '62000000-0000-0000-0000-000000000002',
  true
);
select public.request_elimination(
  '71000000-0000-0000-0000-000000000001'
);
reset role;

select set_config(
  'test.second_claim',
  (select id::text
   from private.hunt_claims
   where game_id = '71000000-0000-0000-0000-000000000001'
     and hunter_id = '62000000-0000-0000-0000-000000000002'
     and status = 'pending'),
  true
);
select set_config(
  'test.inherited_target',
  (select target_profile_id::text
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = current_setting('test.first_target')::uuid),
  true
);

update public.game_players
set sharing_enabled = true,
    location_consent_at = now(),
    consent_revoked_at = null
where game_id = '71000000-0000-0000-0000-000000000001'
  and profile_id = current_setting('test.first_target')::uuid;
insert into public.player_positions (
  game_id, profile_id, geog, recorded_at
)
values (
  '71000000-0000-0000-0000-000000000001',
  current_setting('test.first_target')::uuid,
  extensions.st_setsrid(extensions.st_makepoint(23.3219, 42.6977), 4326)
    ::extensions.geography,
  now()
);

select extensions.ok(
  current_setting('test.second_claim', true) is not null,
  'a rejected claim can be requested again'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.first_target'), true);
select extensions.ok(
  not (public.respond_elimination(
    current_setting('test.second_claim')::uuid,
    true
  )->>'alive')::boolean,
  'target can confirm their elimination'
);
reset role;

select extensions.is(
  (select state
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = current_setting('test.first_target')::uuid),
  'eliminated',
  'confirmed target becomes eliminated'
);
select extensions.is(
  (select target_profile_id::text
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = '62000000-0000-0000-0000-000000000002'),
  current_setting('test.inherited_target'),
  'hunter inherits the eliminated target assignment'
);
select extensions.ok(
  (select hidden_until > now() + interval '9 minutes'
          and hidden_until <= now() + interval '10 minutes'
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = '62000000-0000-0000-0000-000000000002'),
  'confirmed hunter receives a ten-minute cloak'
);
select extensions.is(
  (select count(*)::integer
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and state = 'alive'),
  2,
  'two players remain after the first confirmed elimination'
);
select extensions.is(
  (select count(*)::integer
   from public.player_positions
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = current_setting('test.first_target')::uuid),
  0,
  'eliminated player latest position is removed'
);
select extensions.ok(
  not (select sharing_enabled
       from public.game_players
       where game_id = '71000000-0000-0000-0000-000000000001'
         and profile_id = current_setting('test.first_target')::uuid),
  'eliminated player location sharing is revoked'
);

select set_config(
  'test.p1_hunter',
  (select profile_id::text
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and state = 'alive'
     and target_profile_id = '62000000-0000-0000-0000-000000000002'),
  true
);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.p1_hunter'), true);
select extensions.is(
  public.get_hunt_status('71000000-0000-0000-0000-000000000001')
    #>> '{target,proximity,state}',
  'cloaked',
  'cloak suppresses proximity for the hunter targeting the winner'
);

select set_config('request.jwt.claim.sub', current_setting('test.first_target'), true);
select extensions.throws_ok(
  $$select public.request_elimination('71000000-0000-0000-0000-000000000001')$$,
  '42501',
  'not an active hunter',
  'eliminated players cannot request another elimination'
);

select set_config(
  'request.jwt.claim.sub',
  '62000000-0000-0000-0000-000000000002',
  true
);
select public.request_elimination(
  '71000000-0000-0000-0000-000000000001'
);
reset role;

select set_config(
  'test.final_target',
  (select target_profile_id::text
   from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and profile_id = '62000000-0000-0000-0000-000000000002'),
  true
);
select set_config(
  'test.final_claim',
  (select id::text
   from private.hunt_claims
   where game_id = '71000000-0000-0000-0000-000000000001'
     and hunter_id = '62000000-0000-0000-0000-000000000002'
     and status = 'pending'),
  true
);

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.final_target'), true);
select public.respond_elimination(
  current_setting('test.final_claim')::uuid,
  true
);
reset role;

select extensions.is(
  (select status from private.hunt_rounds
   where game_id = '71000000-0000-0000-0000-000000000001'),
  'finished',
  'last confirmed elimination finishes the hunt'
);
select extensions.is(
  (select status from public.games
   where id = '71000000-0000-0000-0000-000000000001'),
  'finished',
  'finished hunt also finishes the game'
);
select extensions.is(
  (select winner_id::text from private.hunt_rounds
   where game_id = '71000000-0000-0000-0000-000000000001'),
  '62000000-0000-0000-0000-000000000002',
  'last living player is recorded as winner'
);
select extensions.is(
  (select count(*)::integer from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and state = 'alive'),
  1,
  'exactly one player remains alive'
);
select extensions.is(
  (select count(*)::integer from private.hunt_players
   where game_id = '71000000-0000-0000-0000-000000000001'
     and state = 'alive'
     and target_profile_id is null),
  1,
  'winner has no further target'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '62000000-0000-0000-0000-000000000002',
  true
);
select extensions.ok(
  (public.get_hunt_status(
    '71000000-0000-0000-0000-000000000001'
  ) #>> '{winner,is_self}')::boolean,
  'winner status identifies the caller as the winner'
);
reset role;

select extensions.is(
  (select count(*)::integer from private.hunt_claims
   where game_id = '71000000-0000-0000-0000-000000000001'
     and status = 'pending'),
  0,
  'finished hunt leaves no pending claims'
);

select * from extensions.finish();
rollback;
