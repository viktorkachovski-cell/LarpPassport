begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(13);

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

select * from extensions.finish();
rollback;
