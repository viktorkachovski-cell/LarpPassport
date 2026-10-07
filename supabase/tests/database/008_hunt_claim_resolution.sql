begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(4);

select extensions.ok(
  not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname in ('hunt_players_defer_target_assignment', 'hunt_claims_reject_after_confirmation')
  ),
  'claim resolution no longer depends on triggers that rewrite its updates'
);

-- Fixtures: three players, chain A -> B -> C -> A --------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_user_meta_data, created_at, updated_at
)
values
  ('c1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-gm@example.test', '', now(),
   '{"username":"claim_gm"}'::jsonb, now(), now()),
  ('c2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-one@example.test', '', now(),
   '{"username":"claim_one"}'::jsonb, now(), now()),
  ('c3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-two@example.test', '', now(),
   '{"username":"claim_two"}'::jsonb, now(), now()),
  ('c4000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'claim-three@example.test', '', now(),
   '{"username":"claim_three"}'::jsonb, now(), now());

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);

insert into public.games (id, gm_id, name, join_code)
values ('c9000000-0000-0000-0000-000000000009', 'c1000000-0000-0000-0000-000000000001', 'Claim Test', 'C9C9C9C9');

insert into public.game_players (game_id, profile_id, role)
values
  ('c9000000-0000-0000-0000-000000000009', 'c2000000-0000-0000-0000-000000000002', 'player'),
  ('c9000000-0000-0000-0000-000000000009', 'c3000000-0000-0000-0000-000000000003', 'player'),
  ('c9000000-0000-0000-0000-000000000009', 'c4000000-0000-0000-0000-000000000004', 'player');

insert into public.characters (game_id, user_id, name)
values
  ('c9000000-0000-0000-0000-000000000009', 'c2000000-0000-0000-0000-000000000002', 'Claim One'),
  ('c9000000-0000-0000-0000-000000000009', 'c3000000-0000-0000-0000-000000000003', 'Claim Two'),
  ('c9000000-0000-0000-0000-000000000009', 'c4000000-0000-0000-0000-000000000004', 'Claim Three');

select public.start_hunt('c9000000-0000-0000-0000-000000000009');
reset role;

-- start_hunt shuffles the chain; name its links.
select set_config('test.a', (
  select profile_id::text from private.hunt_players
  where game_id = 'c9000000-0000-0000-0000-000000000009'
  order by profile_id limit 1
), true);
select set_config('test.b', (
  select target_profile_id::text from private.hunt_players
  where game_id = 'c9000000-0000-0000-0000-000000000009' and profile_id = current_setting('test.a')::uuid
), true);
select set_config('test.c', (
  select target_profile_id::text from private.hunt_players
  where game_id = 'c9000000-0000-0000-0000-000000000009' and profile_id = current_setting('test.b')::uuid
), true);

-- A claims B, C claims A, then B confirms --------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select set_config('test.claim_ab', public.request_elimination('c9000000-0000-0000-0000-000000000009') ->> 'claim_id', true);
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select set_config('test.claim_ca', public.request_elimination('c9000000-0000-0000-0000-000000000009') ->> 'claim_id', true);
select set_config('request.jwt.claim.sub', current_setting('test.b'), true);
select public.respond_elimination(current_setting('test.claim_ab')::uuid, true);
reset role;

select extensions.is(
  (select status from private.hunt_claims where id = current_setting('test.claim_ca')::uuid),
  'rejected',
  'confirming one claim voids the other open claims'
);
select extensions.ok(
  (select target_profile_id is null
          and pending_target_profile_id = current_setting('test.c')::uuid
          and hidden_until > now() + interval '9 minutes'
   from private.hunt_players
   where game_id = 'c9000000-0000-0000-0000-000000000009' and profile_id = current_setting('test.a')::uuid),
  'the cloaked hunter waits for the GM with the victim''s target pending'
);

-- GM assigns C to A, A claims C, C confirms: final kill -------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000001', true);
select public.gm_assign_next_target('c9000000-0000-0000-0000-000000000009', current_setting('test.a')::uuid);
select set_config('request.jwt.claim.sub', current_setting('test.a'), true);
select set_config('test.claim_ac', public.request_elimination('c9000000-0000-0000-0000-000000000009') ->> 'claim_id', true);
select set_config('request.jwt.claim.sub', current_setting('test.c'), true);
select public.respond_elimination(current_setting('test.claim_ac')::uuid, true);
reset role;

select extensions.ok(
  (select target_profile_id is null and pending_target_profile_id is null
   from private.hunt_players
   where game_id = 'c9000000-0000-0000-0000-000000000009' and profile_id = current_setting('test.a')::uuid)
  and (select status = 'finished' and winner_id = current_setting('test.a')::uuid
       from private.hunt_rounds where game_id = 'c9000000-0000-0000-0000-000000000009'),
  'the final confirmation finishes the round with no pending assignment'
);

select * from extensions.finish();
rollback;
