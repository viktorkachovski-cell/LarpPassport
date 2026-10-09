begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(21);

-- Six crews, 25 players, five players in crew 1; no attendance ceiling.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
select ('23000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'pirate-uncapped-' || n || '@example.test', '', now(),
  jsonb_build_object('username', 'pirate_uncapped_' || n), now(), now()
from generate_series(0, 25) n;
insert into public.games (id, gm_id, name, join_code)
values ('23100000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000000', 'Uncapped Pirate', '23A0C0D1');
insert into public.game_players (game_id, profile_id, role)
select '23100000-0000-0000-0000-000000000001',
  ('23000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'player'
from generate_series(1, 25) n;
insert into public.factions (id, game_id, name)
select ('23200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  '23100000-0000-0000-0000-000000000001', 'Crew ' || n
from generate_series(1, 6) n;
insert into public.characters (game_id, user_id, name, faction_id)
select '23100000-0000-0000-0000-000000000001',
  ('23000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Sailor ' || n,
  ('23200000-0000-0000-0000-' ||
    lpad((case when n <= 5 then 1 else 2 + (n - 6) / 4 end)::text, 12, '0'))::uuid
from generate_series(1, 25) n;
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
values ('23300000-0000-0000-0000-000000000001',
  '23100000-0000-0000-0000-000000000001', 'Riddle',
  extensions.st_setsrid(extensions.st_makepoint(30, 50.01),4326)::extensions.geography, 20, 'silent');

set local role authenticated;
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000000',true);
select public.pirate_enable('23100000-0000-0000-0000-000000000001');
select public.pirate_set_treasure('23100000-0000-0000-0000-000000000001',50,30);
select public.pirate_set_site('23100000-0000-0000-0000-000000000001',
  '23300000-0000-0000-0000-000000000001','riddle','bearing',null,null,'What is the tide?','gold');
select extensions.is(public.pirate_validate('23100000-0000-0000-0000-000000000001')->'issues',
  '["Every crew needs a captain"]'::jsonb, 'large crews still need captains');
select public.pirate_set_captain('23100000-0000-0000-0000-000000000001',
  ('23200000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('23000000-0000-0000-0000-' || lpad((case when n = 1 then 1 else 6 + (n-2)*4 end)::text,12,'0'))::uuid)
from generate_series(1,6) n;
select extensions.is(public.pirate_validate('23100000-0000-0000-0000-000000000001')->'issues',
  '[]'::jsonb, 'six crews and 25 players have no attendance blockers');
select extensions.is(public.pirate_validate('23100000-0000-0000-0000-000000000001')->'counts'->>'players',
  '25','all players are counted');
select extensions.is(public.pirate_validate('23100000-0000-0000-0000-000000000001')->'counts'->>'crews',
  '6','all crews are counted');
select extensions.is(public.pirate_validate('23100000-0000-0000-0000-000000000001')->'warnings',
  jsonb_build_array('The event plan has 5 crews; this game has 6',
    'Bearing riddles: 1 of the 5 planned','Oath riddles: 0 of the 4 planned',
    'Lighthouses: 0 of the 3 planned'),
  'only planning/site warnings remain, with no crew-size cap');
select extensions.is(public.pirate_set_phase('23100000-0000-0000-0000-000000000001','charting',null)->>'status',
  'ok','charting starts with six crews');
select extensions.is(jsonb_array_length(public.gm_pirate_overview('23100000-0000-0000-0000-000000000001')->'crews'),
  6,'GM overview includes every crew');
select extensions.is((select jsonb_array_length(crew->'members')
  from jsonb_array_elements(public.gm_pirate_overview('23100000-0000-0000-0000-000000000001')->'crews') crew
  where crew->>'id'='23200000-0000-0000-0000-000000000001'),5,'GM overview includes fifth member');
reset role;

insert into public.player_positions (game_id,profile_id,geog,recorded_at)
values ('23100000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000005',
  extensions.st_setsrid(extensions.st_makepoint(30,50.01),4326)::extensions.geography,now());
insert into private.zone_state (zone_id,profile_id,inside,inside_since)
values ('23300000-0000-0000-0000-000000000001','23000000-0000-0000-0000-000000000005',true,now()-interval '1 minute');
set local role authenticated;
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000005',true);
select extensions.is(public.claim_site('23100000-0000-0000-0000-000000000001','gold',
  '23400000-0000-0000-0000-000000000001')->>'status','ok','fifth member can claim for their crew');
reset role;
select extensions.is((select count(*)::integer from public.game_events
  where game_id='23100000-0000-0000-0000-000000000001' and type='pirate_claim'),
  5,'claim event reaches all five members');

-- All remaining crews solve the same riddle, including the sixth.
insert into public.player_positions (game_id,profile_id,geog,recorded_at)
select '23100000-0000-0000-0000-000000000001',
  ('23000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  extensions.st_setsrid(extensions.st_makepoint(30,50.01),4326)::extensions.geography,now()
from generate_series(1,25) n
on conflict (game_id,profile_id) do update set recorded_at=excluded.recorded_at;
insert into private.zone_state (zone_id,profile_id,inside,inside_since)
select '23300000-0000-0000-0000-000000000001',
  ('23000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,true,now()-interval '1 minute'
from generate_series(1,25) n
on conflict (zone_id,profile_id) do nothing;
create temporary table claim_results (crew integer primary key, result jsonb);
grant all on claim_results to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000005',true);
insert into claim_results values (1,public.claim_site(
  '23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000001'));
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000006',true);
insert into claim_results values (2,public.claim_site('23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000006'));
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000010',true);
insert into claim_results values (3,public.claim_site('23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000010'));
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000014',true);
insert into claim_results values (4,public.claim_site('23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000014'));
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000018',true);
insert into claim_results values (5,public.claim_site('23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000018'));
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000022',true);
insert into claim_results values (6,public.claim_site('23100000-0000-0000-0000-000000000001','gold','23400000-0000-0000-0000-000000000022'));
select extensions.is((select array_agg((result->>'rank')::integer order by crew) from claim_results),
  array[1,2,3,4,5,6], 'six crews have full successful-answer ranks');
select extensions.is((select array_agg((result->>'doubloons')::integer order by crew) from claim_results),
  array[20,15,10,5,5,5], 'sixth crew earns five doubloons, as do fourth and fifth');
select extensions.is(public.claim_site('23100000-0000-0000-0000-000000000001','gold',
  '23400000-0000-0000-0000-000000000022'),(select result from claim_results where crew=6),
  'sixth-crew retry returns the saved payout and rank');
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000025',true);
select extensions.is(public.claim_site('23100000-0000-0000-0000-000000000001','gold',
  '23400000-0000-0000-0000-000000000025')->>'status','already_claimed',
  'later crewmate cannot duplicate sixth-place rewards');
reset role;
select extensions.is((select rank from private.pirate_claims
  where game_id='23100000-0000-0000-0000-000000000001'
    and faction_id='23200000-0000-0000-0000-000000000006' and voided_at is null),
  6,'sixth rank persists in the claim board');
select extensions.is((select sum(delta)::integer from private.pirate_ledger
  where game_id='23100000-0000-0000-0000-000000000001'
    and faction_id='23200000-0000-0000-0000-000000000006' and currency='doubloon'),
  5,'sixth crew is credited once');
select extensions.col_type_is('private','pirate_claims','rank','integer',
  'rank has no smallint attendance ceiling');
select extensions.throws_ok($$update private.pirate_claims set rank=0
  where game_id='23100000-0000-0000-0000-000000000001'$$,
  '23514',null,'successful ranks must remain positive');
insert into claim_results values (0,jsonb_build_object('id',(select id from private.pirate_claims where faction_id='23200000-0000-0000-0000-000000000006' and game_id='23100000-0000-0000-0000-000000000001' and voided_at is null)));
set local role authenticated;
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000000',true);
select extensions.is(public.gm_void_claim('23100000-0000-0000-0000-000000000001',
  (select (result->>'id')::uuid from claim_results where crew=0),
  'Wrong riddle corrected')->>'doubloons_reversed','5','void reverses a sixth-place payout');
reset role;
select extensions.is((select sum(delta)::integer from private.pirate_ledger
  where game_id='23100000-0000-0000-0000-000000000001'
    and faction_id='23200000-0000-0000-0000-000000000006' and currency='doubloon'),
  0,'void leaves the late crew balance correct');
set local role authenticated;
select set_config('request.jwt.claim.sub','23000000-0000-0000-0000-000000000022',true);
select extensions.is(public.claim_site('23100000-0000-0000-0000-000000000001','gold',
  '23400000-0000-0000-0000-000000000122')->>'doubloons','5','late crew can reclaim for five after a void');
reset role;

select * from extensions.finish();
rollback;
