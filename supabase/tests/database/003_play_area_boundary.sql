begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

select extensions.has_column('public', 'zones', 'zone_type', 'zones support a play-area purpose');
select extensions.has_column('public', 'zones', 'warning_distance_m', 'zones configure an edge warning distance');
select extensions.has_index(
  'public',
  'zones',
  'zones_one_play_area_per_game_idx',
  'each game has at most one active definition of its play area'
);

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

select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select public.set_location_consent('91000000-0000-0000-0000-000000000001', true);

select public.ingest_pings(
  '91000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'lat', 42.6977, 'lng', 23.3219, 'accuracy', 5,
    'recorded_at', (now() - interval '30 seconds')::text
  )),
  0
);

select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = '91000000-0000-0000-0000-000000000001'
     and type = 'zone_boundary_warning'),
  0,
  'safe interior position emits no boundary warning'
);

select public.ingest_pings(
  '91000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'lat', 42.6977, 'lng', 23.3229, 'accuracy', 5,
    'recorded_at', (now() - interval '20 seconds')::text
  )),
  0
);

select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = '91000000-0000-0000-0000-000000000001'
     and profile_id = '82000000-0000-0000-0000-000000000002'
     and type = 'zone_boundary_warning'
     and status = 'confirmed'
     and player_visible),
  1,
  'near-edge position sends one visible warning to the player'
);

select public.request_elimination('91000000-0000-0000-0000-000000000001');
reset role;
select extensions.is(
  (select count(*)::integer from private.hunt_claims
   where game_id = '91000000-0000-0000-0000-000000000001'
     and hunter_id = '82000000-0000-0000-0000-000000000002'
     and status = 'pending'),
  1,
  'player has an active elimination claim before leaving the play area'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select public.ingest_pings(
  '91000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'lat', 42.6977, 'lng', 23.3235, 'accuracy', 5,
    'recorded_at', (now() - interval '10 seconds')::text
  )),
  0
);
reset role;

select extensions.is(
  (select count(*)::integer from private.hunt_claims
   where game_id = '91000000-0000-0000-0000-000000000001'
     and hunter_id = '82000000-0000-0000-0000-000000000002'
     and status = 'rejected'),
  1,
  'leaving the play area forfeits the pending elimination claim'
);
select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = '91000000-0000-0000-0000-000000000001'
     and profile_id = '82000000-0000-0000-0000-000000000002'
     and type = 'zone_boundary_exit'
     and status = 'pending'
     and player_visible),
  1,
  'leaving creates one player-visible breach for GM adjudication'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select public.ingest_pings(
  '91000000-0000-0000-0000-000000000001',
  jsonb_build_array(jsonb_build_object(
    'lat', 42.6977, 'lng', 23.3236, 'accuracy', 5,
    'recorded_at', now()::text
  )),
  0
);
reset role;
select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = '91000000-0000-0000-0000-000000000001'
     and type = 'zone_boundary_exit'),
  1,
  'remaining outside does not duplicate the breach event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '82000000-0000-0000-0000-000000000002', true);
select public.ingest_pings(
  '91000000-0000-0000-0000-000000000001',
  jsonb_build_array(
    jsonb_build_object(
      'lat', 42.6977, 'lng', 23.3219, 'accuracy', 5,
      'recorded_at', (now() + interval '1 second')::text
    ),
    jsonb_build_object(
      'lat', 42.6977, 'lng', 23.3229, 'accuracy', 5,
      'recorded_at', (now() + interval '2 seconds')::text
    )
  ),
  0
);
reset role;
select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = '91000000-0000-0000-0000-000000000001'
     and type = 'zone_boundary_warning'),
  2,
  'returning to safety rearms the near-edge warning'
);

select * from extensions.finish();
rollback;
