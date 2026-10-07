begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-claim-gm@example.test', '', now(),
   '{"username":"pirate_claim_gm"}'::jsonb, now(), now()),
  ('a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-claim-one@example.test', '', now(),
   '{"username":"pirate_claim_one"}'::jsonb, now(), now()),
  ('a3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-claim-two@example.test', '', now(),
   '{"username":"pirate_claim_two"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values ('a4000000-0000-0000-0000-000000000004',
        'a1000000-0000-0000-0000-000000000001', 'Pirate Claims', 'A4A0C0D4');
insert into public.game_players (game_id, profile_id, role) values
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'player'),
  ('a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003', 'player');
insert into public.factions (id, game_id, name) values
  ('a5000000-0000-0000-0000-000000000005', 'a4000000-0000-0000-0000-000000000004', 'Crew One'),
  ('a6000000-0000-0000-0000-000000000006', 'a4000000-0000-0000-0000-000000000004', 'Crew Two');
insert into public.characters (game_id, user_id, name, faction_id) values
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002',
   'One', 'a5000000-0000-0000-0000-000000000005'),
  ('a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003',
   'Two', 'a6000000-0000-0000-0000-000000000006');
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode) values
  ('a7000000-0000-0000-0000-000000000007', 'a4000000-0000-0000-0000-000000000004',
   'Riddle Rock', extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography,
   40, 'silent');
insert into private.pirate_games (game_id) values ('a4000000-0000-0000-0000-000000000004');
update public.games set phase = 'charting', status = 'active'
where id = 'a4000000-0000-0000-0000-000000000004';
insert into private.pirate_sites (game_id, zone_id, kind, reward, prompt, answer_hash) values
  ('a4000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000007',
   'riddle', 'bearing', 'What is hidden?',
   encode(extensions.digest('gold:a7000000-0000-0000-0000-000000000007', 'sha256'), 'hex'));
insert into public.player_positions (game_id, profile_id, geog, recorded_at) values
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002',
   extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, now()),
  ('a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003',
   extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, now());
insert into private.zone_state (zone_id, profile_id, inside, inside_since) values
  ('a7000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000002', true, now() - interval '1 minute'),
  ('a7000000-0000-0000-0000-000000000007', 'a3000000-0000-0000-0000-000000000003', true, now() - interval '1 minute');

select extensions.ok(
  has_function_privilege('authenticated', 'public.claim_site(uuid,text,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.claim_site(uuid,text,uuid)', 'EXECUTE'),
  'claim RPC is authenticated only');
select extensions.lives_ok(
  $$ select extensions.hmac(convert_to('sample', 'UTF8'), decode(repeat('ab',32),'hex'), 'sha256') $$,
  'request HMAC uses a supported bytea signature');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select extensions.throws_ok(
  $$ select public.site_here('a4000000-0000-0000-0000-000000000004') $$,
  '42501', 'player membership required', 'GM does not receive player site prompts');
select extensions.throws_ok(
  $$ select public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
       'a8000000-0000-0000-0000-000000000008') $$,
  '42501', 'player membership required', 'GM cannot claim as a player');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.site_here('a4000000-0000-0000-0000-000000000004')->>'prompt',
  'What is hidden?', 'inside player sees the site prompt');
select extensions.ok(not (public.site_here('a4000000-0000-0000-0000-000000000004') ? 'answer_hash'),
  'site discovery never returns the answer hash');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'silver',
  'a8000000-0000-0000-0000-000000000008')->>'status', 'wrong', 'wrong answer is rejected');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'silver',
  'a8000000-0000-0000-0000-000000000008')->>'status', 'wrong', 'wrong answer retry is stable');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
  'a8000000-0000-0000-0000-000000000008')->>'status', 'idempotency_conflict',
  'same request ID cannot change the answer');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
  'a9000000-0000-0000-0000-000000000009')->>'doubloons', '20',
  'first crew to solve receives the first doubloon payout');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
  'a9000000-0000-0000-0000-000000000009')->>'doubloons', '20',
  'successful retry returns the original payout');
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
  'aa000000-0000-0000-0000-00000000000a')->>'status', 'already_claimed',
  'same crew cannot claim the riddle again');
reset role;

select extensions.is((select count(*)::integer from private.pirate_claims), 1,
  'retries created only one claim');
select extensions.is((select coalesce(sum(delta),0)::integer from private.pirate_ledger where currency = 'doubloon'), 20,
  'retries credited doubloons only once');
select extensions.is((select coalesce(sum(delta),0)::integer from private.pirate_ledger where currency = 'bearing'), 1,
  'a bearing riddle also gives one shard');
select extensions.is((select count(*)::integer from private.pirate_attempts where not ok), 1,
  'wrong answer retry consumed only one attempt');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a3000000-0000-0000-0000-000000000003', true);
select extensions.is(public.claim_site('a4000000-0000-0000-0000-000000000004', 'gold',
  'ab000000-0000-0000-0000-00000000000b')->>'doubloons', '15',
  'second crew to solve receives the second doubloon payout');
reset role;
select extensions.is((select count(*)::integer from public.game_events where type = 'pirate_claim'), 2,
  'each crew receives only its own one-player claim event');

select extensions.throws_ok(
  $$ insert into private.pirate_sites (game_id, zone_id, kind) values
       ('a4000000-0000-0000-0000-000000000004', 'a7000000-0000-0000-0000-000000000007', 'cache') $$,
  '23514', null, 'caches, harbours and treasure sites no longer exist');

select * from extensions.finish();
rollback;
