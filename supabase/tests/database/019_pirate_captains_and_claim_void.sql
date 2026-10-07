begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(32);

select extensions.ok(
  has_function_privilege('authenticated', 'public.pirate_set_captain(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pirate_set_captain(uuid,uuid,uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.gm_void_claim(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.gm_void_claim(uuid,uuid,text)', 'EXECUTE'),
  'captain and claim-void RPCs are authenticated only');

-- GM ...00 and players ...01-07. Crew 1 has players 1-3; crews 2-5 have one each.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
select ('19000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pirate-captain-' || n || '@example.test', '', now(),
       pg_catalog.jsonb_build_object('username', 'pirate_captain_' || n), now(), now()
from generate_series(0, 7) n;
insert into public.games (id, gm_id, name, join_code)
values ('19100000-0000-0000-0000-000000000001',
        '19000000-0000-0000-0000-000000000000', 'Pirate Captains', '19A0C0D1');
insert into public.game_players (game_id, profile_id, role)
select '19100000-0000-0000-0000-000000000001',
       ('19000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'player'
from generate_series(1, 7) n;
insert into public.factions (id, game_id, name)
select ('19200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '19100000-0000-0000-0000-000000000001', 'Crew ' || n
from generate_series(1, 5) n;
insert into public.characters (game_id, user_id, name, faction_id)
select '19100000-0000-0000-0000-000000000001',
       ('19000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Sailor ' || n,
       ('19200000-0000-0000-0000-' || lpad(greatest(n - 2, 1)::text, 12, '0'))::uuid
from generate_series(1, 7) n;
-- Zones 1-9 are riddles 143 m apart; 10-12 are lighthouses 357-643 m from treasure.
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
select ('19300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '19100000-0000-0000-0000-000000000001', 'Site ' || n,
       case when n <= 9
         then extensions.st_setsrid(extensions.st_makepoint(30 + n * 0.002, 50.01), 4326)::extensions.geography
         else extensions.st_setsrid(extensions.st_makepoint(30.005 + (n - 10) * 0.002, 50), 4326)::extensions.geography
       end, 20, 'silent'
from generate_series(1, 12) n;

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000000', true);
select public.pirate_enable('19100000-0000-0000-0000-000000000001');
select public.pirate_set_treasure('19100000-0000-0000-0000-000000000001', 50, 30);
reset role;
insert into private.pirate_sites (game_id, zone_id, kind, reward, oath_index, oath_word, prompt, answer_hash)
select '19100000-0000-0000-0000-000000000001', zone.id,
       case when n <= 9 then 'riddle' else 'lighthouse' end,
       case when n <= 5 then 'bearing' when n <= 9 then 'oath' end,
       case when n between 6 and 9 then n - 5 end,
       case when n between 6 and 9 then 'word' || (n - 5) end,
       case when n <= 9 then 'What is hidden?' end,
       case when n <= 9 then encode(extensions.digest('gold:' || zone.id::text, 'sha256'), 'hex') end
from generate_series(1, 12) n
join public.zones zone on zone.id = ('19300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;

-- Setup: the GM picks the captain of the three-player crew.
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000000', true);
select extensions.is(public.pirate_validate('19100000-0000-0000-0000-000000000001')->'issues',
  '["Every crew needs a captain"]'::jsonb,
  'a larger crew without a captain is the only setup issue');
select extensions.is(public.pirate_set_captain('19100000-0000-0000-0000-000000000001',
  '19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000004')->>'status',
  'not_in_crew', 'the captain must be a player in that crew');
select extensions.is(public.pirate_set_captain('19100000-0000-0000-0000-000000000001',
  '19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000002')->>'status',
  'ok', 'GM assigns the captain of a larger crew');
select extensions.is((public.pirate_validate('19100000-0000-0000-0000-000000000001')->>'ready')::boolean,
  true, 'one-player crews need no assignment');
select extensions.is(public.pirate_set_phase('19100000-0000-0000-0000-000000000001', 'charting', null)->>'status',
  'ok', 'charting opens with every crew captained');
select extensions.is(public.pirate_set_captain('19100000-0000-0000-0000-000000000001',
  '19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001')->>'status',
  'locked', 'captains lock once the game starts');
reset role;

select extensions.is((select count(*)::integer from private.pirate_captains
  where game_id = '19100000-0000-0000-0000-000000000001'), 5,
  'charting stores the four automatic one-player captains');
select extensions.is((select count(*)::integer from public.game_events
  where type = 'pirate_captain' and game_id = '19100000-0000-0000-0000-000000000001'), 3,
  'only the captained crew hears about its new captain');

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok(
  $$ select public.pirate_set_captain('19100000-0000-0000-0000-000000000001',
       '19200000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000003') $$,
  '42501', 'GM access required', 'a player cannot choose a captain');
select extensions.is(public.get_pirate_state('19100000-0000-0000-0000-000000000001')->'crew'->>'captain_name',
  'Sailor 2', 'every crewmate sees who the captain is');
select extensions.is(public.get_pirate_state('19100000-0000-0000-0000-000000000001')->>'is_captain',
  'false', 'a crewmate is not the captain');
reset role;

-- The compass: crew 1 has a shard; players 1-3 stand at a lighthouse and riddle 1.
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000000', true);
select public.pirate_set_phase('19100000-0000-0000-0000-000000000001', 'cursed', null);
reset role;
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, reason, actor_id)
values ('19100000-0000-0000-0000-000000000001', '19200000-0000-0000-0000-000000000001',
        'bearing', 1, 'gm', 'test seed', '19000000-0000-0000-0000-000000000000');
insert into public.player_positions (game_id, profile_id, geog, recorded_at)
select '19100000-0000-0000-0000-000000000001',
       ('19000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       extensions.st_setsrid(extensions.st_makepoint(30.005, 50), 4326)::extensions.geography, now()
from generate_series(1, 3) n;
insert into private.zone_state (zone_id, profile_id, inside, inside_since)
select zone_id::uuid, ('19000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       true, now() - interval '1 minute'
from generate_series(1, 3) n,
     unnest(array['19300000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000010']) zone_id;

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select extensions.is(public.compass_reading('19100000-0000-0000-0000-000000000001')->>'status',
  'not_captain', 'a crewmate cannot take a reading');
select extensions.is(public.treasure_band('19100000-0000-0000-0000-000000000001')->>'band',
  'not_captain', 'a crewmate gets no distance band');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
select extensions.is(public.compass_reading('19100000-0000-0000-0000-000000000001')->>'status',
  'ok', 'the captain takes the reading');
select extensions.is(pg_catalog.jsonb_array_length(
  public.get_pirate_state('19100000-0000-0000-0000-000000000001')->'readings'), 1,
  'the captain sees the reading logbook');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select extensions.ok(
  public.get_pirate_state('19100000-0000-0000-0000-000000000001')->'readings' = '[]'::jsonb
  and public.get_pirate_state('19100000-0000-0000-0000-000000000001')->'band' = 'null'::jsonb,
  'a crewmate sees no readings and no band');
reset role;
select extensions.is((select pg_catalog.array_agg(profile_id) from public.game_events
  where type = 'pirate_reading' and game_id = '19100000-0000-0000-0000-000000000001'),
  array['19000000-0000-0000-0000-000000000002'::uuid], 'only the captain receives the reading event');

-- One reward per crew: the first correct crewmate claims for everyone.
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select extensions.is(public.claim_site('19100000-0000-0000-0000-000000000001', 'gold',
  '19400000-0000-0000-0000-000000000001')->>'doubloons', '20', 'first crewmate claims for the crew');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select extensions.is(public.claim_site('19100000-0000-0000-0000-000000000001', 'gold',
  '19400000-0000-0000-0000-000000000002'),
  '{"status": "already_claimed", "claimed_by_name": "Sailor 1"}'::jsonb,
  'a later crewmate earns nothing and learns who solved it');
reset role;
select extensions.is((select sum(delta)::integer from private.pirate_ledger
  where faction_id = '19200000-0000-0000-0000-000000000001' and currency = 'doubloon'), 20,
  'the crew pool is credited once');

-- gm_void_claim reverses the claim. The claim ID travels in a setting
-- because the authenticated role cannot read private tables.
select set_config('test.claim_id', (select id::text from private.pirate_claims
  where faction_id = '19200000-0000-0000-0000-000000000001'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select extensions.throws_ok(
  $$ select public.gm_void_claim('19100000-0000-0000-0000-000000000001',
       current_setting('test.claim_id')::uuid, 'cheated') $$,
  '42501', 'GM access required', 'a player cannot void a claim');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000000', true);
select extensions.throws_ok(
  $$ select public.gm_void_claim('19100000-0000-0000-0000-000000000001',
       current_setting('test.claim_id')::uuid, 'no') $$,
  '22023', 'game, claim and correction reason are required', 'a void needs a reason');
select extensions.is(public.gm_void_claim('19100000-0000-0000-0000-000000000001',
  current_setting('test.claim_id')::uuid, 'Answer was phoned in from home')
  - 'claim_id', '{"status": "ok", "doubloons_reversed": 20, "shards_reversed": 1}'::jsonb,
  'GM voids the claim and reverses both rewards');
select extensions.is(public.gm_void_claim('19100000-0000-0000-0000-000000000001',
  current_setting('test.claim_id')::uuid, 'Answer was phoned in from home')->>'status',
  'already_voided', 'a claim is voided once');
select extensions.is(public.gm_void_claim('19100000-0000-0000-0000-000000000001',
  '19400000-0000-0000-0000-000000000009', 'Not a real claim')->>'status',
  'not_found', 'an unknown claim is reported');
reset role;

select extensions.ok(
  (select sum(delta) from private.pirate_ledger
   where faction_id = '19200000-0000-0000-0000-000000000001' and currency = 'doubloon') = 0
  and (select sum(delta) from private.pirate_ledger
       where faction_id = '19200000-0000-0000-0000-000000000001' and currency = 'bearing') = 1,
  'balances return to before the claim');
select extensions.is((select count(*)::integer from private.pirate_ledger
  where ref_id = current_setting('test.claim_id')::uuid and delta < 0
    and reason = 'Answer was phoned in from home'), 2,
  'the reversal is audited in the ledger');
select extensions.is((select count(*)::integer from public.game_events
  where type = 'pirate_ruling' and payload->>'action' = 'void_claim'), 7,
  'every player sees the Admiralty ruling');

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select extensions.is(public.claim_site('19100000-0000-0000-0000-000000000001', 'gold',
  '19400000-0000-0000-0000-000000000003')->>'rank', '1', 'the crew can solve the riddle again');
reset role;

-- A reward already lost in a Parley cannot be reversed below zero.
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, actor_id)
values ('19100000-0000-0000-0000-000000000001', '19200000-0000-0000-0000-000000000001',
        'doubloon', -15, 'parley', '19000000-0000-0000-0000-000000000000');
select set_config('test.claim_id', (select id::text from private.pirate_claims where voided_at is null), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000000', true);
select extensions.is(public.gm_void_claim('19100000-0000-0000-0000-000000000001',
  current_setting('test.claim_id')::uuid, 'Second look')->>'status',
  'insufficient_balance', 'a void never drives a balance negative');
reset role;
select extensions.is((select count(*)::integer from private.pirate_claims where voided_at is null), 1,
  'a refused void leaves the claim standing');

select * from extensions.finish();
rollback;
