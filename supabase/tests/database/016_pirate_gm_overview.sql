begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('e1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-overview-gm@example.test', '', now(),
   '{"username":"pirate_overview_gm"}'::jsonb, now(), now()),
  ('e2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-overview-player@example.test', '', now(),
   '{"username":"pirate_overview_player"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code) values
  ('e3000000-0000-0000-0000-000000000003',
   'e1000000-0000-0000-0000-000000000001', 'Pirate Overview', 'E3A0C0D3'),
  ('e4000000-0000-0000-0000-000000000004',
   'e1000000-0000-0000-0000-000000000001', 'Ordinary Overview', 'E4A0C0D4');
insert into public.game_players (game_id, profile_id, role)
values ('e3000000-0000-0000-0000-000000000003',
        'e2000000-0000-0000-0000-000000000002', 'player');
insert into private.pirate_games (game_id, treasure_geog)
values ('e3000000-0000-0000-0000-000000000003',
        extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography);
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
values ('e5000000-0000-0000-0000-000000000005',
        'e3000000-0000-0000-0000-000000000003', 'Oath Site',
        extensions.st_setsrid(extensions.st_makepoint(30.01, 50), 4326)::extensions.geography,
        40, 'silent');
insert into private.pirate_sites (game_id, zone_id, kind, reward, oath_index, oath_word, prompt, answer_hash)
values ('e3000000-0000-0000-0000-000000000003',
        'e5000000-0000-0000-0000-000000000005', 'riddle', 'oath', 1, 'Marrow', 'Speak',
        encode(extensions.digest('marrow:e5000000-0000-0000-0000-000000000005', 'sha256'), 'hex'));

select extensions.ok(has_function_privilege('authenticated', 'public.gm_pirate_overview(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.gm_pirate_overview(uuid)', 'EXECUTE'),
  'overview is an authenticated RPC');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok(
  $$ select public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003') $$,
  '42501', 'GM access required', 'player cannot inspect GM overview');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000001', true);
select extensions.is(public.gm_pirate_overview('e4000000-0000-0000-0000-000000000004')->>'is_pirate',
  'false', 'ordinary game has no Pirate overview');
select extensions.is(public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003')->'treasure'->>'lat',
  '50', 'GM can see the configured treasure point');
select extensions.is(public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003')->'sites'->0->>'answer_set',
  'true', 'GM sees only whether an answer is set');
select extensions.ok(
  not (public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003') ? 'hmac_secret')
  and not (public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003')->'sites'->0 ? 'answer_hash')
  and not (public.gm_pirate_overview('e3000000-0000-0000-0000-000000000003')->'sites'->0 ? 'oath_word'),
  'GM overview does not export answers, oath words or secret');
reset role;

select * from extensions.finish();
rollback;
