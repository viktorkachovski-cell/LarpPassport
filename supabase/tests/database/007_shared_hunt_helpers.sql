begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(8);

-- Helper surface ------------------------------------------------------------

select extensions.ok(
  not exists (
    select 1
    from (values ('private.lock_game(uuid)'), ('private.require_gm(uuid)'), ('private.clear_hunt(uuid)')) helper(signature)
    where has_function_privilege('authenticated', helper.signature, 'EXECUTE')
       or has_function_privilege('anon', helper.signature, 'EXECUTE')
  ),
  'shared hunt helpers are not callable by API roles'
);
select extensions.is(
  (select array_agg(private.hunt_band_edge_m(distance) order by distance)
   from unnest(array[0, 25, 25.5, 100, 100.5, 300, 300.5, 1000, 1000.5, 50000]::double precision[]) distance),
  array[25, 25, 100, 100, 300, 300, 1000, 1000, 1000, 1000],
  'band edges follow the distance bands'
);
select extensions.is(private.hunt_band_edge_m(null), 1000, 'an unknown distance maps to the far edge');

-- Fixtures ----------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('f1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'helper-gm@example.test', '', now(),
   '{"username":"helper_gm"}'::jsonb, now(), now()),
  ('f2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'helper-one@example.test', '', now(),
   '{"username":"helper_one"}'::jsonb, now(), now()),
  ('f3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'helper-two@example.test', '', now(),
   '{"username":"helper_two"}'::jsonb, now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);

insert into public.games (id, gm_id, name, join_code)
values ('f9000000-0000-0000-0000-000000000009', 'f1000000-0000-0000-0000-000000000001', 'Helper Test', 'F1F1F1F1');

insert into public.game_players (game_id, profile_id, role)
values
  ('f9000000-0000-0000-0000-000000000009', 'f2000000-0000-0000-0000-000000000002', 'player'),
  ('f9000000-0000-0000-0000-000000000009', 'f3000000-0000-0000-0000-000000000003', 'player');

insert into public.characters (game_id, user_id, name)
values
  ('f9000000-0000-0000-0000-000000000009', 'f2000000-0000-0000-0000-000000000002', 'Helper One'),
  ('f9000000-0000-0000-0000-000000000009', 'f3000000-0000-0000-0000-000000000003', 'Helper Two');

-- require_gm keeps the old error contract ---------------------------------

select set_config('request.jwt.claim.sub', '', true);
select extensions.throws_ok(
  $$select public.reset_hunt('f9000000-0000-0000-0000-000000000009')$$,
  '28000',
  'not authenticated',
  'GM RPCs still reject a missing session first'
);
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok(
  $$select public.start_hunt('f9000000-0000-0000-0000-000000000009')$$,
  '42501',
  'GM access required',
  'players still cannot start a hunt'
);

-- clear_hunt empties the round on reset ------------------------------------

select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000001', true);
select public.start_hunt('f9000000-0000-0000-0000-000000000009');
select extensions.is(
  public.reset_hunt('f9000000-0000-0000-0000-000000000009'),
  '{"phase":"not_started"}'::jsonb,
  'reset_hunt still answers not_started'
);
reset role;
select extensions.is(
  (select count(*)::integer from private.hunt_rounds where game_id = 'f9000000-0000-0000-0000-000000000009')
  + (select count(*)::integer from private.hunt_players where game_id = 'f9000000-0000-0000-0000-000000000009')
  + (select count(*)::integer from private.hunt_claims where game_id = 'f9000000-0000-0000-0000-000000000009'),
  0,
  'reset_hunt clears the round, roster and claims'
);
set local role authenticated;

-- ingest_pings answers without the removed piggyback fields ---------------

select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000002', true);
select public.set_location_consent('f9000000-0000-0000-0000-000000000009', true);
select extensions.is(
  jsonb_build_object(
    'keys', (select jsonb_agg(key order by key) from jsonb_object_keys(body) key),
    'profile_keys', (select jsonb_agg(key order by key) from jsonb_object_keys(body -> 'profile') key),
    'accepted', body -> 'accepted'
  ),
  '{"keys":["accepted","profile","rejected"],"profile_keys":["mode"],"accepted":1}'::jsonb,
  'ingest_pings answers accepted, rejected and profile.mode; a legacy last_seen_seq is ignored'
)
from (
  select public.ingest_pings(
    'f9000000-0000-0000-0000-000000000009',
    jsonb_build_array(jsonb_build_object('lat', 42.6977, 'lng', 23.3219, 'recorded_at', now())),
    5
  ) as body
) response;

reset role;

select * from extensions.finish();
rollback;
