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

insert into private.pirate_parleys (id,game_id,target_profile,target_faction,code,code_expires_at,state)
values ('f9000000-0000-0000-0000-000000000109','f5000000-0000-0000-0000-000000000105','f2000000-0000-0000-0000-000000000102','f6000000-0000-0000-0000-000000000106','1234',now()+interval '90 seconds','open');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,75.1,0) where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'too_far', 'join refuses separation');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'stale', 'join refuses own stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f2000000-0000-0000-0000-000000000102' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'target_stale', 'join refuses other stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'treasure_exclusion', 'join refuses hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105'; update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,110,0) where game_id='f5000000-0000-0000-0000-000000000105' and profile_id='f3000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'target_treasure_exclusion', 'join refuses other hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set paused=true where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'paused', 'join refuses pause');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set pvp_enabled=false where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'pvp_disabled', 'join refuses kill switch');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'open', 'join refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,75.1,0) where profile_id='f2000000-0000-0000-0000-000000000102' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'too_far', 'choose refuses separation');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f2000000-0000-0000-0000-000000000102' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'stale', 'choose refuses own stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'target_stale', 'choose refuses other stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'treasure_exclusion', 'choose refuses hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105'; update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,110,0) where game_id='f5000000-0000-0000-0000-000000000105' and profile_id='f2000000-0000-0000-0000-000000000102';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'target_treasure_exclusion', 'choose refuses other hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set paused=true where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'paused', 'choose refuses pause');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='joined', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set pvp_enabled=false where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','fight')->>'status', 'pvp_disabled', 'choose refuses kill switch');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'joined', 'choose refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,75.1,0) where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'too_far', 'report refuses separation');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'stale', 'report refuses own stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f2000000-0000-0000-0000-000000000102' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'target_stale', 'report refuses other stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'treasure_exclusion', 'report refuses hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105'; update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,110,0) where game_id='f5000000-0000-0000-0000-000000000105' and profile_id='f3000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'target_treasure_exclusion', 'report refuses other hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set paused=true where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'paused', 'report refuses pause');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set pvp_enabled=false where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'status', 'pvp_disabled', 'report refuses kill switch');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'fighting', 'report refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,75.1,0) where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'too_far', 'plunder refuses separation');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'stale', 'plunder refuses own stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set recorded_at=now()-interval '121 seconds' where profile_id='f2000000-0000-0000-0000-000000000102' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'target_stale', 'plunder refuses other stale fix');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'treasure_exclusion', 'plunder refuses hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.games set phase='hoard' where id='f5000000-0000-0000-0000-000000000105'; update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,110,0) where game_id='f5000000-0000-0000-0000-000000000105' and profile_id='f3000000-0000-0000-0000-000000000103';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'target_treasure_exclusion', 'plunder refuses other hoard exclusion');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set paused=true where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'paused', 'plunder refuses pause');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update private.pirate_games set pvp_enabled=false where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','doubloon')->>'status', 'pvp_disabled', 'plunder refuses kill switch');
reset role;
select extensions.is((select state from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'awaiting_choice', 'plunder refusal leaves session unchanged');
delete from private.pirate_mercy where game_id='f5000000-0000-0000-0000-000000000105'; delete from private.pirate_ledger where game_id='f5000000-0000-0000-0000-000000000105' and source='parley';
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='f9000000-0000-0000-0000-000000000109';
update public.player_positions set geog=extensions.st_project(extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography,74.9,0) where profile_id='f3000000-0000-0000-0000-000000000103' and game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.join_parley('f5000000-0000-0000-0000-000000000105','1234','f8000000-0000-0000-0000-000000000108')->>'status', 'ok', 'a separation below 75 m permits joining');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_choice('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','yield')->>'state', 'yielded', 'nearby target may yield');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'state', 'awaiting_report', 'one report transfers nothing');
reset role;
update private.pirate_parleys set updated_at=now()-interval '60 seconds' where id='f9000000-0000-0000-0000-000000000109';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'state', 'awaiting_report', 'identical report retry returns saved result');
reset role;
select extensions.is((select (updated_at=now()-interval '60 seconds')::text from private.pirate_parleys where id='f9000000-0000-0000-0000-000000000109'), 'true', 'report retries do not extend timeout');
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_report('f5000000-0000-0000-0000-000000000105','f9000000-0000-0000-0000-000000000109','f7000000-0000-0000-0000-000000000107')->>'state', 'resolved', 'matching yield confirmation resolves');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105','f6000000-0000-0000-0000-000000000106','doubloon')::text, '17', 'yield transfers three doubloons once');
insert into private.pirate_parleys (id,game_id,target_profile,target_faction,code,code_expires_at,state) values ('fa000000-0000-0000-0000-000000000110','f5000000-0000-0000-0000-000000000105','f2000000-0000-0000-0000-000000000102','f6000000-0000-0000-0000-000000000106','5678',now()+interval '90 seconds','open');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='awaiting_choice', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction='f7000000-0000-0000-0000-000000000107'::uuid,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='fa000000-0000-0000-0000-000000000110';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','fa000000-0000-0000-0000-000000000110','doubloon')->>'amount', '5', 'fight plunder computes capped rounded amount');
reset role;
update public.player_positions set recorded_at=now()-interval '121 seconds' where game_id='f5000000-0000-0000-0000-000000000105';
set local role authenticated;
select set_config('request.jwt.claim.sub','f3000000-0000-0000-0000-000000000103',true);
select extensions.is(public.parley_plunder('f5000000-0000-0000-0000-000000000105','fa000000-0000-0000-0000-000000000110','doubloon')->>'amount', '5', 'committed plunder retry returns original amount despite stale GPS');
reset role;
select extensions.is(private.pirate_parley_balance('f5000000-0000-0000-0000-000000000105','f6000000-0000-0000-0000-000000000106','doubloon')::text, '12', 'plunder retry never transfers twice');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='open', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile=null,attacker_faction=null,
join_idem=null,winner_faction=null,
choice=null,plunder=null,code_expires_at=now()+interval '90 seconds'
where id='fa000000-0000-0000-0000-000000000110';
update private.pirate_parleys set code_expires_at=now()-interval '1 second' where id='fa000000-0000-0000-0000-000000000110';
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is((public.get_pirate_state('f5000000-0000-0000-0000-000000000105')->'active_parley'='null'::jsonb)::text, 'true', 'polling releases an expired open code');
reset role;
select extensions.is((select state from private.pirate_parleys where id='fa000000-0000-0000-0000-000000000110'), 'expired', 'status read persists code expiry');
update public.games set phase='cursed' where id='f5000000-0000-0000-0000-000000000105';
update private.pirate_games set paused=false,pvp_enabled=true,treasure_geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography where game_id='f5000000-0000-0000-0000-000000000105';
update public.player_positions set geog=extensions.st_setsrid(extensions.st_makepoint(30,50),4326)::extensions.geography, recorded_at=now() where game_id='f5000000-0000-0000-0000-000000000105';
update private.pirate_parleys set state='fighting', updated_at=now(),target_report=null,attacker_report=null,
attacker_profile='f3000000-0000-0000-0000-000000000103'::uuid,attacker_faction='f7000000-0000-0000-0000-000000000107'::uuid,
join_idem=null,winner_faction=null,
choice='fight',plunder=null,code_expires_at=now()+interval '90 seconds'
where id='fa000000-0000-0000-0000-000000000110';
update private.pirate_parleys set updated_at=now()-interval '301 seconds' where id='fa000000-0000-0000-0000-000000000110';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1000000-0000-0000-0000-000000000101',true);
select extensions.is(public.gm_pirate_overview('f5000000-0000-0000-0000-000000000105')->'parleys'->0->>'state', 'disputed', 'GM polling surfaces five-minute timeout');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-0000-0000-000000000102',true);
select extensions.is(public.get_pirate_state('f5000000-0000-0000-0000-000000000105')->'active_parley'->>'state', 'disputed', 'player refresh sees the same timeout');
reset role;
select extensions.is((select count(*)::text from public.game_events where game_id='f5000000-0000-0000-0000-000000000105' and type='pirate_dispute'), '1', 'repeated refreshes emit one dispute only');
select extensions.is(has_function_privilege('authenticated','private.pirate_parley_pair_presence(uuid,uuid,uuid,text,extensions.geography)','EXECUTE')::text, 'false', 'private presence helper is not a client endpoint');
select extensions.is(has_function_privilege('anon','public.get_pirate_state(uuid)','EXECUTE')::text, 'false', 'status mutation retains anonymous denial');
select * from extensions.finish();
rollback;
