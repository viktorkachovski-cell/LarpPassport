begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.ok(
  has_function_privilege('authenticated', 'public.gm_adjust(uuid,uuid,text,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.gm_adjust(uuid,uuid,text,integer,text)', 'EXECUTE'),
  'gm_adjust is an authenticated RPC only');

-- GM ...00, player ...01 in crew 1. Crew 2 belongs to another game.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
select ('21000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pirate-adjust-' || n || '@example.test', '', now(),
       pg_catalog.jsonb_build_object('username', 'pirate_adjust_' || n), now(), now()
from generate_series(0, 1) n;
insert into public.games (id, gm_id, name, join_code) values
  ('21100000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000000', 'Pirate Adjust', '21A0C0D1'),
  ('21100000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000000', 'Other Adjust', '21A0C0D2');
insert into public.game_players (game_id, profile_id, role)
values ('21100000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'player');
insert into public.factions (id, game_id, name) values
  ('21200000-0000-0000-0000-000000000001', '21100000-0000-0000-0000-000000000001', 'Black Crew'),
  ('21200000-0000-0000-0000-000000000002', '21100000-0000-0000-0000-000000000002', 'Other Crew');
insert into public.characters (game_id, user_id, name, faction_id)
values ('21100000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
        'Anne', '21200000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000000', true);
select public.pirate_enable('21100000-0000-0000-0000-000000000001');
select extensions.is(public.gm_adjust('21100000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000001', 'bearing', 2, 'Testing the compass'),
  '{"status": "ok", "currency": "bearing", "delta": 2, "balance": 2}'::jsonb,
  'the GM adds bearing shards');
select extensions.is(public.gm_adjust('21100000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000001', 'bearing', -3, 'Testing the compass'),
  '{"status": "insufficient_balance", "balance": 2}'::jsonb,
  'a balance never goes below zero');
select extensions.is(public.gm_adjust('21100000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000001', 'bearing', -1, 'Testing the compass')->>'balance',
  '1', 'the GM removes a bearing shard');
select extensions.is(public.gm_adjust('21100000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000001', 'doubloon', 15, 'Scored by hand')->>'balance',
  '15', 'the GM adds doubloons');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'bearing', 1, ' x ') $$,
  '22023', 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required',
  'a correction needs a reason');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'gold', 1, 'Testing the compass') $$,
  '22023', 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required',
  'only shards and doubloons can be adjusted');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'bearing', 0, 'Testing the compass') $$,
  '22023', 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required',
  'a zero amount is refused');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'doubloon', -1001, 'Testing the compass') $$,
  '22023', 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required',
  'an amount above 1000 is refused');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'doubloon', '-2147483648'::integer, 'Invalid amount') $$,
  '22023', 'game, crew, currency, an amount from 1 to 1000 and a correction reason are required',
  'minimum integer is rejected as invalid input rather than overflowing abs');
select extensions.is(public.gm_adjust('21100000-0000-0000-0000-000000000001',
  '21200000-0000-0000-0000-000000000002', 'bearing', 1, 'Testing the compass')->>'status',
  'not_found', 'a crew from another game cannot be adjusted');
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000002',
       '21200000-0000-0000-0000-000000000002', 'bearing', 1, 'Testing the compass') $$,
  '55000', 'Pirate mode is not enabled', 'an ordinary game has no Pirate balances');
reset role;

select extensions.is(
  (select pg_catalog.array_agg(delta order by id) from private.pirate_ledger
   where faction_id = '21200000-0000-0000-0000-000000000001' and source = 'gm'
     and actor_id = '21000000-0000-0000-0000-000000000000'
     and reason in ('Testing the compass', 'Scored by hand')),
  array[2, -1, 15], 'each adjustment is an audited GM ledger row; a refused one writes nothing');
select extensions.is(
  (select payload->>'message' from public.game_events
   where game_id = '21100000-0000-0000-0000-000000000001' and type = 'pirate_ruling'
     and profile_id = '21000000-0000-0000-0000-000000000001'
   order by seq limit 1),
  'The Admiralty has ruled: +2 bearing shards for Black Crew. Testing the compass',
  'the crew reads the ruling in its logbook');

set local role authenticated;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000001', true);
select extensions.throws_ok(
  $$ select public.gm_adjust('21100000-0000-0000-0000-000000000001',
       '21200000-0000-0000-0000-000000000001', 'bearing', 5, 'I deserve it') $$,
  '42501', 'GM access required', 'a player cannot adjust balances');
select extensions.is(public.get_pirate_state('21100000-0000-0000-0000-000000000001')->>'shards',
  '1', 'the player sees the adjusted shard count');
reset role;

select * from extensions.finish();
rollback;
