begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(22);

select extensions.has_column('public', 'games', 'phase', 'games has a nullable Pirate phase');
select extensions.has_table('private', 'pirate_games', 'Pirate mode marker is private');
select extensions.ok(
  (select relrowsecurity from pg_class where oid = 'private.pirate_games'::regclass),
  'Pirate state has RLS enabled'
);
select extensions.ok(
  exists (select 1 from pg_policy where polrelid = 'private.pirate_games'::regclass),
  'Pirate state has an explicit deny policy'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'private.pirate_games', 'SELECT')
  and not has_table_privilege('authenticated', 'private.pirate_games', 'INSERT'),
  'authenticated clients have no direct Pirate table access'
);
select extensions.ok(
  not has_table_privilege('anon', 'private.pirate_games', 'SELECT'),
  'anonymous clients have no direct Pirate table access'
);
select extensions.ok(
  (select count(*) = 9 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'private' and c.relkind = 'r' and c.relname in (
     'pirate_games', 'pirate_sites', 'pirate_claims', 'pirate_attempts',
     'pirate_ledger', 'pirate_readings', 'pirate_parleys', 'pirate_mercy',
     'pirate_treasure_awards'
   )),
  'all nine Pirate tables exist'
);
select extensions.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname like 'pirate_%' and c.relkind = 'r'
      and not c.relrowsecurity
  ),
  'all Pirate tables enable RLS'
);
select extensions.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname like 'pirate_%' and c.relkind = 'r'
      and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
  ),
  'all Pirate tables have an explicit deny policy'
);
select extensions.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname like 'pirate_%' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'SELECT')
           or has_table_privilege('authenticated', c.oid, 'INSERT')
           or has_table_privilege('anon', c.oid, 'SELECT'))
  ),
  'no Pirate table grants direct client access'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-gm@example.test', '', now(),
   '{"username":"pirate_gm"}'::jsonb, now(), now()),
  ('b2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-one@example.test', '', now(),
   '{"username":"pirate_one"}'::jsonb, now(), now()),
  ('b3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-two@example.test', '', now(),
   '{"username":"pirate_two"}'::jsonb, now(), now());

insert into public.games (id, gm_id, name, join_code)
values
  ('b4000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000001', 'Pirate', 'B4A0C0D4'),
  ('b5000000-0000-0000-0000-000000000005', 'b1000000-0000-0000-0000-000000000001', 'Ordinary Hunt', 'B5A0C0D5');

select extensions.is(
  (select phase from public.games where id = 'b5000000-0000-0000-0000-000000000005'),
  null::text,
  'ordinary games have no Pirate phase'
);

insert into private.pirate_games (game_id)
values ('b4000000-0000-0000-0000-000000000004');

insert into public.factions (id, game_id, name)
values ('b6000000-0000-0000-0000-000000000006',
        'b4000000-0000-0000-0000-000000000004', 'Black Crew');
insert into public.zones (id, game_id, name, geog, radius_m)
values ('b7000000-0000-0000-0000-000000000007',
        'b5000000-0000-0000-0000-000000000005', 'Ordinary Zone',
        extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, 40);
-- The scoped foreign keys are deferred (cascade order on game deletion), so
-- check this one at statement time.
set constraints all immediate;
select extensions.throws_ok(
  $$ insert into private.pirate_sites (zone_id, game_id, kind)
     values ('b7000000-0000-0000-0000-000000000007',
             'b4000000-0000-0000-0000-000000000004', 'lighthouse') $$,
  '23503', null,
  'Pirate sites cannot reference a zone in another game'
);
set constraints all deferred;

insert into private.pirate_treasure_awards (game_id, faction_id, awarded_by)
values ('b4000000-0000-0000-0000-000000000004',
        'b6000000-0000-0000-0000-000000000006',
        'b1000000-0000-0000-0000-000000000001');
select extensions.throws_ok(
  $$ insert into private.pirate_treasure_awards (game_id, faction_id, awarded_by)
     values ('b4000000-0000-0000-0000-000000000004',
             'b6000000-0000-0000-0000-000000000006',
             'b1000000-0000-0000-0000-000000000001') $$,
  '23505', null,
  'one active treasure award per game'
);
update private.pirate_treasure_awards
set voided_at = now(), voided_by = 'b1000000-0000-0000-0000-000000000001',
    void_reason = 'test correction'
where game_id = 'b4000000-0000-0000-0000-000000000004';
select extensions.lives_ok(
  $$ insert into private.pirate_treasure_awards (game_id, faction_id, awarded_by)
     values ('b4000000-0000-0000-0000-000000000004',
             'b6000000-0000-0000-0000-000000000006',
             'b1000000-0000-0000-0000-000000000001') $$,
  'voiding keeps history and permits one new award'
);

select extensions.is(
  (select phase from public.games where id = 'b4000000-0000-0000-0000-000000000004'),
  'setup',
  'enabling Pirate mode initializes setup phase'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select extensions.throws_ok(
  $$ update public.games set phase = 'hoard'
     where id = 'b4000000-0000-0000-0000-000000000004' $$,
  '42501', 'Pirate phase must be changed through a GM action',
  'GM direct table update cannot skip Pirate phase gates'
);
select extensions.throws_ok(
  $$ update public.games set status = 'finished'
     where id = 'b4000000-0000-0000-0000-000000000004' $$,
  '42501', 'Pirate status follows the GM phase action',
  'GM direct table update cannot desynchronise Pirate status'
);
reset role;
select extensions.throws_ok(
  $$ insert into private.hunt_rounds (game_id, status, started_by)
     values ('b4000000-0000-0000-0000-000000000004', 'active',
             'b1000000-0000-0000-0000-000000000001') $$,
  '55000', 'Time Hunt cannot start in a Pirate game',
  'hunt mode cannot be mixed with Pirate mode'
);

insert into public.game_players (game_id, profile_id, role)
values
  ('b5000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000002', 'player'),
  ('b5000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000003', 'player');
insert into public.characters (game_id, user_id, name)
values
  ('b5000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000002', 'One'),
  ('b5000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000003', 'Two');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select extensions.lives_ok(
  $$ select public.start_hunt('b5000000-0000-0000-0000-000000000005') $$,
  'ordinary Time Hunt still starts'
);
reset role;

select extensions.ok(
  exists (select 1 from private.hunt_rounds
          where game_id = 'b5000000-0000-0000-0000-000000000005' and status = 'active'),
  'ordinary hunt state is intact'
);
select extensions.throws_ok(
  $$ insert into private.pirate_games (game_id)
     values ('b5000000-0000-0000-0000-000000000005') $$,
  '55000', 'Pirate mode cannot be enabled on a Time Hunt game',
  'existing Time Hunt state blocks Pirate mode'
);
select extensions.is(
  (select count(*)::integer from private.pirate_treasure_awards
   where game_id = 'b4000000-0000-0000-0000-000000000004'),
  2,
  'treasure award history retains both rows after a correction'
);

select * from extensions.finish();
rollback;
