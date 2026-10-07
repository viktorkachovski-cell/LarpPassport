begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(11);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-compass-gm@example.test', '', now(),
   '{"username":"pirate_compass_gm"}'::jsonb, now(), now()),
  ('b2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-compass-player@example.test', '', now(),
   '{"username":"pirate_compass_player"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values ('b3000000-0000-0000-0000-000000000003',
        'b1000000-0000-0000-0000-000000000001', 'Pirate Compass', 'B3A0C0D3');
insert into public.game_players (game_id, profile_id, role)
values ('b3000000-0000-0000-0000-000000000003',
        'b2000000-0000-0000-0000-000000000002', 'player');
insert into public.factions (id, game_id, name)
values ('b4000000-0000-0000-0000-000000000004',
        'b3000000-0000-0000-0000-000000000003', 'Compass Crew');
insert into public.characters (game_id, user_id, name, faction_id)
values ('b3000000-0000-0000-0000-000000000003',
        'b2000000-0000-0000-0000-000000000002', 'Navigator',
        'b4000000-0000-0000-0000-000000000004');
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode) values
  ('b5000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000003',
   'Lantern Point', extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography,
   40, 'silent');
insert into private.pirate_games (game_id, treasure_geog) values
  ('b3000000-0000-0000-0000-000000000003',
   extensions.st_setsrid(extensions.st_makepoint(30.01, 50), 4326)::extensions.geography);
update public.games set phase = 'cursed', status = 'active'
where id = 'b3000000-0000-0000-0000-000000000003';
insert into private.pirate_sites (game_id, zone_id, kind)
values ('b3000000-0000-0000-0000-000000000003',
        'b5000000-0000-0000-0000-000000000005', 'lighthouse');
insert into public.player_positions (game_id, profile_id, geog, recorded_at)
values ('b3000000-0000-0000-0000-000000000003',
        'b2000000-0000-0000-0000-000000000002',
        extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, now());
insert into private.zone_state (zone_id, profile_id, inside, inside_since)
values ('b5000000-0000-0000-0000-000000000005',
        'b2000000-0000-0000-0000-000000000002', true, now() - interval '1 minute');

select extensions.ok(
  has_function_privilege('authenticated', 'public.compass_reading(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.compass_reading(uuid)', 'EXECUTE'),
  'compass is an authenticated RPC');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.compass_reading('b3000000-0000-0000-0000-000000000003')->>'status',
  'no_shards', 'zero shards cannot take a reading');
select extensions.is(public.treasure_band('b3000000-0000-0000-0000-000000000003')->>'band',
  'locked', 'distance band is locked before three shards');
reset role;
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, actor_id, reason)
values ('b3000000-0000-0000-0000-000000000003',
        'b4000000-0000-0000-0000-000000000004', 'bearing', 1, 'gm',
        'b1000000-0000-0000-0000-000000000001', 'Compass fixture');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.compass_reading('b3000000-0000-0000-0000-000000000003')->>'half_width_deg',
  '90', 'one shard gives a ninety degree half-width');
select extensions.ok(public.compass_reading('b3000000-0000-0000-0000-000000000003')->>'centre_deg'
  is not null, 'repeat reading returns a centre');
reset role;
select extensions.is((select count(*)::integer from private.pirate_readings), 1,
  'repeat reading creates no duplicate');
select extensions.is((select count(*)::integer from public.game_events where type = 'pirate_reading'), 1,
  'repeat reading sends no duplicate event');
select extensions.ok((select abs(mod(centre_deg::integer -
  round(degrees(extensions.st_azimuth(
    (select geog from public.zones where id = 'b5000000-0000-0000-0000-000000000005'),
    (select treasure_geog from private.pirate_games where game_id = 'b3000000-0000-0000-0000-000000000003'))))::integer
  + 540, 360) - 180) <= half_width_deg
  from private.pirate_readings where shards = 1),
  'true bearing lies inside the issued arc');
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, actor_id, reason)
values ('b3000000-0000-0000-0000-000000000003',
        'b4000000-0000-0000-0000-000000000004', 'bearing', 2, 'gm',
        'b1000000-0000-0000-0000-000000000001', 'Compass fixture');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.compass_reading('b3000000-0000-0000-0000-000000000003')->>'half_width_deg',
  '25', 'three shards give a tighter arc');
reset role;
update public.player_positions set geog =
  extensions.st_setsrid(extensions.st_makepoint(30.01, 50), 4326)::extensions.geography
where game_id = 'b3000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.treasure_band('b3000000-0000-0000-0000-000000000003')->>'band',
  '25', 'three shards unlock the close distance band');
reset role;
update public.player_positions set recorded_at = now() - interval '3 minutes'
where game_id = 'b3000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2000000-0000-0000-0000-000000000002', true);
select extensions.is(public.treasure_band('b3000000-0000-0000-0000-000000000003')->>'band',
  'stale', 'old position cannot expose a distance band');
reset role;

select * from extensions.finish();
rollback;
