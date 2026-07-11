begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(31);

select extensions.has_schema('private', 'private schema exists');
select extensions.is(
  (select n.nspname
   from pg_extension e
   join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'postgis'),
  'extensions',
  'PostGIS is installed in extensions'
);
select extensions.is(
  to_regclass('public.spatial_ref_sys'),
  null::regclass,
  'spatial_ref_sys is not exposed in public'
);
select extensions.is(
  to_regclass('extensions.spatial_ref_sys'),
  'extensions.spatial_ref_sys'::regclass,
  'spatial_ref_sys remains available to PostGIS'
);
select extensions.ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'profiles', 'games', 'game_players', 'factions', 'characters',
        'zones', 'player_positions', 'game_events', 'push_tokens',
        'character_changes'
      )
      and not c.relrowsecurity
  ),
  'all public app tables have RLS enabled'
);
select extensions.ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname in (
        'profiles', 'games', 'game_players', 'factions', 'characters',
        'zones', 'player_positions', 'game_events', 'push_tokens',
        'character_changes'
      )
    group by c.oid
    having count(p.polname) = 0
  ),
  'all public app tables have policies'
);
select extensions.ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'private'
      and c.relkind = 'r'
    group by c.oid, c.relrowsecurity
    having not c.relrowsecurity or count(p.polname) = 0
  ),
  'private tables have RLS and explicit deny policies'
);
select extensions.ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('zones_view', 'player_positions_view')
      and not coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
  ),
  'API views invoke base-table RLS'
);
select extensions.is(
  (select count(*)::integer
   from information_schema.table_privileges
   where grantee = 'anon'
     and table_schema in ('public', 'private')),
  0,
  'anonymous users have no app table grants'
);
select extensions.is(
  (select count(*)::integer
   from information_schema.table_privileges
   where grantee = 'authenticated'
     and table_schema = 'private'),
  0,
  'authenticated users have no private table grants'
);
select extensions.is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('join_game', 'set_location_consent', 'ingest_pings')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')),
  3,
  'authenticated users can execute only the intended API RPCs'
);
select extensions.is(
  (select count(*)::integer
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('join_game', 'set_location_consent', 'ingest_pings')
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'anonymous users cannot execute app RPCs'
);
select extensions.ok(
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef
      and not coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
  ),
  'security-definer functions use an empty search path'
);
select extensions.is(
  (select count(*)::integer from cron.job where jobname like 'purge-%'),
  3,
  'three bounded-retention jobs are scheduled'
);
select extensions.ok(
  (select command like '%game.purge_after_days%'
   from cron.job
   where jobname = 'purge-location-pings'),
  'location retention job uses the current game setting'
);
select extensions.is(
  (select count(*)::integer
   from pg_publication_tables
   where pubname = 'supabase_realtime'
     and schemaname = 'public'
     and tablename in (
       'characters', 'game_events', 'game_players', 'player_positions', 'zones'
     )),
  5,
  'only the five client realtime tables are published'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gm@example.test', '', now(),
    '{"username":"test_gm"}'::jsonb, now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'player@example.test', '', now(),
    '{"username":"test_player"}'::jsonb, now(), now()
  );

select extensions.is(
  (select count(*)::integer
   from public.profiles
   where id in (
     '10000000-0000-0000-0000-000000000001',
     '20000000-0000-0000-0000-000000000002'
   )),
  2,
  'Auth inserts create profiles'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);

insert into public.games (
  id, gm_id, name, join_code, template
)
values (
  '30000000-0000-0000-0000-000000000003',
  '10000000-0000-0000-0000-000000000001',
  'Test LARP',
  'A1B2C3D4',
  '{"stats":[{"key":"notes","type":"text","default":"","player_editable":true}]}'::jsonb
);

select extensions.is(
  (select count(*)::integer
   from public.game_players
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '10000000-0000-0000-0000-000000000001'
     and role = 'gm'),
  1,
  'game creator is automatically a GM member'
);
select extensions.is(
  (select count(*)::integer
   from public.games
   where id = '30000000-0000-0000-0000-000000000003'),
  1,
  'GM can read the newly created game'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);
select public.join_game('a1b2c3d4');

select extensions.is(
  (select count(*)::integer
   from public.game_players
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '20000000-0000-0000-0000-000000000002'),
  1,
  'player can join using a case-insensitive code'
);
select extensions.is(
  (select count(*)::integer from public.zones),
  0,
  'players cannot read GM-only zone geometry'
);

select public.set_location_consent(
  '30000000-0000-0000-0000-000000000003',
  true
);
reset role;

select extensions.ok(
  (select sharing_enabled
   from public.game_players
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '20000000-0000-0000-0000-000000000002'),
  'location sharing requires recorded consent'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-0000-0000-000000000001',
  true
);
update public.games
set status = 'active'
where id = '30000000-0000-0000-0000-000000000003';

insert into public.zones (
  id, game_id, name, geog, radius_m, trigger_mode
)
values (
  '40000000-0000-0000-0000-000000000004',
  '30000000-0000-0000-0000-000000000003',
  'Test Zone',
  extensions.st_setsrid(extensions.st_makepoint(23.3219, 42.6977), 4326)
    ::extensions.geography,
  100,
  'auto'
);

select extensions.is(
  (select count(*)::integer
   from public.zones
   where id = '40000000-0000-0000-0000-000000000004'),
  1,
  'GM can create and read a PostGIS zone'
);

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);
insert into public.characters (
  id, game_id, user_id, name, fields
)
values (
  '50000000-0000-0000-0000-000000000005',
  '30000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000002',
  'Test Character',
  jsonb_build_object('notes', repeat('x', 4000))
);

select extensions.is(
  (select char_length(fields->>'notes')
   from public.characters
   where id = '50000000-0000-0000-0000-000000000005'),
  4000,
  'character text accepts the documented 4,000-character maximum'
);
select extensions.throws_ok(
  $$
    update public.characters
    set fields = jsonb_build_object('notes', repeat('x', 4001))
    where id = '50000000-0000-0000-0000-000000000005'
  $$,
  'P0001',
  'field "notes" must be text no longer than 4000 characters',
  'character text rejects values above the maximum'
);

select set_config('test.ping_time', now()::text, true);
select extensions.is(
  (
    public.ingest_pings(
      '30000000-0000-0000-0000-000000000003',
      jsonb_build_array(jsonb_build_object(
        'lat', 42.6977,
        'lng', 23.3219,
        'accuracy', 5,
        'recorded_at', current_setting('test.ping_time'),
        'battery', 80
      )),
      0
    )->>'accepted'
  )::integer,
  1,
  'first location ping is accepted'
);
select extensions.is(
  (
    public.ingest_pings(
      '30000000-0000-0000-0000-000000000003',
      jsonb_build_array(jsonb_build_object(
        'lat', 42.6977,
        'lng', 23.3219,
        'accuracy', 5,
        'recorded_at', current_setting('test.ping_time'),
        'battery', 80
      )),
      0
    )->>'accepted'
  )::integer,
  0,
  'duplicate location ping is idempotent'
);
reset role;

select extensions.is(
  (select count(*)::integer
   from private.location_pings
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '20000000-0000-0000-0000-000000000002'),
  1,
  'raw trail stores one deduplicated ping'
);
select extensions.is(
  (select count(*)::integer
   from public.player_positions
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '20000000-0000-0000-0000-000000000002'),
  1,
  'latest player position is upserted'
);
select extensions.is(
  (select count(*)::integer
   from private.zone_state
   where zone_id = '40000000-0000-0000-0000-000000000004'
     and profile_id = '20000000-0000-0000-0000-000000000002'
     and inside),
  1,
  'zone evaluation records an inside state'
);
select extensions.is(
  (select count(*)::integer
   from public.game_events
   where game_id = '30000000-0000-0000-0000-000000000003'
     and profile_id = '20000000-0000-0000-0000-000000000002'
     and type = 'zone_enter'),
  1,
  'automatic zone entry emits one event'
);

select * from extensions.finish();
rollback;
