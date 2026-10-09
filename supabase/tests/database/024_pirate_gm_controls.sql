begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(96);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
select ('24000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'pirate-captain-' || n || '@example.test', '', now(),
       pg_catalog.jsonb_build_object('username', 'pirate_captain_' || n), now(), now()
from generate_series(0, 7) n;
insert into public.games (id, gm_id, name, join_code)
values ('24100000-0000-0000-0000-000000000001',
        '24000000-0000-0000-0000-000000000000', 'Pirate Captains', '24A0C0D1');
insert into public.game_players (game_id, profile_id, role)
select '24100000-0000-0000-0000-000000000001',
       ('24000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'player'
from generate_series(1, 7) n;
insert into public.factions (id, game_id, name)
select ('24200000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '24100000-0000-0000-0000-000000000001', 'Crew ' || n
from generate_series(1, 5) n;
insert into public.characters (game_id, user_id, name, faction_id)
select '24100000-0000-0000-0000-000000000001',
       ('24000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Sailor ' || n,
       ('24200000-0000-0000-0000-' || lpad(greatest(n - 2, 1)::text, 12, '0'))::uuid
from generate_series(1, 7) n;
-- Zones 1-9 are riddles 143 m apart; 10-12 are lighthouses 357-643 m from treasure.
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
select ('24300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       '24100000-0000-0000-0000-000000000001', 'Site ' || n,
       case when n <= 9
         then extensions.st_setsrid(extensions.st_makepoint(30 + n * 0.002, 50.01), 4326)::extensions.geography
         else extensions.st_setsrid(extensions.st_makepoint(30.005 + (n - 10) * 0.002, 50), 4326)::extensions.geography
       end, 20, 'silent'
from generate_series(1, 12) n;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000000', true);
select public.pirate_enable('24100000-0000-0000-0000-000000000001');
select public.pirate_set_treasure('24100000-0000-0000-0000-000000000001', 50, 30);
reset role;
insert into private.pirate_sites (game_id, zone_id, kind, reward, oath_index, oath_word, prompt, answer_hash)
select '24100000-0000-0000-0000-000000000001', zone.id,
       case when n <= 9 then 'riddle' else 'lighthouse' end,
       case when n <= 5 then 'bearing' when n <= 9 then 'oath' end,
       case when n between 6 and 9 then n - 5 end,
       case when n between 6 and 9 then 'word' || (n - 5) end,
       case when n <= 9 then 'What is hidden?' end,
       case when n <= 9 then encode(extensions.digest('gold:' || zone.id::text, 'sha256'), 'hex') end
from generate_series(1, 12) n
join public.zones zone on zone.id = ('24300000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;


create temporary table facts(k text primary key,v jsonb); grant all on facts to authenticated;

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.throws_ok($test$select public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000001')$test$,'42501',null,'players cannot invoke gm_claim_for');

select extensions.throws_ok($test$select public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001',30,'Field correction')$test$,'42501',null,'players cannot invoke gm_set_mercy');

select extensions.throws_ok($test$select public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Dead captain phone')$test$,'42501',null,'players cannot invoke gm_replace_captain');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{}'::jsonb,'Field correction')$test$,'42501',null,'players cannot invoke gm_set_pirate_settings');

select extensions.throws_ok($test$select public.gm_pirate_history('24100000-0000-0000-0000-000000000001')$test$,'42501',null,'players cannot invoke gm_pirate_history');

select set_config('request.jwt.claim.sub','',true);

select extensions.throws_ok($test$select public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000001')$test$,'28000',null,'an authenticated role without a user is denied');

reset role;

select extensions.ok(has_function_privilege('authenticated','public.gm_claim_for(uuid,uuid,uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.gm_claim_for(uuid,uuid,uuid,text,uuid)','EXECUTE'),'GM endpoint grant: gm_claim_for');

select extensions.ok(has_function_privilege('authenticated','public.gm_set_mercy(uuid,uuid,integer,text)','EXECUTE') and not has_function_privilege('anon','public.gm_set_mercy(uuid,uuid,integer,text)','EXECUTE'),'GM endpoint grant: gm_set_mercy');

select extensions.ok(has_function_privilege('authenticated','public.gm_replace_captain(uuid,uuid,uuid,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.gm_replace_captain(uuid,uuid,uuid,text,uuid)','EXECUTE'),'GM endpoint grant: gm_replace_captain');

select extensions.ok(has_function_privilege('authenticated','public.gm_set_pirate_settings(uuid,jsonb,text,jsonb)','EXECUTE') and not has_function_privilege('anon','public.gm_set_pirate_settings(uuid,jsonb,text,jsonb)','EXECUTE'),'GM endpoint grant: gm_set_pirate_settings');

select extensions.ok(has_function_privilege('authenticated','public.gm_pirate_history(uuid,text,uuid,jsonb,integer)','EXECUTE') and not has_function_privilege('anon','public.gm_pirate_history(uuid,text,uuid,jsonb,integer)','EXECUTE'),'GM endpoint grant: gm_pirate_history');

select extensions.ok(not has_function_privilege('authenticated','private.pirate_award_riddle(uuid,uuid,uuid,uuid,boolean,text)','EXECUTE'),'players cannot call private award helper');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.is(public.gm_pirate_overview('24100000-0000-0000-0000-000000000001')->'settings'->'riddle_payouts','[20,15,10,5]'::jsonb,'default payout schedule is preserved');

insert into facts values('first',public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000001'));

select extensions.is((select v->>'doubloons' from facts where k='first'),'20','GM can award normal first-place rewards in setup without GPS');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000001'),(select v from facts where k='first'),'GM retry acknowledges the original claim');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Different reason','24400000-0000-0000-0000-000000000001')->>'status','idempotency_conflict','a reused request cannot change its reason');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000002')->>'status','already_claimed','a new GM request cannot reward the same crew/site twice');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002','24300000-0000-0000-0000-000000000010','Verified field solve','24400000-0000-0000-0000-000000000003')->>'status','not_riddle','GM claim cannot award a lighthouse');

select extensions.throws_ok($test$select public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','x','24400000-0000-0000-0000-000000000004')$test$,'22023',null,'GM claim requires an audit reason');

insert into facts values('oath',public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002','24300000-0000-0000-0000-000000000006','Verified field solve','24400000-0000-0000-0000-000000000005'));

select extensions.is((select v->>'oath_word' from facts where k='oath'),'word1','GM claim grants the normal oath word');

reset role;

select extensions.is((select sum(delta)::integer from private.pirate_ledger where game_id='24100000-0000-0000-0000-000000000001' and faction_id='24200000-0000-0000-0000-000000000001' and currency='doubloon'),20,'GM claim credited once');

select extensions.ok(exists(select 1 from private.pirate_claims where game_id='24100000-0000-0000-0000-000000000001' and via_gm and claimed_by='24000000-0000-0000-0000-000000000000' and gm_reason='Verified field solve'),'GM attribution and reason persist with the claim');

select extensions.ok(not exists(select 1 from private.pirate_gm_audit where game_id='24100000-0000-0000-0000-000000000001' and after_state ? 'oath_word'),'audit summaries omit oath words');

select extensions.ok(not exists(select 1 from public.game_events where game_id='24100000-0000-0000-0000-000000000001' and type='pirate_claim' and payload ? 'oath_word' and profile_id<>'24000000-0000-0000-0000-000000000004'),'oath claim event reaches only the awarded crew');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"riddle_payouts":[7,2],"treasure_percent":50,"yield_percent":20,"yield_min":0,"fight_percent":50,"fight_min":0,"mercy_seconds":120,"pair_cooldown_seconds":60,"attack_window_seconds":600,"attack_limit":4,"code_ttl_seconds":30,"session_timeout_seconds":60,"answer_lockout_seconds":60,"answer_attempt_limit":2}'::jsonb,'Field balance update');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000006')->>'doubloons','2','new claim uses the edited second-rank payout');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000003','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000007')->>'doubloons','2','the last configured payout repeats for later ranks');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000001','Verified field solve','24400000-0000-0000-0000-000000000001')->>'doubloons','20','rule edit does not rewrite old saved results');

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"riddle_payouts":[0]}'::jsonb,'Field balance update');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000002','Verified field solve','24400000-0000-0000-0000-000000000008')->>'doubloons','0','zero doubloons still permit a shard claim');

reset role;

select extensions.ok(not exists(select 1 from private.pirate_ledger where game_id='24100000-0000-0000-0000-000000000001' and delta=0),'zero payouts do not create invalid zero ledger entries');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"code_ttl_seconds":1}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"code_ttl_seconds":1}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"riddle_payouts":[]}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"riddle_payouts":[]}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"riddle_payouts":[-1]}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"riddle_payouts":[-1]}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"yield_percent":1000000000000000000000000}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"yield_percent":1000000000000000000000000}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"attack_limit":2.5}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"attack_limit":2.5}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"hidden_key":1}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"hidden_key":1}');

select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"mercy_seconds":null}'::jsonb,'Field correction')$test$,'22023',null,'reject invalid settings {"mercy_seconds":null}');

select extensions.is(public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"yield_percent":30}'::jsonb,'Field correction','{}'::jsonb)->>'status','settings_changed','settings reject an unseen concurrent GM edit');

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"riddle_payouts":[7,2]}'::jsonb,'Field balance update');

select public.pirate_set_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000002');

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','charting',null);

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','cursed',null);

reset role;

insert into public.player_positions(game_id,profile_id,geog,recorded_at) values('24100000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000002',extensions.st_setsrid(extensions.st_makepoint(30.005,50),4326)::extensions.geography,now());

insert into private.zone_state(zone_id,profile_id,inside,inside_since) values('24300000-0000-0000-0000-000000000010','24000000-0000-0000-0000-000000000002',true,now()-interval '1 minute');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000002',true);

select extensions.is(public.compass_reading('24100000-0000-0000-0000-000000000001')->>'status','ok','original captain records a crew bearing');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.is(public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000001','Dead captain phone','24000000-0000-0000-0000-000000000002')->>'status','ok','GM replaces a valid captain after charting');

select extensions.is(public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000003','Dead captain phone','24000000-0000-0000-0000-000000000002')->>'status','captain_changed','stale captain form cannot overwrite another GM change');

select extensions.is(public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000004','Dead captain phone')->>'status','not_in_crew','replacement must be a player in that crew');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000002',true);

select extensions.is(public.get_pirate_state('24100000-0000-0000-0000-000000000001')->>'is_captain','false','former captain loses captain status');

select extensions.is(public.get_pirate_state('24100000-0000-0000-0000-000000000001')->'readings','[]'::jsonb,'former captain no longer receives the reading log');

select extensions.is(public.compass_reading('24100000-0000-0000-0000-000000000001')->>'status','not_captain','former captain cannot obtain another bearing');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(jsonb_array_length(public.get_pirate_state('24100000-0000-0000-0000-000000000001')->'readings'),1,'new captain inherits existing crew readings');

reset role;

insert into public.player_positions(game_id,profile_id,geog,recorded_at) select '24100000-0000-0000-0000-000000000001',profile_id,extensions.st_setsrid(extensions.st_makepoint(30,50.01),4326)::extensions.geography,now() from unnest(array['24000000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000004']::uuid[]) profile_id on conflict(game_id,profile_id) do update set geog=excluded.geog,recorded_at=excluded.recorded_at;

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000004',true);

insert into facts values('parley',public.open_parley('24100000-0000-0000-0000-000000000001'));

select extensions.is((select v->>'status' from facts where k='parley'),'ok','custom-rule Parley opens');

reset role;

select extensions.is((select extract(epoch from code_expires_at-now())::integer from private.pirate_parleys where id=(select (v->>'parley_id')::uuid from facts where k='parley')),30,'new code uses configured validity');

insert into facts values('target_balance',to_jsonb(private.pirate_parley_balance('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002','doubloon')));

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"yield_percent":80,"mercy_seconds":900,"pair_cooldown_seconds":3600,"code_ttl_seconds":90,"session_timeout_seconds":300}'::jsonb,'Field balance update');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(public.join_parley('24100000-0000-0000-0000-000000000001',(select v->>'code' from facts where k='parley'),'24400000-0000-0000-0000-000000000020')->>'status','ok','attacker joins the original code');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000004',true);

select extensions.is(public.parley_choice('24100000-0000-0000-0000-000000000001',(select (v->>'parley_id')::uuid from facts where k='parley'),'yield')->>'status','ok','target chooses yield');

select public.parley_report('24100000-0000-0000-0000-000000000001',(select (v->>'parley_id')::uuid from facts where k='parley'),'24200000-0000-0000-0000-000000000001');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

insert into facts values('resolution',public.parley_report('24100000-0000-0000-0000-000000000001',(select (v->>'parley_id')::uuid from facts where k='parley'),'24200000-0000-0000-0000-000000000001'));

select extensions.is((select (v->>'amount')::integer from facts where k='resolution'),(select ceil(v::text::numeric*0.20)::integer from facts where k='target_balance'),'existing Yield retains its opening percentage');

reset role;

select extensions.is((select extract(epoch from until_at-now())::integer from private.pirate_mercy where game_id='24100000-0000-0000-0000-000000000001' and faction_id='24200000-0000-0000-0000-000000000002'),120,'automatic Mercy retains the session duration');

select extensions.is((select extract(epoch from pair_cooldown_until-now())::integer from private.pirate_parleys where id=(select (v->>'parley_id')::uuid from facts where k='parley')),60,'pair cooldown retains the session duration');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002',0,'Clear test protection');

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"pair_cooldown_seconds":0}'::jsonb,'Field balance update');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000004',true);

insert into facts values('parley2',public.open_parley('24100000-0000-0000-0000-000000000001'));

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(public.join_parley('24100000-0000-0000-0000-000000000001',(select v->>'code' from facts where k='parley2'),'24400000-0000-0000-0000-000000000021')->>'status','pair_cooldown','new settings cannot erase an existing pair cooldown');

reset role;

update private.pirate_parleys set pair_cooldown_until=now()-interval '1 second' where id=(select (v->>'parley_id')::uuid from facts where k='parley');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(public.join_parley('24100000-0000-0000-0000-000000000001',(select v->>'code' from facts where k='parley2'),'24400000-0000-0000-0000-000000000021')->>'status','ok','join succeeds after the fixed cooldown ends');

reset role;

update private.pirate_parleys set updated_at=now()-interval '70 seconds' where id=(select (v->>'parley_id')::uuid from facts where k='parley2');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"session_timeout_seconds":60}'::jsonb,'Field balance update');

select public.gm_pirate_overview('24100000-0000-0000-0000-000000000001');

reset role;

select extensions.is((select state from private.pirate_parleys where id=(select (v->>'parley_id')::uuid from facts where k='parley2')),'joined','old joined encounter retains its longer inactivity timeout');

update private.pirate_parleys set updated_at=now()-interval '310 seconds' where id=(select (v->>'parley_id')::uuid from facts where k='parley2');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_pirate_overview('24100000-0000-0000-0000-000000000001');

reset role;

select extensions.is((select state from private.pirate_parleys where id=(select (v->>'parley_id')::uuid from facts where k='parley2')),'disputed','saved inactivity timer eventually queues a dispute');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.is(public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002',30,'Protect a crew outage')->>'status','ok','GM can replace immunity with thirty minutes');

select public.gm_void_parley('24100000-0000-0000-0000-000000000001',(select (v->>'parley_id')::uuid from facts where k='parley'),'Correct old exchange');

reset role;

select extensions.is((select extract(epoch from until_at-now())::integer from private.pirate_mercy where game_id='24100000-0000-0000-0000-000000000001' and faction_id='24200000-0000-0000-0000-000000000002'),1800,'voiding older Parley preserves the manual override');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.throws_ok($test$select public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001',121,'Field correction')$test$,'22023',null,'manual Mercy rejects excessive duration');

select public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000002',0,'Clear current immunity');

reset role;

select extensions.ok(not exists(select 1 from private.pirate_mercy where game_id='24100000-0000-0000-0000-000000000001' and faction_id='24200000-0000-0000-0000-000000000002' and until_at>now()),'zero minutes clears current immunity');

delete from private.zone_state where profile_id='24000000-0000-0000-0000-000000000001'; insert into private.zone_state(zone_id,profile_id,inside,inside_since) values('24300000-0000-0000-0000-000000000003','24000000-0000-0000-0000-000000000001',true,now()-interval '1 minute');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select public.claim_site('24100000-0000-0000-0000-000000000001','wrong','24400000-0000-0000-0000-000000000030');

select extensions.is(public.claim_site('24100000-0000-0000-0000-000000000001','still wrong','24400000-0000-0000-0000-000000000031')->>'remaining_seconds','60','configured wrong-answer threshold starts a sixty-second lockout');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"answer_lockout_seconds":30,"answer_attempt_limit":3}'::jsonb,'Field balance update');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(public.claim_site('24100000-0000-0000-0000-000000000001','gold','24400000-0000-0000-0000-000000000032')->>'remaining_seconds','60','existing answer lockout retains its deadline');

reset role;

update private.pirate_attempts set created_at=now()-interval '61 seconds',lockout_until=now()-interval '1 second' where game_id='24100000-0000-0000-0000-000000000001' and zone_id='24300000-0000-0000-0000-000000000003';

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000001',true);

select extensions.is(public.claim_site('24100000-0000-0000-0000-000000000001','gold','24400000-0000-0000-0000-000000000033')->>'status','ok','correct answer succeeds after the saved lockout expires');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

insert into facts values('page1',public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger',null,null,1));

select extensions.is((select jsonb_array_length(v->'items') from facts where k='page1'),1,'history obeys page size');

select extensions.ok((select v->'next_cursor' <> 'null'::jsonb from facts where k='page1'),'history supplies the next cursor');

insert into facts values('page2',public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger',null,(select v->'next_cursor' from facts where k='page1'),1));

select extensions.ok((select v->'items'->0->>'id' from facts where k='page1')<>(select v->'items'->0->>'id' from facts where k='page2'),'equal-timestamp pagination does not repeat an entry');

select extensions.ok(not exists(select 1 from jsonb_array_elements(public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger','24200000-0000-0000-0000-000000000001')->'items') row where row->>'crew_name'<>'Crew 1'),'crew history remains filtered');

select extensions.ok(exists(select 1 from jsonb_array_elements(public.gm_pirate_history('24100000-0000-0000-0000-000000000001','claims')->'items') row where (row->>'via_gm')::boolean),'GM history identifies manual claims');

select extensions.ok(exists(select 1 from jsonb_array_elements(public.gm_pirate_history('24100000-0000-0000-0000-000000000001','readings')->'items') row where row->>'site_name'='Site 10'),'reading history includes the original captain bearing');

select extensions.ok(exists(select 1 from jsonb_array_elements(public.gm_pirate_history('24100000-0000-0000-0000-000000000001','parleys')->'items') row where row->>'state'='voided'),'history includes resolved and voided exchanges');

select extensions.ok(exists(select 1 from jsonb_array_elements(public.gm_pirate_history('24100000-0000-0000-0000-000000000001','audit')->'items') row where row->>'action'='captain' and row->>'reason'='Dead captain phone'),'reasoned captain replacement is visible in GM history');

select extensions.throws_ok($test$select public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger',null,null,101)$test$,'22023',null,'history page size is bounded');

select extensions.throws_ok($test$select public.gm_pirate_history('24100000-0000-0000-0000-000000000001','answers')$test$,'22023',null,'history cannot request answer material');

select extensions.throws_ok($test$select public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger',null,'{}'::jsonb)$test$,'22023',null,'history rejects incomplete cursor');

reset role;

update public.game_players set sharing_enabled=true,location_consent_at=now(),consent_revoked_at=null where game_id='24100000-0000-0000-0000-000000000001' and role='player';

update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,recorded_at=now() where game_id='24100000-0000-0000-0000-000000000001' and profile_id='24000000-0000-0000-0000-000000000001';

update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30.003,50),4326)::extensions.geography,recorded_at=now() where game_id='24100000-0000-0000-0000-000000000001' and profile_id='24000000-0000-0000-0000-000000000002';

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

insert into facts values('alerts',public.gm_pirate_overview('24100000-0000-0000-0000-000000000001')->'alerts');

select extensions.ok(exists(select 1 from jsonb_array_elements((select v from facts where k='alerts')) a where a->>'crew_id'='24200000-0000-0000-0000-000000000001' and (a->>'spread_m')::integer>150),'fresh crew spread above 150 metres alerts the GM');

select extensions.ok(exists(select 1 from jsonb_array_elements((select v from facts where k='alerts')) a,jsonb_array_elements(a->'stale_players') p where p->>'profile_id'='24000000-0000-0000-0000-000000000003'),'missing GPS is listed by player');

reset role;

insert into public.player_positions(game_id,profile_id,geog,recorded_at) values('24100000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000003',extensions.st_setsrid(extensions.st_makepoint(31,50),4326)::extensions.geography,now()-interval '121 seconds');

update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30.0002,50),4326)::extensions.geography where game_id='24100000-0000-0000-0000-000000000001' and profile_id='24000000-0000-0000-0000-000000000002';

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select extensions.ok(exists(select 1 from jsonb_array_elements(public.gm_pirate_overview('24100000-0000-0000-0000-000000000001')->'alerts') a where a->>'crew_id'='24200000-0000-0000-0000-000000000001' and (a->>'spread_m')::integer<150),'stale far-away location is excluded from crew spread');

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','truce',null);

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','hunt',null);

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','hoard',null);

insert into facts values('hoard',public.gm_pirate_overview('24100000-0000-0000-0000-000000000001')->'treasure');

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','recall',null);

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','finished',null);

select extensions.is(public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000002','Recover captain')->>'status','wrong_phase','captain replacement is blocked while finished');

select extensions.is(public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{}'::jsonb,'Recover settings')->>'status','wrong_phase','settings remain locked while finished');

select extensions.is(public.pirate_set_phase('24100000-0000-0000-0000-000000000001','recall','Correct accidental finish')->>'status','ok','finished can be reversed one step');

reset role;

select extensions.is((select status from public.games where id='24100000-0000-0000-0000-000000000001'),'active','phase correction restores active ordinary status');

set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);

select public.pirate_set_phase('24100000-0000-0000-0000-000000000001','hoard',null);

select extensions.is(public.gm_pirate_overview('24100000-0000-0000-0000-000000000001')->'treasure',(select v from facts where k='hoard'),'phase reversal and hoard reentry do not recalculate treasure');

select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000004','Verified field solve','24400000-0000-0000-0000-000000000040')->>'status','ok','GM recovery remains available in late phases');

reset role;

select extensions.ok(not exists(select 1 from pg_publication_tables where schemaname='private' and tablename in ('pirate_gm_audit','pirate_gm_claim_requests')),'new private tables stay outside Realtime publication');


reset role;
insert into public.games(id,gm_id,name,join_code) values('24100000-0000-0000-0000-000000000002','24000000-0000-0000-0000-000000000007','Other game','24A0C0D2');
insert into public.factions(id,game_id,name) values('24200000-0000-0000-0000-000000000999','24100000-0000-0000-0000-000000000002','Other crew');
insert into public.zones(id,game_id,name,geog,radius_m,trigger_mode)
values('24300000-0000-0000-0000-000000000999','24100000-0000-0000-0000-000000000002','Other riddle',extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,20,'silent');
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_user_meta_data,created_at,updated_at)
values('24000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000000','authenticated','authenticated','second-gm@example.test','',now(),'{"username":"Second GM"}',now(),now());
insert into public.game_players(game_id,profile_id,role) values('24100000-0000-0000-0000-000000000001','24000000-0000-0000-0000-000000000008','gm');
set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);
select extensions.throws_ok($test$select public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000002','{}'::jsonb,'Other game override')$test$,'42501',null,'a GM cannot override another game');
select extensions.throws_ok($test$select public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000999','24300000-0000-0000-0000-000000000001','Other crew override','24400000-0000-0000-0000-000000000100')$test$,'22023',null,'GM claims reject a foreign crew');
select extensions.is(public.gm_claim_for('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001','24300000-0000-0000-0000-000000000999','Other site override','24400000-0000-0000-0000-000000000101')->>'status','not_riddle','GM claims do not resolve foreign sites');
select extensions.throws_ok($test$select public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000999',30,'Other crew override')$test$,'22023',null,'Mercy cannot target a foreign crew');
select extensions.throws_ok($test$select public.gm_pirate_history('24100000-0000-0000-0000-000000000001','ledger','24200000-0000-0000-0000-000000000999')$test$,'22023',null,'history rejects a foreign crew filter');
select extensions.is(public.gm_replace_captain('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000999','24000000-0000-0000-0000-000000000007','Other captain override')->>'status','not_in_crew','replacement requires a same-game crew member');
select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000008',true);
select extensions.is(public.gm_set_mercy('24100000-0000-0000-0000-000000000001','24200000-0000-0000-0000-000000000001',5,'Second GM safety ruling')->>'status','ok','a second game GM may use recovery controls');
reset role;
select extensions.ok(exists(select 1 from private.pirate_gm_audit where game_id='24100000-0000-0000-0000-000000000001' and actor_id='24000000-0000-0000-0000-000000000008' and reason='Second GM safety ruling'),'second GM attribution is recorded');
set local role authenticated; select set_config('request.jwt.claim.sub','24000000-0000-0000-0000-000000000000',true);
insert into facts values('numeric',public.gm_set_pirate_settings('24100000-0000-0000-0000-000000000001','{"code_ttl_seconds":30.0,"riddle_payouts":[7.0,0.0]}'::jsonb,'Normalize whole-valued numbers'));
select extensions.is((select v->>'status' from facts where k='numeric'),'ok','whole-valued JSON decimals are accepted safely');
select extensions.is((select v->'settings'->>'code_ttl_seconds' from facts where k='numeric'),'30','timers normalize to integer representation');
select extensions.is((select v->'settings'->'riddle_payouts'->>0 from facts where k='numeric'),'7','payouts normalize to integer representation');
reset role;
delete from auth.users where id='24000000-0000-0000-0000-000000000008';
select extensions.ok(exists(select 1 from private.pirate_gm_audit where game_id='24100000-0000-0000-0000-000000000001' and actor_id is null and reason='Second GM safety ruling'),'new audit attribution survives account deletion without blocking it');

select * from extensions.finish(); rollback;
