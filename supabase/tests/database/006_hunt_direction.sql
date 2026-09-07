begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(34);

-- Schema and privilege surface -------------------------------------------

select extensions.has_column('public', 'games', 'direction_enabled', 'games carry the GM direction opt-in');
select extensions.col_default_is('public', 'games', 'direction_enabled', 'false', 'direction is off by default for every game');
select extensions.ok(
  has_column_privilege('authenticated', 'public.games', 'direction_enabled', 'SELECT'),
  'members can read the direction setting'
);
select extensions.ok(
  not has_column_privilege('authenticated', 'public.games', 'join_code', 'SELECT'),
  'the join code column stays unreadable through the Data API'
);
select extensions.ok(
  not has_function_privilege('authenticated', 'private.hunt_band_edge_m(double precision)', 'EXECUTE')
  and not has_function_privilege('anon', 'private.hunt_band_edge_m(double precision)', 'EXECUTE'),
  'the band-edge helper is not callable by API roles'
);
select extensions.ok(
  has_function_privilege('authenticated', 'public.get_hunt_status(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_hunt_status(uuid)', 'EXECUTE'),
  'get_hunt_status keeps its execute grants after redefinition'
);

-- Fixtures ----------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('d1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-gm@example.test', '', now(),
   '{"username":"dir_gm"}'::jsonb, now(), now()),
  ('d2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-one@example.test', '', now(),
   '{"username":"dir_one"}'::jsonb, now(), now()),
  ('d3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-two@example.test', '', now(),
   '{"username":"dir_two"}'::jsonb, now(), now()),
  ('d4000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'dir-three@example.test', '', now(),
   '{"username":"dir_three"}'::jsonb, now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);

insert into public.games (id, gm_id, name, join_code)
values ('e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001', 'Direction Test', 'D1A2E3C4');

insert into public.game_players (game_id, profile_id, role)
values
  ('e1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'player'),
  ('e1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000003', 'player'),
  ('e1000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004', 'player');

insert into public.characters (game_id, user_id, name)
values
  ('e1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002', 'Traveller One'),
  ('e1000000-0000-0000-0000-000000000001', 'd3000000-0000-0000-0000-000000000003', 'Traveller Two'),
  ('e1000000-0000-0000-0000-000000000001', 'd4000000-0000-0000-0000-000000000004', 'Traveller Three');

select public.start_hunt('e1000000-0000-0000-0000-000000000001');
reset role;

-- The chain is random; pick player two's hunter and target from private state.
select set_config(
  'test.hunter',
  (select hunter.profile_id::text
   from private.hunt_players hunter
   where hunter.game_id = 'e1000000-0000-0000-0000-000000000001'
     and hunter.target_profile_id = 'd3000000-0000-0000-0000-000000000003'),
  true
);
select set_config('test.target', 'd3000000-0000-0000-0000-000000000003', true);

create or replace function pg_temp.place(p_profile uuid, p_lng double precision, p_lat double precision, p_age interval default interval '0')
returns void
language sql
as $$
  insert into public.player_positions (game_id, profile_id, geog, recorded_at)
  values (
    'e1000000-0000-0000-0000-000000000001', p_profile,
    extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    now() - p_age
  )
  on conflict (game_id, profile_id) do update
    set geog = excluded.geog, recorded_at = excluded.recorded_at;
$$;

create or replace function pg_temp.status()
returns jsonb
language sql
as $$
  select public.get_hunt_status('e1000000-0000-0000-0000-000000000001');
$$;
-- Default privileges revoke EXECUTE from PUBLIC; the API roles call this helper below.
grant execute on function pg_temp.status() to authenticated, anon;

-- Hunter at the origin; target ~111 m due north (0.001 deg of latitude).
select pg_temp.place(current_setting('test.hunter')::uuid, 23.3219, 42.6977);
select pg_temp.place(current_setting('test.target')::uuid, 23.3219, 42.6987);

-- Direction off: unchanged rounded metres, no bearing ---------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);

select extensions.is(pg_temp.status() #>> '{target,proximity,state}', 'available', 'both fixes are fresh');
select extensions.is(pg_temp.status() #>> '{target,proximity,band}', 'nearby', 'band is unchanged with direction off');
select extensions.is((pg_temp.status() #>> '{target,proximity,distance_m}')::integer, 110, 'distance keeps 10 m rounding with direction off');
select extensions.is(pg_temp.status() #>> '{target,proximity,direction_state}', 'not_enabled', 'direction reports not enabled');
select extensions.ok(
  not (pg_temp.status() #> '{target,proximity}' ? 'bearing_deg'),
  'no bearing is sent while direction is off'
);
select extensions.is((pg_temp.status() ->> 'direction_enabled')::boolean, false, 'the response tells the client direction is off');

-- Only a GM can enable direction ------------------------------------------

update public.games set direction_enabled = true
where id = 'e1000000-0000-0000-0000-000000000001';
reset role;
select extensions.ok(
  not (select direction_enabled from public.games where id = 'e1000000-0000-0000-0000-000000000001'),
  'a player cannot enable direction (RLS)'
);

set local role anon;
select extensions.throws_ok(
  $$ update public.games set direction_enabled = true where id = 'e1000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'anonymous callers cannot touch the direction setting'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select extensions.lives_ok(
  $$ update public.games set direction_enabled = true where id = 'e1000000-0000-0000-0000-000000000001' $$,
  'the GM can enable direction during an active hunt'
);
reset role;
select extensions.ok(
  (select direction_enabled from public.games where id = 'e1000000-0000-0000-0000-000000000001'),
  'direction is now enabled'
);

-- Direction on: bearing, bands only, coarsened metres ----------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);

select extensions.is((pg_temp.status() #>> '{target,proximity,bearing_deg}')::integer, 0, 'a target due north reports 0 degrees');
select extensions.is(pg_temp.status() #>> '{target,proximity,direction_state}', 'available', 'direction is available for fresh fixes');
select extensions.is(pg_temp.status() #>> '{target,proximity,band}', 'nearby', 'the band is unchanged with direction on');
select extensions.is((pg_temp.status() #>> '{target,proximity,distance_m}')::integer, 300, 'distance is coarsened to the band edge, not rounded metres');
select extensions.ok(
  (pg_temp.status() #>> '{target,proximity,valid_until}')::timestamptz
    between now() + interval '119 seconds' and now() + interval '2 minutes',
  'the signal carries a two-minute validity horizon'
);
select extensions.is((pg_temp.status() ->> 'direction_enabled')::boolean, true, 'the response tells the client direction is on');

reset role;
-- East: ~0.00135 deg of longitude at this latitude is about 100 m.
select pg_temp.place(current_setting('test.target')::uuid, 23.3219 + 0.00135, 42.6977);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.ok(
  (pg_temp.status() #>> '{target,proximity,bearing_deg}')::integer between 89 and 91,
  'a target due east reports about 90 degrees'
);

reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219, 42.6977 - 0.001);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.is((pg_temp.status() #>> '{target,proximity,bearing_deg}')::integer, 180, 'a target due south reports 180 degrees');

reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219 - 0.00135, 42.6977);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.ok(
  (pg_temp.status() #>> '{target,proximity,bearing_deg}')::integer between 269 and 271,
  'a target due west reports about 270 degrees'
);

-- Just west of north: 359.98 degrees must round to 0, never 360.
reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219 - 0.0000005, 42.6977 + 0.001);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.is((pg_temp.status() #>> '{target,proximity,bearing_deg}')::integer, 0, 'bearings wrap to 0 at 360 degrees');

-- Coincident points: no bearing, but the distance UI keeps working.
reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219, 42.6977);
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.is(pg_temp.status() #>> '{target,proximity,direction_state}', 'unavailable', 'coincident fixes report direction unavailable');
select extensions.ok(
  (pg_temp.status() #> '{target,proximity}') -> 'bearing_deg' = 'null'::jsonb
  and pg_temp.status() #>> '{target,proximity,band}' = 'immediate',
  'coincident fixes keep the immediate band and a null bearing'
);

-- Stale target fix: no direction fields at all.
reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219, 42.6987, interval '3 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.is(pg_temp.status() #>> '{target,proximity,state}', 'stale', 'a stale fix suppresses the signal');
select extensions.ok(
  not ((pg_temp.status() #> '{target,proximity}') ? 'bearing_deg'),
  'a stale fix never carries a bearing'
);

-- Cloak: no direction fields at all.
reset role;
select pg_temp.place(current_setting('test.target')::uuid, 23.3219, 42.6987);
update private.hunt_players
set hidden_until = now() + interval '10 minutes'
where game_id = 'e1000000-0000-0000-0000-000000000001'
  and profile_id = current_setting('test.target')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.is(pg_temp.status() #>> '{target,proximity,state}', 'cloaked', 'the cloak suppresses the signal');
select extensions.ok(
  not ((pg_temp.status() #> '{target,proximity}') ? 'bearing_deg'),
  'a cloaked target never carries a bearing'
);

-- Non-participant and eliminated callers receive no target block.
select set_config('request.jwt.claim.sub', 'd1000000-0000-0000-0000-000000000001', true);
select extensions.ok(
  not (pg_temp.status() ? 'target') and not (pg_temp.status() ->> 'participant')::boolean,
  'a non-participant GM receives no target or bearing'
);
select public.gm_eliminate_player('e1000000-0000-0000-0000-000000000001', current_setting('test.hunter')::uuid);
select set_config('request.jwt.claim.sub', current_setting('test.hunter'), true);
select extensions.ok(
  not (pg_temp.status() ->> 'alive')::boolean and pg_temp.status() -> 'target' = 'null'::jsonb,
  'an eliminated player receives no target or bearing'
);
reset role;

select * from extensions.finish();
rollback;
