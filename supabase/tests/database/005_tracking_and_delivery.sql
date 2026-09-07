begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(15);
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  (
    '81000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'boundary-gm@example.test', '', now(),
    '{"username":"boundary_gm"}'::jsonb, now(), now()
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'boundary-one@example.test', '', now(),
    '{"username":"boundary_one"}'::jsonb, now(), now()
  ),
  (
    '83000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'boundary-two@example.test', '', now(),
    '{"username":"boundary_two"}'::jsonb, now(), now()
  );

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);

insert into public.games (id, gm_id, name, join_code)
values (
  '91000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'Boundary Test',
  'ED6E0001'
);

insert into public.game_players (game_id, profile_id, role)
values
  ('91000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000002', 'player'),
  ('91000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000003', 'player');

insert into public.characters (game_id, user_id, name)
values
  ('91000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000002', 'Boundary One'),
  ('91000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000003', 'Boundary Two');

insert into public.zones (
  id, game_id, name, shape, geog, radius_m, zone_type,
  warning_distance_m, trigger_mode
)
values (
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'Time Anomaly',
  'circle',
  extensions.st_setsrid(extensions.st_makepoint(23.3219, 42.6977), 4326)
    ::extensions.geography,
  100,
  'play_area',
  30,
  'silent'
);

select public.start_hunt('91000000-0000-0000-0000-000000000001');
-- Simulate a round already running when these historical fixes were sampled.
reset role;
update private.hunt_rounds set started_at = now() - interval '10 minutes' where game_id = '91000000-0000-0000-0000-000000000001';
set local role authenticated;

select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select public.set_location_consent('91000000-0000-0000-0000-000000000001', true);


-- Oldest ten fixes would warn; newest fifty are safe. Evaluate only the latter.
select public.ingest_pings('91000000-0000-0000-0000-000000000001', (select jsonb_agg(jsonb_build_object(
 'lat',42.6977,'lng',case when i < 10 then 23.3229 else 23.3219 end,
 'recorded_at',now() - make_interval(secs => 100-i))) from generate_series(0,59) i));
reset role;
select extensions.is((select count(*)::integer from public.game_events where game_id='91000000-0000-0000-0000-000000000001' and type='zone_boundary_warning'),0,'only newest fifty eligible samples are evaluated');
select extensions.is((select last_evaluated_at from private.zone_state where zone_id='92000000-0000-0000-0000-000000000001' and profile_id='82000000-0000-0000-0000-000000000002'),now()-interval '41 seconds','latest boundary time is persisted');
set local role authenticated;
select public.request_elimination('91000000-0000-0000-0000-000000000001');
select public.ingest_pings('91000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3235,'recorded_at',now()-interval '5 seconds')));
reset role;
select extensions.is((select status from private.hunt_claims where game_id='91000000-0000-0000-0000-000000000001' and hunter_id='82000000-0000-0000-0000-000000000002'),'pending','delayed exit does not cancel a newer claim');
select extensions.is((select count(*)::integer from public.game_events where game_id='91000000-0000-0000-0000-000000000001' and type='zone_boundary_exit'),1,'delayed exit evidence remains available to GM');
set local role authenticated;
select public.ingest_pings('91000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()-interval '20 seconds')));
reset role;
select extensions.is((select inside from private.zone_state where zone_id='92000000-0000-0000-0000-000000000001' and profile_id='82000000-0000-0000-0000-000000000002'),false,'late inside fix cannot move boundary state backwards');
set local role authenticated;
select public.ingest_pings('91000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()+interval '1 second')));
reset role;
select extensions.is((select inside from private.zone_state where zone_id='92000000-0000-0000-0000-000000000001' and profile_id='82000000-0000-0000-0000-000000000002'),false,'future fix does not adjudicate the present');

-- A late GM confirmation receives a new delivery cursor, keeping timeline seq.
insert into public.game_events(id,game_id,profile_id,type,status,player_visible) values
 ('93000000-0000-0000-0000-000000000001','91000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002','gm_note','pending',false);
create temp table delivery_before as select id,seq,delivery_seq from public.game_events where id='93000000-0000-0000-0000-000000000001';
insert into public.game_events(game_id,profile_id,type,status,player_visible) values ('91000000-0000-0000-0000-000000000001','82000000-0000-0000-0000-000000000002','gm_note','confirmed',true);
update public.game_events set status='confirmed',player_visible=true where id='93000000-0000-0000-0000-000000000001';
select extensions.ok((select e.delivery_seq>b.delivery_seq from public.game_events e join delivery_before b using(id)),'late visibility gets a new delivery number');
select extensions.is((select e.seq from public.game_events e join delivery_before b using(id)),(select seq from delivery_before),'timeline order is unchanged');
select extensions.ok(not has_function_privilege('anon','public.get_player_event_delivery(uuid,bigint)','execute'),'delivery RPC denies anonymous callers');
set local role authenticated;
select extensions.ok(jsonb_array_length(public.get_player_event_delivery('91000000-0000-0000-0000-000000000001',0))>0,'player can recover own visible events');
select extensions.ok(not exists(select 1 from jsonb_array_elements(public.get_player_event_delivery('91000000-0000-0000-0000-000000000001',0)) e where (e->>'id')::uuid in (select id from public.game_events where profile_id<>'82000000-0000-0000-0000-000000000002')),'feed does not leak another player events');

select set_config('request.jwt.claim.sub','81000000-0000-0000-0000-000000000001',true);
select public.reset_hunt('91000000-0000-0000-0000-000000000001');
reset role;
select extensions.is((select count(*)::integer from private.zone_state where zone_id='92000000-0000-0000-0000-000000000001'),0,'reset clears play-area state');
set local role authenticated;
select public.start_hunt('91000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','82000000-0000-0000-0000-000000000002',true);
select public.ingest_pings('91000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()-interval '1 second')));
reset role;
select extensions.is((select count(*)::integer from private.zone_state where zone_id='92000000-0000-0000-0000-000000000001'),0,'pre-round fixes do not enter the new play area');
update private.hunt_players set state='eliminated', eliminated_at=now(), eliminated_by='81000000-0000-0000-0000-000000000001', target_profile_id=null where game_id='91000000-0000-0000-0000-000000000001' and profile_id='82000000-0000-0000-0000-000000000002';
set local role authenticated;
select extensions.throws_ok(format('select public.set_location_consent(%L,true)','91000000-0000-0000-0000-000000000001'),'55000','Eliminated players cannot share until restored by a GM.','eliminated participant cannot re-enable consent');
select extensions.is(public.ingest_pings('91000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('lat',42.6977,'lng',23.3219,'recorded_at',now()))) ->> 'reason','eliminated','eliminated participant cannot upload under old consent');
select * from extensions.finish();
rollback;
