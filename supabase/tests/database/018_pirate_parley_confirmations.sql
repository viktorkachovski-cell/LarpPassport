begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(30);

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

select extensions.ok(has_function_privilege('authenticated', 'public.parley_report(uuid,uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.parley_report(uuid,uuid,uuid)', 'EXECUTE'),
  'Parley reports are authenticated RPCs');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.is(public.open_parley('f5000000-0000-0000-0000-000000000105')->>'status',
  'ok', 'target player opens a Parley');
reset role;
select extensions.ok((select code ~ '^[0-9]{4}$' from private.pirate_parleys
  where game_id = 'f5000000-0000-0000-0000-000000000105'),
  'Parley code has exactly four digits');
select set_config('test.parley_code',
  (select code from private.pirate_parleys where game_id = 'f5000000-0000-0000-0000-000000000105'), true);
select set_config('test.parley_id',
  (select id::text from private.pirate_parleys where game_id = 'f5000000-0000-0000-0000-000000000105'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3000000-0000-0000-0000-000000000103', true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105',
  current_setting('test.parley_code'), 'f8000000-0000-0000-0000-000000000108')->>'status',
  'ok', 'attacker joins the target code');
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105',
  current_setting('test.parley_code'), 'f8000000-0000-0000-0000-000000000108')->>'status',
  'ok', 'joining retry is idempotent');
select extensions.throws_ok(
  $$ select public.parley_choice('f5000000-0000-0000-0000-000000000105',
       current_setting('test.parley_id')::uuid, 'yield') $$,
  '42501', 'only the target player may choose', 'attacker cannot choose for target');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105',
  current_setting('test.parley_id')::uuid, 'yield')->>'state',
  'yielded', 'target chooses Yield without transferring anything');
select extensions.is(public.get_pirate_state('f5000000-0000-0000-0000-000000000105')
  ->'active_parley'->>'state', 'yielded', 'player state still shows the Yield awaiting confirmation');
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.parley_id')::uuid, 'f7000000-0000-0000-0000-000000000107')->>'state',
  'awaiting_report', 'first participant confirms and waits for the second');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon'), 20,
  'the first confirmation does not debit the target');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f4000000-0000-0000-0000-000000000104', true);
select extensions.throws_ok(
  $$ select public.parley_report('f5000000-0000-0000-0000-000000000105',
       current_setting('test.parley_id')::uuid, 'f7000000-0000-0000-0000-000000000107') $$,
  '42501', 'only the two Parley players may report', 'a teammate cannot replace either participant');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3000000-0000-0000-0000-000000000103', true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.parley_id')::uuid, 'f7000000-0000-0000-0000-000000000107')->>'state',
  'resolved', 'matching second confirmation resolves Yield');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon'), 17,
  'Yield transfers minimum three doubloons from twenty');
select extensions.ok((select until_at > now() from private.pirate_mercy
  where game_id = 'f5000000-0000-0000-0000-000000000105'
    and faction_id = 'f6000000-0000-0000-0000-000000000106'),
  'losing crew receives Davy mercy');

insert into private.pirate_parleys (
  game_id, target_faction, target_profile, attacker_faction, attacker_profile,
  code, code_expires_at, state, choice
) values (
  'f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'f2000000-0000-0000-0000-000000000102',
  'f7000000-0000-0000-0000-000000000107', 'f3000000-0000-0000-0000-000000000103',
  '4321', now() + interval '90 seconds', 'fighting', 'fight'
);
select set_config('test.dispute_id', (select id::text from private.pirate_parleys
  where game_id = 'f5000000-0000-0000-0000-000000000105' and code = '4321'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.dispute_id')::uuid, 'f6000000-0000-0000-0000-000000000106')->>'state',
  'awaiting_report', 'fight records the first independent report');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3000000-0000-0000-0000-000000000103', true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.dispute_id')::uuid, 'f7000000-0000-0000-0000-000000000107')->>'state',
  'disputed', 'conflicting reports create a dispute');
reset role;
select extensions.ok(exists (select 1 from public.game_events
  where game_id = 'f5000000-0000-0000-0000-000000000105'
    and type = 'pirate_dispute' and status = 'pending' and not player_visible),
  'dispute enters the GM queue');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.throws_ok(
  $$ select public.gm_resolve_parley('f5000000-0000-0000-0000-000000000105',
       current_setting('test.dispute_id')::uuid,
       'f7000000-0000-0000-0000-000000000107', 'doubloon', 'Witness ruling') $$,
  '42501', 'GM access required', 'players cannot rule on a dispute');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_resolve_parley('f5000000-0000-0000-0000-000000000105',
  current_setting('test.dispute_id')::uuid,
  'f7000000-0000-0000-0000-000000000107', 'doubloon', 'Witness ruling')->>'status',
  'ok', 'GM can resolve a disputed Fight with a recorded ruling');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon'), 12,
  'GM ruling transfers twenty-five percent, minimum five doubloons');
select extensions.is((select status from public.game_events
  where game_id = 'f5000000-0000-0000-0000-000000000105'
    and type = 'pirate_dispute' and payload->>'parley_id' = current_setting('test.dispute_id')),
  'confirmed', 'GM ruling closes the dispute event');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_void_parley('f5000000-0000-0000-0000-000000000105',
  current_setting('test.dispute_id')::uuid, 'Ruling corrected')->>'status',
  'ok', 'GM can void the ruled Parley with an audit reason');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'doubloon'), 17,
  'void appends exact compensation and restores target balance');
select extensions.ok(not exists (select 1 from private.pirate_mercy
  where game_id = 'f5000000-0000-0000-0000-000000000105'
    and source_parley_id = current_setting('test.dispute_id')::uuid),
  'void removes mercy granted by the voided Parley');

insert into private.pirate_parleys (
  game_id, target_faction, target_profile, attacker_faction, attacker_profile,
  code, code_expires_at, state, choice
) values (
  'f5000000-0000-0000-0000-000000000105',
  'f6000000-0000-0000-0000-000000000106', 'f2000000-0000-0000-0000-000000000102',
  'f7000000-0000-0000-0000-000000000107', 'f3000000-0000-0000-0000-000000000103',
  '9876', now() + interval '90 seconds', 'fighting', 'fight'
);
select set_config('test.fight_id', (select id::text from private.pirate_parleys
  where game_id = 'f5000000-0000-0000-0000-000000000105' and code = '9876'), true);
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.fight_id')::uuid, 'f6000000-0000-0000-0000-000000000106')->>'state',
  'awaiting_report', 'Fight waits for the second exact player report');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105',
  'f7000000-0000-0000-0000-000000000107', 'doubloon'), 3,
  'first Fight report moves no currency');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3000000-0000-0000-0000-000000000103', true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105',
  current_setting('test.fight_id')::uuid, 'f6000000-0000-0000-0000-000000000106')->>'state',
  'awaiting_choice', 'matching Fight reports unlock the winner plunder choice');
select extensions.throws_ok(
  $$ select public.parley_plunder('f5000000-0000-0000-0000-000000000105',
       current_setting('test.fight_id')::uuid, 'doubloon') $$,
  '42501', 'only the winning Parley player may choose plunder',
  'the losing player cannot choose plunder');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f2000000-0000-0000-0000-000000000102', true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105',
  current_setting('test.fight_id')::uuid, 'bearing')->>'status',
  'no_shards', 'bearing plunder requires a shard');
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105',
  current_setting('test.fight_id')::uuid, 'doubloon')->>'amount',
  '3', 'Fight plunder caps the five-doubloon minimum at the loser balance');
reset role;

select * from extensions.finish();
rollback;
