begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(73);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('f1000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-parley-gm@example.test', '', now(),
   '{"username":"pirate_parley_gm"}'::jsonb, now(), now()),
  ('f2000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-parley-target@example.test', '', now(),
   '{"username":"pirate_parley_target"}'::jsonb, now(), now()),
  ('f3000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-parley-attacker@example.test', '', now(),
   '{"username":"pirate_parley_attacker"}'::jsonb, now(), now()),
  ('f4000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-parley-teammate@example.test', '', now(),
   '{"username":"pirate_parley_teammate"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values ('f5000000-0000-0000-0000-000000000105',
        'f1000000-0000-0000-0000-000000000101', 'Parley Confirmation', 'F5A0C105');
insert into public.game_players (game_id, profile_id, role) values
  ('f5000000-0000-0000-0000-000000000105', 'f2000000-0000-0000-0000-000000000102', 'player'),
  ('f5000000-0000-0000-0000-000000000105', 'f3000000-0000-0000-0000-000000000103', 'player'),
  ('f5000000-0000-0000-0000-000000000105', 'f4000000-0000-0000-0000-000000000104', 'player');
insert into public.factions (id, game_id, name) values
  ('f6000000-0000-0000-0000-000000000106', 'f5000000-0000-0000-0000-000000000105', 'Target Crew'),
  ('f7000000-0000-0000-0000-000000000107', 'f5000000-0000-0000-0000-000000000105', 'Attacker Crew');
insert into public.characters (game_id, user_id, name, faction_id) values
  ('f5000000-0000-0000-0000-000000000105', 'f2000000-0000-0000-0000-000000000102',
   'Target', 'f6000000-0000-0000-0000-000000000106'),
  ('f5000000-0000-0000-0000-000000000105', 'f3000000-0000-0000-0000-000000000103',
   'Attacker', 'f7000000-0000-0000-0000-000000000107'),
  ('f5000000-0000-0000-0000-000000000105', 'f4000000-0000-0000-0000-000000000104',
   'Teammate', 'f6000000-0000-0000-0000-000000000106');
insert into private.pirate_games (game_id) values ('f5000000-0000-0000-0000-000000000105');
update public.games set phase = 'cursed', status = 'active'
where id = 'f5000000-0000-0000-0000-000000000105';
insert into public.player_positions (game_id, profile_id, geog, recorded_at) values
  ('f5000000-0000-0000-0000-000000000105', 'f2000000-0000-0000-0000-000000000102',
   extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, now()),
  ('f5000000-0000-0000-0000-000000000105', 'f3000000-0000-0000-0000-000000000103',
   extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, now());
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, reason, actor_id)
values ('f5000000-0000-0000-0000-000000000105',
        'f6000000-0000-0000-0000-000000000106', 'doubloon', 20, 'gm',
        'Parley fixture', 'f1000000-0000-0000-0000-000000000101');
insert into private.pirate_parleys (id, game_id, target_profile, target_faction, code, code_expires_at, state)
values ('f9000000-0000-0000-0000-000000000109', 'f5000000-0000-0000-0000-000000000105', 'f2000000-0000-0000-0000-000000000102',
        'f6000000-0000-0000-0000-000000000106', '1234', now() + interval '90 seconds', 'open');

-- Baseline before each check: cursed, unpaused, Parley on, both players fresh
-- at the treasure point, and the session reset to the given state.
create function pg_temp.reset_parley(p_id uuid, p_state text) returns void language sql as $$
  update public.games set phase = 'cursed' where id = 'f5000000-0000-0000-0000-000000000105';
  update private.pirate_games set paused = false, pvp_enabled = true,
    treasure_geog = extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography
  where game_id = 'f5000000-0000-0000-0000-000000000105';
  update public.player_positions set recorded_at = now(),
    geog = extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography
  where game_id = 'f5000000-0000-0000-0000-000000000105';
  update private.pirate_parleys set state = p_state, updated_at = now(), target_report = null, attacker_report = null,
    attacker_profile = case when p_state <> 'open' then 'f3000000-0000-0000-0000-000000000103'::uuid end,
    attacker_faction = case when p_state <> 'open' then 'f7000000-0000-0000-0000-000000000107'::uuid end,
    winner_faction = case when p_state = 'awaiting_choice' then 'f7000000-0000-0000-0000-000000000107'::uuid end,
    choice = case when p_state in ('fighting', 'awaiting_choice') then 'fight' end,
    join_idem = null, plunder = null, code_expires_at = now() + interval '90 seconds'
  where id = p_id;
$$;

-- Runs one query as the given player and returns its single text result.
create function pg_temp.act(p_user uuid, p_query text) returns text language plpgsql as $$
declare result text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  execute p_query into result;
  reset role;
  return result;
end $$;

-- Every live-Parley action refuses each failed precondition and leaves the
-- session in its prior state. p_user acts; p_other is the other participant.
create function pg_temp.refusals(p_verb text, p_state text, p_user uuid, p_other uuid, p_call text)
returns setof text language plpgsql as $$
declare
  game constant uuid := 'f5000000-0000-0000-0000-000000000105';
  origin constant extensions.geography := extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography;
  labels constant text[] := array['separation', 'own stale fix', 'other stale fix', 'hoard exclusion', 'other hoard exclusion', 'pause', 'kill switch'];
  statuses constant text[] := array['too_far', 'stale', 'target_stale', 'treasure_exclusion', 'target_treasure_exclusion', 'paused', 'pvp_disabled'];
begin
  for i in 1 .. 7 loop
    perform pg_temp.reset_parley('f9000000-0000-0000-0000-000000000109', p_state);
    if i in (4, 5) then update public.games set phase = 'hoard' where id = game; end if;
    if i = 1 then update public.player_positions set geog = extensions.st_project(origin, 75.1, 0) where game_id = game and profile_id = p_user; end if;
    if i = 2 then update public.player_positions set recorded_at = now() - interval '121 seconds' where game_id = game and profile_id = p_user; end if;
    if i = 3 then update public.player_positions set recorded_at = now() - interval '121 seconds' where game_id = game and profile_id = p_other; end if;
    if i = 5 then update public.player_positions set geog = extensions.st_project(origin, 110, 0) where game_id = game and profile_id = p_user; end if;
    if i = 6 then update private.pirate_games set paused = true where game_id = game; end if;
    if i = 7 then update private.pirate_games set pvp_enabled = false where game_id = game; end if;
    return next extensions.is(pg_temp.act(p_user, format('select (%s)->>%L', p_call, 'status')), statuses[i], p_verb || ' refuses ' || labels[i]);
    return next extensions.is((select state from private.pirate_parleys where id = 'f9000000-0000-0000-0000-000000000109'),
      p_state, p_verb || ' refusal leaves session unchanged');
  end loop;
end $$;

select * from pg_temp.refusals('join', 'open', 'f3000000-0000-0000-0000-000000000103', 'f2000000-0000-0000-0000-000000000102',
  $q$public.join_parley('f5000000-0000-0000-0000-000000000105', '1234', 'f8000000-0000-0000-0000-000000000108')$q$);
select * from pg_temp.refusals('choose', 'joined', 'f2000000-0000-0000-0000-000000000102', 'f3000000-0000-0000-0000-000000000103',
  $q$public.parley_choice('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'fight')$q$);
select * from pg_temp.refusals('report', 'fighting', 'f3000000-0000-0000-0000-000000000103', 'f2000000-0000-0000-0000-000000000102',
  $q$public.parley_report('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'f7000000-0000-0000-0000-000000000107')$q$);
select * from pg_temp.refusals('plunder', 'awaiting_choice', 'f3000000-0000-0000-0000-000000000103', 'f2000000-0000-0000-0000-000000000102',
  $q$public.parley_plunder('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'doubloon')$q$);

-- A full Yield inside the 75 m limit.
delete from private.pirate_mercy where game_id = 'f5000000-0000-0000-0000-000000000105';
delete from private.pirate_ledger where game_id = 'f5000000-0000-0000-0000-000000000105' and source = 'parley';
select pg_temp.reset_parley('f9000000-0000-0000-0000-000000000109', 'open');
update public.player_positions
set geog = extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography, 74.9, 0)
where profile_id = 'f3000000-0000-0000-0000-000000000103' and game_id = 'f5000000-0000-0000-0000-000000000105';
select extensions.is(pg_temp.act('f3000000-0000-0000-0000-000000000103',
  $q$select public.join_parley('f5000000-0000-0000-0000-000000000105', '1234', 'f8000000-0000-0000-0000-000000000108')->>'status'$q$),
  'ok', 'a separation below 75 m permits joining');
select extensions.is(pg_temp.act('f2000000-0000-0000-0000-000000000102',
  $q$select public.parley_choice('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'yield')->>'state'$q$),
  'yielded', 'nearby target may yield');
select extensions.is(pg_temp.act('f2000000-0000-0000-0000-000000000102',
  $q$select public.parley_report('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'f7000000-0000-0000-0000-000000000107')->>'state'$q$),
  'awaiting_report', 'one report transfers nothing');
update private.pirate_parleys set updated_at = now() - interval '60 seconds' where id = 'f9000000-0000-0000-0000-000000000109';
select extensions.is(pg_temp.act('f2000000-0000-0000-0000-000000000102',
  $q$select public.parley_report('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'f7000000-0000-0000-0000-000000000107')->>'state'$q$),
  'awaiting_report', 'identical report retry returns saved result');
select extensions.is((select (updated_at = now() - interval '60 seconds')::text from private.pirate_parleys
  where id = 'f9000000-0000-0000-0000-000000000109'), 'true', 'report retries do not extend timeout');
select extensions.is(pg_temp.act('f3000000-0000-0000-0000-000000000103',
  $q$select public.parley_report('f5000000-0000-0000-0000-000000000105', 'f9000000-0000-0000-0000-000000000109', 'f7000000-0000-0000-0000-000000000107')->>'state'$q$),
  'resolved', 'matching yield confirmation resolves');
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon')::text, '17', 'yield transfers three doubloons once');

-- Fight plunder commits once, even when retried with stale GPS.
insert into private.pirate_parleys (id, game_id, target_profile, target_faction, code, code_expires_at, state)
values ('fa000000-0000-0000-0000-000000000110', 'f5000000-0000-0000-0000-000000000105', 'f2000000-0000-0000-0000-000000000102',
        'f6000000-0000-0000-0000-000000000106', '5678', now() + interval '90 seconds', 'open');
select pg_temp.reset_parley('fa000000-0000-0000-0000-000000000110', 'awaiting_choice');
select extensions.is(pg_temp.act('f3000000-0000-0000-0000-000000000103',
  $q$select public.parley_plunder('f5000000-0000-0000-0000-000000000105', 'fa000000-0000-0000-0000-000000000110', 'doubloon')->>'amount'$q$),
  '5', 'fight plunder computes capped rounded amount');
update public.player_positions set recorded_at = now() - interval '121 seconds' where game_id = 'f5000000-0000-0000-0000-000000000105';
select extensions.is(pg_temp.act('f3000000-0000-0000-0000-000000000103',
  $q$select public.parley_plunder('f5000000-0000-0000-0000-000000000105', 'fa000000-0000-0000-0000-000000000110', 'doubloon')->>'amount'$q$),
  '5', 'committed plunder retry returns original amount despite stale GPS');
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon')::text, '12', 'plunder retry never transfers twice');

-- Reads expire stale codes and time out idle sessions exactly once.
select pg_temp.reset_parley('fa000000-0000-0000-0000-000000000110', 'open');
update private.pirate_parleys set code_expires_at = now() - interval '1 second' where id = 'fa000000-0000-0000-0000-000000000110';
select extensions.is(pg_temp.act('f2000000-0000-0000-0000-000000000102',
  $q$select (public.get_pirate_state('f5000000-0000-0000-0000-000000000105')->'active_parley' = 'null'::jsonb)::text$q$),
  'true', 'polling releases an expired open code');
select extensions.is((select state from private.pirate_parleys where id = 'fa000000-0000-0000-0000-000000000110'),
  'expired', 'status read persists code expiry');
select pg_temp.reset_parley('fa000000-0000-0000-0000-000000000110', 'fighting');
update private.pirate_parleys set updated_at = now() - interval '301 seconds' where id = 'fa000000-0000-0000-0000-000000000110';
select extensions.is(pg_temp.act('f1000000-0000-0000-0000-000000000101',
  $q$select public.gm_pirate_overview('f5000000-0000-0000-0000-000000000105')->'parleys'->0->>'state'$q$),
  'disputed', 'GM polling surfaces five-minute timeout');
select extensions.is(pg_temp.act('f2000000-0000-0000-0000-000000000102',
  $q$select public.get_pirate_state('f5000000-0000-0000-0000-000000000105')->'active_parley'->>'state'$q$),
  'disputed', 'player refresh sees the same timeout');
select extensions.is((select count(*)::text from public.game_events
  where game_id = 'f5000000-0000-0000-0000-000000000105' and type = 'pirate_dispute'), '1', 'repeated refreshes emit one dispute only');
select extensions.is(has_function_privilege('authenticated',
  'private.pirate_parley_pair_presence(uuid,uuid,uuid,text,extensions.geography)', 'EXECUTE')::text,
  'false', 'private presence helper is not a client endpoint');
select extensions.is(has_function_privilege('anon', 'public.get_pirate_state(uuid)', 'EXECUTE')::text,
  'false', 'status mutation retains anonymous denial');
select * from extensions.finish();
rollback;
