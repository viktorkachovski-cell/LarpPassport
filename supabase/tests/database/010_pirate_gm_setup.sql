begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(16);

select extensions.is(private.pirate_normalize_answer('  Black, Tide!  '), 'blacktide',
  'English answers ignore case, spacing and punctuation');
select extensions.ok(
  has_function_privilege('authenticated', 'public.pirate_enable(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pirate_enable(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.pirate_set_site(uuid,uuid,text,text,smallint,text,text,text)', 'EXECUTE'),
  'Pirate setup RPCs are available only to authenticated callers'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-setup-gm@example.test', '', now(),
   '{"username":"pirate_setup_gm"}'::jsonb, now(), now()),
  ('c2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'pirate-setup-player@example.test', '', now(),
   '{"username":"pirate_setup_player"}'::jsonb, now(), now());

insert into public.games (id, gm_id, name, join_code)
values
  ('c3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000001', 'Pirate Setup', 'C3A0C0D3'),
  ('c4000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000001', 'Other Game', 'C4A0C0D4');
insert into public.game_players (game_id, profile_id, role)
values ('c3000000-0000-0000-0000-000000000003',
        'c2000000-0000-0000-0000-000000000002', 'player');
insert into public.zones (id, game_id, name, geog, radius_m, trigger_mode)
values
  ('c5000000-0000-0000-0000-000000000005', 'c3000000-0000-0000-0000-000000000003',
   'Riddle', extensions.st_setsrid(extensions.st_makepoint(30, 50), 4326)::extensions.geography,
   40, 'silent'),
  ('c6000000-0000-0000-0000-000000000006', 'c4000000-0000-0000-0000-000000000004',
   'Other Riddle', extensions.st_setsrid(extensions.st_makepoint(30.01, 50), 4326)::extensions.geography,
   40, 'silent');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
select extensions.lives_ok(
  $$ select public.pirate_enable('c3000000-0000-0000-0000-000000000003') $$,
  'GM can enable Pirate mode on a draft game'
);
select extensions.is(
  (select phase from public.games where id = 'c3000000-0000-0000-0000-000000000003'),
  'setup', 'enabling Pirate mode sets setup phase'
);
select extensions.throws_ok(
  $$ select public.pirate_set_site('c3000000-0000-0000-0000-000000000003',
       'c6000000-0000-0000-0000-000000000006', 'riddle', 'bearing', null, null,
       'What is the tide?', 'Black Tide') $$,
  '22023', 'zone is not in this game', 'GM cannot register a zone from another game'
);
select extensions.lives_ok(
  $$ select public.pirate_set_site('c3000000-0000-0000-0000-000000000003',
       'c5000000-0000-0000-0000-000000000005', 'riddle', 'bearing', null, null,
       'What is the tide?', 'Black Tide!') $$,
  'GM can register a riddle site'
);
select extensions.ok(
  not (public.pirate_set_site('c3000000-0000-0000-0000-000000000003',
       'c5000000-0000-0000-0000-000000000005', 'riddle', 'bearing', null, null,
       'What is the tide?', null) ? 'answer'),
  'updating a site does not return its answer'
);
reset role;
select extensions.is(
  (select answer_hash from private.pirate_sites where zone_id = 'c5000000-0000-0000-0000-000000000005'),
  encode(extensions.digest('blacktide:c5000000-0000-0000-0000-000000000005', 'sha256'), 'hex'),
  'null answer keeps the normalized server-side answer hash'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok(
  $$ select public.pirate_clear_site('c3000000-0000-0000-0000-000000000003',
       'c5000000-0000-0000-0000-000000000005') $$,
  '42501', 'GM access required', 'player cannot clear a Pirate site'
);
select extensions.throws_ok(
  $$ select public.pirate_validate('c3000000-0000-0000-0000-000000000003') $$,
  '42501', 'GM access required', 'player cannot inspect Pirate setup'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
select extensions.ok(
  not (public.pirate_validate('c3000000-0000-0000-0000-000000000003')->>'ready')::boolean,
  'validator rejects an incomplete test game'
);
select extensions.is(
  public.pirate_clear_site('c3000000-0000-0000-0000-000000000003',
                           'c5000000-0000-0000-0000-000000000005')->>'status',
  'ok', 'GM can remove a site with no history'
);
reset role;
update public.games set phase = 'charting' where id = 'c3000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
select extensions.lives_ok(
  $$ select public.pirate_set_treasure('c3000000-0000-0000-0000-000000000003', 50, 30) $$,
  'GM may set treasure in charting before readings'
);
select extensions.is(
  public.pirate_enable('c3000000-0000-0000-0000-000000000003')->>'phase',
  'charting', 'idempotent enable does not reset an existing phase'
);
reset role;
update public.games set phase = 'cursed' where id = 'c3000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
select extensions.throws_ok(
  $$ select public.pirate_set_treasure('c3000000-0000-0000-0000-000000000003', 50.01, 30) $$,
  '55000', 'treasure point is locked', 'treasure locks from cursed onward'
);
select extensions.throws_ok(
  $$ select public.pirate_set_site('c3000000-0000-0000-0000-000000000003',
       'c5000000-0000-0000-0000-000000000005', 'riddle', 'bearing', null, null,
       'What is the tide?', 'Black Tide') $$,
  '55000', 'Pirate site setup is closed', 'site classification locks after setup'
);
reset role;

select * from extensions.finish();
rollback;
