begin;
create extension if not exists pgtap with schema extensions;
select extensions.plan(10);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'locked-gm@example.test', '', now(),
   '{"username":"locked_gm"}', now(), now()),
  ('a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'locked-player@example.test', '', now(),
   '{"username":"locked_player"}', now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
insert into public.games (id, gm_id, name, template)
values ('a3000000-0000-0000-0000-000000000003',
  'a1000000-0000-0000-0000-000000000001', 'Locked fields regression',
  '{"stats":[
    {"key":"hp","type":"number","default":10,"min":0,"max":20,"player_editable":false},
    {"key":"rank","type":"text","default":"rookie","player_editable":false},
    {"key":"notes","type":"text","default":"","player_editable":true}
  ]}');
insert into public.game_players (game_id, profile_id, role)
values ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'player');

select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select extensions.lives_ok($$
  insert into public.characters (id, game_id, user_id, name)
  values ('a4000000-0000-0000-0000-000000000004', 'a3000000-0000-0000-0000-000000000003',
    'a2000000-0000-0000-0000-000000000002', 'Traveller')
$$, 'players can create a character with locked defaults');
select extensions.is((select fields->>'hp' from public.characters
  where id = 'a4000000-0000-0000-0000-000000000004'), '10', 'creation fills the locked default');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
update public.characters set fields = '{"hp":3,"rank":"veteran","notes":""}'
where id = 'a4000000-0000-0000-0000-000000000004';
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select extensions.throws_ok($$
  update public.characters set fields = jsonb_set(fields, '{hp}', '10')
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'P0001', 'field "hp" is not player-editable', 'players cannot heal by restoring the HP default');
select extensions.throws_ok($$
  update public.characters set fields = fields - 'hp'
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'P0001', 'field "hp" is not player-editable', 'omitting HP cannot restore its default');
select extensions.throws_ok($$
  update public.characters set fields = jsonb_set(fields, '{rank}', '"rookie"')
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'P0001', 'field "rank" is not player-editable', 'locked text also rejects default resets');
select extensions.lives_ok($$
  update public.characters set fields = jsonb_set(fields, '{notes}', '"player note"')
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'players can still edit their unlocked notes');
select extensions.is((select fields->>'hp' from public.characters
  where id = 'a4000000-0000-0000-0000-000000000004'), '3', 'player edits preserve GM-set HP');

select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select extensions.lives_ok($$
  update public.characters set fields = jsonb_set(fields, '{hp}', '7')
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'GMs retain control of locked fields');
update public.games set template = jsonb_set(template, '{stats}', (template->'stats') ||
  '[{"key":"mana","type":"number","default":5,"player_editable":false}]')
where id = 'a3000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub', 'a2000000-0000-0000-0000-000000000002', true);
select extensions.lives_ok($$
  update public.characters set fields = jsonb_set(fields, '{notes}', '"updated note"')
  where id = 'a4000000-0000-0000-0000-000000000004'
$$, 'a newly added locked field can receive its template default');
select extensions.is((select fields->>'mana' from public.characters
  where id = 'a4000000-0000-0000-0000-000000000004'), '5', 'new template defaults remain compatible');

select * from extensions.finish();
rollback;
