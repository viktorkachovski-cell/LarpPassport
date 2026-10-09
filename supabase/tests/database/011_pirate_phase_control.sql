begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(19);

select extensions.ok(
  has_function_privilege('authenticated', 'public.pirate_set_phase(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pirate_set_phase(uuid,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pirate_set_paused(uuid,boolean)', 'EXECUTE'),
  'phase controls are authenticated RPCs only'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('e1000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-phase-gm@example.test', '', now(),
   '{"username":"pirate_phase_gm"}'::jsonb, now(), now()),
  ('e2000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-phase-one@example.test', '', now(),
   '{"username":"pirate_phase_one"}'::jsonb, now(), now()),
  ('e3000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-phase-two@example.test', '', now(),
   '{"username":"pirate_phase_two"}'::jsonb, now(), now());
insert into public.games (id, gm_id, name, join_code)
values ('e4000000-0000-0000-0000-000000000014',
        'e1000000-0000-0000-0000-000000000011', 'Pirate Phase', 'E4A0C0D4');
insert into public.game_players (game_id, profile_id, role)
values
  ('e4000000-0000-0000-0000-000000000014', 'e2000000-0000-0000-0000-000000000012', 'player'),
  ('e4000000-0000-0000-0000-000000000014', 'e3000000-0000-0000-0000-000000000013', 'player');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000011', true);
select extensions.lives_ok(
  $$ select public.pirate_enable('e4000000-0000-0000-0000-000000000014') $$,
  'GM enables the mode'
);
select extensions.throws_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014',
                                   'charting', null) $$,
  '55000', 'Pirate setup is not ready', 'incomplete setup cannot open the game'
);
select extensions.is(
  public.pirate_set_paused('e4000000-0000-0000-0000-000000000014', true)->>'paused',
  'true', 'GM can pause Pirate play'
);
select extensions.is(
  public.pirate_set_pvp('e4000000-0000-0000-0000-000000000014', false)->>'pvp_enabled',
  'false', 'GM can disable Parley separately'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2000000-0000-0000-0000-000000000012', true);
select extensions.throws_ok(
  $$ select public.pirate_set_paused('e4000000-0000-0000-0000-000000000014', false) $$,
  '42501', 'GM access required', 'player cannot unpause Pirate play'
);
reset role;

-- Bypass readiness only in this transaction to exercise every phase edge.
update public.games set phase = 'charting', status = 'active'
where id = 'e4000000-0000-0000-0000-000000000014';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e1000000-0000-0000-0000-000000000011', true);
select extensions.throws_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'hunt', null) $$,
  '55000', 'Pirate phase can move only one step', 'GM cannot skip a phase'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'cursed', null) $$,
  'charting advances to cursed'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'charting', null) $$,
  'one step back is allowed'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'cursed', null) $$,
  'charting can be resumed'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'truce', null) $$,
  'truce follows cursed'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'hunt', null) $$,
  'hunt follows truce'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'hoard', null) $$,
  'hoard follows hunt'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'recall', null) $$,
  'recall follows hoard'
);
select extensions.lives_ok(
  $$ select public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'finished', null) $$,
  'finished follows recall'
);
select extensions.is(
  (select status from public.games where id = 'e4000000-0000-0000-0000-000000000014'),
  'finished', 'finishing the Pirate phase also finishes the game'
);
select extensions.is(
  public.pirate_set_phase('e4000000-0000-0000-0000-000000000014', 'recall', null)->>'status',
  'ok', 'GM can correct an accidentally finished phase'
);
reset role;
select extensions.is(
  (select count(*)::integer from public.game_events
   where game_id = 'e4000000-0000-0000-0000-000000000014' and type = 'pirate_phase'),
  22, 'pause, PvP and corrected phase transitions emit one event per player'
);
select extensions.ok(
  not exists (select 1 from public.game_events
              where game_id = 'e4000000-0000-0000-0000-000000000014'
                and type = 'pirate_phase' and (not player_visible or profile_id is null)),
  'every phase event uses the existing player-scoped delivery path'
);

select * from extensions.finish();
rollback;
