begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(9);

-- A test run: GM ...00, players ...01-03. Player 3 joins without a character.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
select ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pirate-flexible-' || n || '@example.test', '', now(),
       pg_catalog.jsonb_build_object('username', 'pirate_flexible_' || n), now(), now()
from generate_series(0, 3) n;
insert into public.games (id, gm_id, name, join_code)
values ('20100000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000000', 'Pirate Test Run', '20A0C0D1');
insert into public.game_players (game_id, profile_id, role)
select '20100000-0000-0000-0000-000000000001',
       ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'player'
from generate_series(1, 3) n;
-- The riddle is 1.1 km north of the treasure; the lighthouse 72 m east of it.
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode) values
  ('20300000-0000-0000-0000-000000000001', '20100000-0000-0000-0000-000000000001', 'Riddle',
   extensions.st_setsrid(extensions.st_makepoint(30, 50.01), 4326)::extensions.geography, 20, 'silent'),
  ('20300000-0000-0000-0000-000000000002', '20100000-0000-0000-0000-000000000001', 'Lighthouse',
   extensions.st_setsrid(extensions.st_makepoint(30.001, 50), 4326)::extensions.geography, 20, 'silent');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000000', true);
select public.pirate_enable('20100000-0000-0000-0000-000000000001');
select extensions.is(public.pirate_validate('20100000-0000-0000-0000-000000000001')->'issues',
  '["At least one crew is required", "The secret treasure point is required"]'::jsonb,
  'a game still needs a crew and the treasure point');
select public.pirate_set_site('20100000-0000-0000-0000-000000000001',
  '20300000-0000-0000-0000-000000000001', 'riddle', 'bearing', null, null,
  'What is the tide?', 'Black Tide');
select public.pirate_set_site('20100000-0000-0000-0000-000000000001',
  '20300000-0000-0000-0000-000000000002', 'lighthouse', null, null, null, null, null);
select public.pirate_set_treasure('20100000-0000-0000-0000-000000000001', 50, 30);
reset role;

-- Players 1 and 2 share a crew at first.
insert into public.factions (id, game_id, name)
select ('20200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '20100000-0000-0000-0000-000000000001', 'Crew ' || n
from generate_series(1, 2) n;
insert into public.characters (game_id, user_id, name, faction_id)
select '20100000-0000-0000-0000-000000000001',
       ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Sailor ' || n,
       '20200000-0000-0000-0000-000000000001'
from generate_series(1, 2) n;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000000', true);
select extensions.is(public.pirate_validate('20100000-0000-0000-0000-000000000001')->'issues',
  '["Every crew needs a captain"]'::jsonb,
  'a two-player crew without a captain still blocks charting');
reset role;
update public.characters set faction_id = '20200000-0000-0000-0000-000000000002'
where game_id = '20100000-0000-0000-0000-000000000001'
  and user_id = '20000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000000', true);
select extensions.is((public.pirate_validate('20100000-0000-0000-0000-000000000001')->>'ready')::boolean,
  true, 'two one-player crews, one riddle and one lighthouse can start');
select extensions.is(public.pirate_validate('20100000-0000-0000-0000-000000000001')->'warnings',
  pg_catalog.jsonb_build_array(
    'The event plan has 5 crews; this game has 2',
    '1 player(s) have no crew yet and cannot claim riddles until they get one',
    'Bearing riddles: 1 of the 5 planned',
    'Oath riddles: 0 of the 4 planned',
    'Lighthouses: 1 of the 3 planned',
    '1 lighthouse(s) are not 200 to 1500 metres from the treasure; their bearings cross poorly'),
  'differences from the event plan are warnings');
select extensions.ok(exists (
    select 1 from pg_catalog.jsonb_array_elements(
      public.gm_pirate_overview('20100000-0000-0000-0000-000000000001')->'sites') site
    where site->>'prompt' = 'What is the tide?' and not site ? 'answer_hash'),
  'the GM overview returns the riddle prompt but not its answer');
select extensions.is(public.pirate_set_phase('20100000-0000-0000-0000-000000000001', 'charting', null)->>'status',
  'ok', 'charting opens with the small layout');
select extensions.is(public.pirate_set_phase('20100000-0000-0000-0000-000000000001', 'cursed', null)->>'status',
  'ok', 'the curse wakes');
reset role;

-- Sailor 1 holds one shard and stands in the only lighthouse.
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, actor_id, reason)
values ('20100000-0000-0000-0000-000000000001', '20200000-0000-0000-0000-000000000001',
        'bearing', 1, 'gm', '20000000-0000-0000-0000-000000000000', 'Test shard');
insert into public.player_positions (game_id, profile_id, geog, recorded_at)
values ('20100000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
        extensions.st_setsrid(extensions.st_makepoint(30.001, 50), 4326)::extensions.geography, now());
insert into private.zone_state (zone_id, profile_id, inside, inside_since)
values ('20300000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001',
        true, now() - interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select extensions.is(public.get_pirate_state('20100000-0000-0000-0000-000000000001')->>'is_captain',
  'true', 'the only player of a crew carries the compass');
select extensions.is(public.compass_reading('20100000-0000-0000-0000-000000000001')->>'status',
  'ok', 'the only lighthouse gives a reading');
reset role;

select * from extensions.finish();
rollback;
