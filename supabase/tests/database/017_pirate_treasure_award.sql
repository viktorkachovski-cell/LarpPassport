begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(17);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-treasure-gm@example.test', '', now(),
   '{"username":"pirate_treasure_gm"}'::jsonb, now(), now()),
  ('a2000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-treasure-player@example.test', '', now(),
   '{"username":"pirate_treasure_player"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values ('a3000000-0000-0000-0000-000000000103',
        'a1000000-0000-0000-0000-000000000101', 'Pirate Treasure', 'A3A0C103');
insert into public.game_players (game_id, profile_id, role)
values ('a3000000-0000-0000-0000-000000000103',
        'a2000000-0000-0000-0000-000000000102', 'player');
insert into public.factions (id, game_id, name)
values ('a4000000-0000-0000-0000-000000000104',
        'a3000000-0000-0000-0000-000000000103', 'Hoard Crew'),
       ('a5000000-0000-0000-0000-000000000105',
        'a3000000-0000-0000-0000-000000000103', 'Leading Crew');
insert into private.pirate_games (game_id)
values ('a3000000-0000-0000-0000-000000000103');

-- The leading crew holds 103 doubloons, so the frozen hoard is round(41.2) = 41.
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, reason, actor_id) values
  ('a3000000-0000-0000-0000-000000000103', 'a5000000-0000-0000-0000-000000000105', 'doubloon', 103, 'gm', 'seed balance', 'a1000000-0000-0000-0000-000000000101'),
  ('a3000000-0000-0000-0000-000000000103', 'a4000000-0000-0000-0000-000000000104', 'doubloon', 30, 'gm', 'seed balance', 'a1000000-0000-0000-0000-000000000101');

select extensions.ok(has_function_privilege('authenticated', 'public.gm_award_treasure(uuid,uuid,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.gm_award_treasure(uuid,uuid,text)', 'EXECUTE'),
  'treasure award is an authenticated RPC');
select extensions.ok(
  has_function_privilege('authenticated', 'public.pirate_set_treasure(uuid,double precision,double precision)', 'EXECUTE')
  and to_regprocedure('public.pirate_set_treasure(uuid,double precision,double precision,integer)') is null,
  'the GM sets only the treasure point; the fixed value input is gone');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000102', true);
select extensions.throws_ok(
  $$ select public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
       'a4000000-0000-0000-0000-000000000104', 'Oath heard') $$,
  '42501', 'GM access required', 'player cannot award the hoard');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
  'a4000000-0000-0000-0000-000000000104', 'Oath heard')->>'status',
  'wrong_phase', 'treasure is sealed before hoard');
reset role;
update public.games set phase = 'hoard', status = 'active' where id = 'a3000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
  'a4000000-0000-0000-0000-000000000104', 'Oath heard')->>'status',
  'not_frozen', 'a hoard reached without the phase action has no value to award');
reset role;
update public.games set phase = 'hunt' where id = 'a3000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('a3000000-0000-0000-0000-000000000103', 'hoard', null) $$,
  'GM opens the hoard');
reset role;
select extensions.is(
  (select pg_catalog.jsonb_build_array(treasure_basis, treasure_value) from private.pirate_games where game_id = 'a3000000-0000-0000-0000-000000000103'),
  '[103, 41]'::jsonb, 'opening the hoard freezes 40% of the leading balance, rounded');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.throws_ok(
  $$ select public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
       'a4000000-0000-0000-0000-000000000104', '') $$,
  '22023', 'game, crew and reason are required', 'GM must record why the oath passed');
select extensions.is(public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
  'a4000000-0000-0000-0000-000000000104', 'Oath heard')->>'amount',
  '41', 'the frozen value is awarded');
select extensions.is(public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
  'a4000000-0000-0000-0000-000000000104', 'Oath heard')->>'status',
  'already_awarded', 'only one active award is possible');
reset role;
select extensions.is((select sum(delta)::integer from private.pirate_ledger
  where faction_id = 'a4000000-0000-0000-0000-000000000104'), 71,
  'duplicate call did not duplicate the ledger credit');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_void_treasure('a3000000-0000-0000-0000-000000000103', 'GM correction')->>'status',
  'ok', 'GM can void an award with a reason');
reset role;
select extensions.is((select sum(delta)::integer from private.pirate_ledger
  where faction_id = 'a4000000-0000-0000-0000-000000000104'), 30,
  'void writes an exact compensating entry');

-- Later scoring and re-entering the hoard must not change the frozen value.
insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, reason, actor_id)
values ('a3000000-0000-0000-0000-000000000103', 'a5000000-0000-0000-0000-000000000105', 'doubloon', 100, 'gm', 'late score', 'a1000000-0000-0000-0000-000000000101');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select public.pirate_set_phase('a3000000-0000-0000-0000-000000000103', 'hunt', null);
select public.pirate_set_phase('a3000000-0000-0000-0000-000000000103', 'hoard', null);
reset role;
select extensions.is((select treasure_value from private.pirate_games where game_id = 'a3000000-0000-0000-0000-000000000103'), 41,
  'stepping back and reopening the hoard keeps the frozen value');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000101', true);
select extensions.is(public.gm_void_treasure('a3000000-0000-0000-0000-000000000103', 'GM correction')->>'status',
  'not_awarded', 'a second void is harmless');
select extensions.is(public.gm_award_treasure('a3000000-0000-0000-0000-000000000103',
  'a4000000-0000-0000-0000-000000000104', 'Oath rechecked')->>'amount',
  '41', 'a replacement award uses the same frozen value');
reset role;
select extensions.is((select count(*)::integer from private.pirate_treasure_awards), 2,
  'both the original and corrected awards remain in audit history');

select * from extensions.finish();
rollback;
