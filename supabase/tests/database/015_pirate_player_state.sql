begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-state-gm@example.test', '', now(),
   '{"username":"pirate_state_gm"}'::jsonb, now(), now()),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-state-one@example.test', '', now(),
   '{"username":"pirate_state_one"}'::jsonb, now(), now()),
  ('d3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-state-two@example.test', '', now(),
   '{"username":"pirate_state_two"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code) values
  ('d4000000-0000-0000-0000-000000000004', 'd1000000-0000-0000-0000-000000000001',
   'Pirate State', 'D4A0C0D4'),
  ('d5000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001',
   'Ordinary State', 'D5A0C0D5');
insert into public.game_players (game_id, profile_id, role) values
  ('d4000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000002', 'player'),
  ('d4000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003', 'player'),
  ('d5000000-0000-0000-0000-000000000005', 'd2000000-0000-0000-0000-000000000002', 'player');
insert into public.factions (id, game_id, name) values
  ('d6000000-0000-0000-0000-000000000006', 'd4000000-0000-0000-0000-000000000004', 'One'),
  ('d7000000-0000-0000-0000-000000000007', 'd4000000-0000-0000-0000-000000000004', 'Two');
insert into public.characters (game_id, user_id, name, faction_id) values
  ('d4000000-0000-0000-0000-000000000004', 'd2000000-0000-0000-0000-000000000002',
   'First', 'd6000000-0000-0000-0000-000000000006'),
  ('d4000000-0000-0000-0000-000000000004', 'd3000000-0000-0000-0000-000000000003',
   'Second', 'd7000000-0000-0000-0000-000000000007');
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
values ('d8000000-0000-0000-0000-000000000008',
        'd4000000-0000-0000-0000-000000000004', 'Oath Riddle',
        extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography,
        40, 'silent');
insert into private.pirate_games (game_id)
values ('d4000000-0000-0000-0000-000000000004');
insert into private.pirate_sites (game_id, zone_id, kind, reward, oath_index, oath_word, prompt, answer_hash)
values ('d4000000-0000-0000-0000-000000000004',
        'd8000000-0000-0000-0000-000000000008', 'riddle', 'oath', 1, 'Marrow', 'Speak',
        encode(extensions.digest('marrow:d8000000-0000-0000-0000-000000000008', 'sha256'), 'hex'));
insert into private.pirate_claims (game_id, zone_id, faction_id, claimed_by)
values ('d4000000-0000-0000-0000-000000000004',
        'd8000000-0000-0000-0000-000000000008',
        'd6000000-0000-0000-0000-000000000006',
        'd2000000-0000-0000-0000-000000000002');
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, actor_id, reason)
values ('d4000000-0000-0000-0000-000000000004',
        'd6000000-0000-0000-0000-000000000006', 'doubloon', 12, 'gm',
        'd1000000-0000-0000-0000-000000000001', 'State fixture');

select extensions.ok(has_function_privilege('authenticated', 'public.get_pirate_state(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_pirate_state(uuid)', 'EXECUTE'),
  'state is an authenticated RPC');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.get_pirate_state('d5000000-0000-0000-0000-000000000005')->>'is_pirate',
  'false', 'ordinary game remains ordinary');
select extensions.is(public.get_pirate_state('d4000000-0000-0000-0000-000000000004')->>'doubloons',
  '12', 'player sees own crew balance');
select extensions.is(public.get_pirate_state('d4000000-0000-0000-0000-000000000004')->'oath'->0->>'word',
  'Marrow', 'player sees a claimed oath word');
select extensions.ok(not (public.get_pirate_state('d4000000-0000-0000-0000-000000000004') ? 'hmac_secret')
  and not (public.get_pirate_state('d4000000-0000-0000-0000-000000000004') ? 'treasure_geog'),
  'player state omits secret values');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd3000000-0000-0000-0000-000000000003', true);
select extensions.is(public.get_pirate_state('d4000000-0000-0000-0000-000000000004')->'oath',
  '[]'::jsonb, 'another crew does not receive the oath word');
select extensions.is(public.get_pirate_state('d4000000-0000-0000-0000-000000000004')->>'doubloons',
  '0', 'another crew does not inherit the balance');
select extensions.throws_ok(
  $$ select public.get_pirate_state('d5000000-0000-0000-0000-000000000005') $$,
  '42501', 'game membership required', 'nonmember cannot read another game');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select extensions.is(public.get_pirate_state('d4000000-0000-0000-0000-000000000004')->>'role',
  'gm', 'GM mobile state does not expose player crew secrets');
reset role;

select * from extensions.finish();
rollback;
