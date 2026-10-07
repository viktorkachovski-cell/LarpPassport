begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(7);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('f1000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-owner@example.test', '', now(),
   '{"username":"pirate_owner"}'::jsonb, now(), now()),
  ('f2000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-second-gm@example.test', '', now(),
   '{"username":"pirate_second_gm"}'::jsonb, now(), now()),
  ('f3000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-new-gm@example.test', '', now(),
   '{"username":"pirate_new_gm"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values
  ('f4000000-0000-0000-0000-000000000014', 'f1000000-0000-0000-0000-000000000011',
   'Pirate Roles', 'F4A0C0D4'),
  ('f5000000-0000-0000-0000-000000000015', 'f1000000-0000-0000-0000-000000000011',
   'Ordinary Roles', 'F5A0C0D5');
insert into public.game_players (game_id, profile_id, role)
values
  ('f4000000-0000-0000-0000-000000000014', 'f2000000-0000-0000-0000-000000000012', 'gm'),
  ('f4000000-0000-0000-0000-000000000014', 'f3000000-0000-0000-0000-000000000013', 'player'),
  ('f5000000-0000-0000-0000-000000000015', 'f2000000-0000-0000-0000-000000000012', 'gm');
insert into private.pirate_games (game_id)
values ('f4000000-0000-0000-0000-000000000014');

select extensions.throws_ok(
  $$ update public.game_players set role = 'player'
     where game_id = 'f4000000-0000-0000-0000-000000000014'
       and profile_id = 'f1000000-0000-0000-0000-000000000011' $$,
  '55000', 'cannot remove the game owner GM', 'owner GM cannot be demoted'
);
select extensions.throws_ok(
  $$ delete from public.game_players
     where game_id = 'f4000000-0000-0000-0000-000000000014'
       and profile_id = 'f1000000-0000-0000-0000-000000000011' $$,
  '55000', 'cannot remove the game owner GM', 'owner GM cannot be removed'
);
select extensions.lives_ok(
  $$ update public.game_players set role = 'gm'
     where game_id = 'f4000000-0000-0000-0000-000000000014'
       and profile_id = 'f3000000-0000-0000-0000-000000000013' $$,
  'existing membership path can promote a second GM'
);
select extensions.lives_ok(
  $$ update public.game_players set role = 'player'
     where game_id = 'f4000000-0000-0000-0000-000000000014'
       and profile_id = 'f2000000-0000-0000-0000-000000000012' $$,
  'non-owner GM can be demoted while another GM remains'
);
select extensions.is(
  (select count(*)::integer from public.game_players
   where game_id = 'f4000000-0000-0000-0000-000000000014' and role = 'gm'),
  2, 'owner and replacement GM remain available'
);
select extensions.lives_ok(
  $$ update public.game_players set role = 'player'
     where game_id = 'f5000000-0000-0000-0000-000000000015'
       and profile_id = 'f2000000-0000-0000-0000-000000000012' $$,
  'ordinary game role behavior is unchanged'
);
select extensions.lives_ok(
  $$ delete from public.games where id = 'f4000000-0000-0000-0000-000000000014' $$,
  'game deletion still cascades through Pirate state and membership'
);

select * from extensions.finish();
rollback;
