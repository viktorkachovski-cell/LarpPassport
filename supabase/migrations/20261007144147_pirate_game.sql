-- Pirate game ("The Black Tide"): schema, GM setup and phases, site claims,
-- compass, player and GM state, treasure, and Parley. Rules: docs/pirate-game/GAME_GUIDE.md.

-- ============================================================================
-- pirate mode foundation
-- ============================================================================

-- A Pirate game is marked by a private row. Ordinary and Time Hunt games keep
-- phase NULL, so this adds no new state transitions to their existing flows.
alter table public.games
  add column phase text
  constraint games_pirate_phase_check
  check (phase is null or phase in (
    'setup', 'charting', 'cursed', 'truce', 'hunt', 'hoard', 'recall', 'finished'
  ));

grant select (phase) on public.games to authenticated;

-- Phase transitions will go through GM RPCs. A GM's ordinary games UPDATE
-- grant must not bypass the future phase gates through the Data API.
create function private.protect_pirate_phase()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.phase is not null then
      raise exception using errcode = '42501', message = 'Pirate phase must be changed through a GM action';
    elsif tg_op = 'UPDATE' then
      if new.phase is distinct from old.phase then
        raise exception using errcode = '42501', message = 'Pirate phase must be changed through a GM action';
      end if;
      if old.phase is not null and new.status is distinct from old.status then
        raise exception using errcode = '42501', message = 'Pirate status follows the GM phase action';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_pirate_phase() from public, anon, authenticated;
create trigger protect_pirate_phase
  before insert or update of phase, status on public.games
  for each row execute function private.protect_pirate_phase();

create table private.pirate_games (
  game_id uuid primary key references public.games(id) on delete cascade,
  paused boolean not null default false,
  pvp_enabled boolean not null default true,
  treasure_geog extensions.geography(Point, 4326),
  treasure_value integer not null default 40 check (treasure_value between 0 and 1000),
  hmac_secret bytea not null default extensions.gen_random_bytes(32),
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

-- Composite keys keep each Pirate row in its game's zone and crew. The public
-- tables already have ID primary keys; these indexes support the scoped FKs.
create unique index factions_game_id_id_pirate_fk_idx on public.factions (game_id, id);
create unique index zones_game_id_id_pirate_fk_idx on public.zones (game_id, id);

create table private.pirate_sites (
  zone_id uuid primary key,
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  kind text not null check (kind in ('riddle', 'cache', 'lighthouse', 'harbour', 'treasure')),
  reward text check (reward in ('bearing', 'oath')),
  oath_index smallint check (oath_index between 1 and 4),
  oath_word text check (oath_word is null or char_length(trim(oath_word)) between 1 and 40),
  prompt text check (prompt is null or char_length(prompt) <= 500),
  answer_hash text check (answer_hash is null or answer_hash ~ '^[0-9a-f]{64}$'),
  check (kind = 'riddle' or reward is null),
  check (kind = 'riddle' or (oath_index is null and oath_word is null)),
  check (kind = 'riddle' or answer_hash is null or kind = 'cache'),
  check (kind <> 'riddle' or reward is not null),
  check (reward is distinct from 'oath' or (oath_index is not null and oath_word is not null)),
  check (reward is distinct from 'bearing' or (oath_index is null and oath_word is null)),
  foreign key (game_id, zone_id) references public.zones(game_id, id)
    on delete no action deferrable initially deferred
);
create unique index pirate_sites_game_zone_idx on private.pirate_sites (game_id, zone_id);
create index pirate_sites_game_kind_idx on private.pirate_sites (game_id, kind);
create unique index pirate_sites_oath_index_idx
  on private.pirate_sites (game_id, oath_index) where reward = 'oath';
create unique index pirate_sites_one_treasure_idx
  on private.pirate_sites (game_id) where kind = 'treasure';

create table private.pirate_claims (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  zone_id uuid not null,
  faction_id uuid not null,
  claimed_by uuid not null references public.profiles(id),
  rank smallint check (rank between 1 and 4),
  via_gm boolean not null default false,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_at timestamptz not null default now(),
  check ((voided_at is null and voided_by is null and void_reason is null)
         or (voided_at is not null and voided_by is not null
             and char_length(trim(void_reason)) between 3 and 300)),
  foreign key (game_id, zone_id) references private.pirate_sites(game_id, zone_id)
    on delete no action deferrable initially deferred,
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
create unique index pirate_claims_active_crew_site_idx
  on private.pirate_claims (zone_id, faction_id) where voided_at is null;
create index pirate_claims_game_crew_time_idx
  on private.pirate_claims (game_id, faction_id, created_at desc);
create index pirate_claims_zone_rank_idx
  on private.pirate_claims (zone_id, rank) where voided_at is null;

create table private.pirate_attempts (
  id bigint generated always as identity primary key,
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  zone_id uuid not null,
  faction_id uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  idem uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  ok boolean not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (game_id, zone_id) references private.pirate_sites(game_id, zone_id)
    on delete no action deferrable initially deferred,
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
create unique index pirate_attempts_idem_idx
  on private.pirate_attempts (game_id, profile_id, idem);
create index pirate_attempts_limit_idx
  on private.pirate_attempts (game_id, zone_id, faction_id, profile_id, created_at desc)
  where not ok;

create table private.pirate_ledger (
  id bigint generated always as identity primary key,
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  faction_id uuid not null,
  currency text not null check (currency in ('bearing', 'doubloon')),
  delta integer not null check (delta <> 0),
  source text not null check (source in ('riddle', 'cache', 'parley', 'treasure', 'gm')),
  ref_id uuid,
  reason text,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (source <> 'gm' or char_length(trim(reason)) between 3 and 300),
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
create index pirate_ledger_balance_idx
  on private.pirate_ledger (game_id, faction_id, currency);
create index pirate_ledger_history_idx
  on private.pirate_ledger (game_id, faction_id, created_at desc);
create index pirate_ledger_ref_idx
  on private.pirate_ledger (ref_id) where ref_id is not null;

create table private.pirate_readings (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  zone_id uuid not null,
  faction_id uuid not null,
  shards smallint not null check (shards between 1 and 5),
  centre_deg smallint not null check (centre_deg between 0 and 359),
  half_width_deg smallint not null check (half_width_deg in (90, 45, 25, 12, 5)),
  taken_by uuid not null references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_at timestamptz not null default now(),
  check ((voided_at is null and voided_by is null and void_reason is null)
         or (voided_at is not null and voided_by is not null
             and char_length(trim(void_reason)) between 3 and 300)),
  foreign key (game_id, zone_id) references private.pirate_sites(game_id, zone_id)
    on delete no action deferrable initially deferred,
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
create unique index pirate_readings_active_level_idx
  on private.pirate_readings (zone_id, faction_id, shards) where voided_at is null;
create index pirate_readings_game_crew_time_idx
  on private.pirate_readings (game_id, faction_id, created_at desc);

create table private.pirate_parleys (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  target_faction uuid not null,
  target_profile uuid not null references public.profiles(id),
  attacker_faction uuid,
  attacker_profile uuid references public.profiles(id),
  join_idem uuid,
  code text not null check (code ~ '^[0-9]{4}$'),
  code_expires_at timestamptz not null,
  state text not null check (state in (
    'open', 'joined', 'yielded', 'fighting', 'awaiting_choice',
    'resolved', 'disputed', 'expired', 'voided'
  )),
  choice text check (choice in ('yield', 'fight')),
  target_report uuid,
  attacker_report uuid,
  winner_faction uuid,
  plunder text check (plunder in ('bearing', 'doubloon')),
  far_apart boolean not null default false,
  resolved_by uuid references public.profiles(id),
  resolution_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attacker_faction is null or attacker_faction <> target_faction),
  check ((attacker_faction is null and attacker_profile is null)
         or (attacker_faction is not null and attacker_profile is not null)),
  check (join_idem is null or attacker_profile is not null),
  check ((voided_at is null and voided_by is null and void_reason is null)
         or (voided_at is not null and voided_by is not null
             and char_length(trim(void_reason)) between 3 and 300)),
  foreign key (game_id, target_faction) references public.factions(game_id, id) on delete cascade,
  foreign key (game_id, attacker_faction) references public.factions(game_id, id),
  foreign key (game_id, target_report) references public.factions(game_id, id),
  foreign key (game_id, attacker_report) references public.factions(game_id, id),
  foreign key (game_id, winner_faction) references public.factions(game_id, id)
);
create unique index pirate_parleys_open_code_idx
  on private.pirate_parleys (game_id, code) where state = 'open';
create unique index pirate_parleys_join_idem_idx
  on private.pirate_parleys (game_id, attacker_profile, join_idem) where join_idem is not null;
create index pirate_parleys_game_time_idx
  on private.pirate_parleys (game_id, created_at desc);
create index pirate_parleys_target_active_idx
  on private.pirate_parleys (game_id, target_faction, state);
create index pirate_parleys_attacker_active_idx
  on private.pirate_parleys (game_id, attacker_faction, state);

-- A Parley that still involves its crews: anything not resolved, expired or
-- voided. Every "is this crew in a Parley" check uses this one list.
create function private.pirate_parley_live(state text)
returns boolean
language sql
immutable
set search_path = ''
as $
  select state in ('open', 'joined', 'yielded', 'fighting', 'awaiting_choice', 'disputed');
$;
revoke all on function private.pirate_parley_live(text) from public, anon, authenticated;

create table private.pirate_mercy (
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  faction_id uuid not null,
  until_at timestamptz not null,
  source_parley_id uuid,
  primary key (game_id, faction_id),
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade,
  foreign key (source_parley_id) references private.pirate_parleys(id)
    on delete no action deferrable initially deferred
);

-- A partial uniqueness constraint allows a voided award to be replaced while
-- retaining the original row and its audit history.
create table private.pirate_treasure_awards (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references private.pirate_games(game_id) on delete cascade,
  faction_id uuid not null,
  awarded_by uuid not null references public.profiles(id),
  voided_at timestamptz,
  voided_by uuid references public.profiles(id),
  void_reason text,
  created_at timestamptz not null default now(),
  check ((voided_at is null and voided_by is null and void_reason is null)
         or (voided_at is not null and voided_by is not null
             and char_length(trim(void_reason)) between 3 and 300)),
  foreign key (game_id, faction_id) references public.factions(game_id, id) on delete cascade
);
create unique index pirate_treasure_awards_active_game_idx
  on private.pirate_treasure_awards (game_id) where voided_at is null;
create index pirate_treasure_awards_faction_idx
  on private.pirate_treasure_awards (faction_id);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'pirate_games', 'pirate_sites', 'pirate_claims', 'pirate_attempts',
    'pirate_ledger', 'pirate_readings', 'pirate_parleys', 'pirate_mercy',
    'pirate_treasure_awards'
  ] loop
    execute pg_catalog.format('alter table private.%I enable row level security', table_name);
    execute pg_catalog.format(
      'create policy %I on private.%I for all to anon, authenticated using (false) with check (false)',
      table_name || '_deny_clients', table_name
    );
    execute pg_catalog.format('revoke all on private.%I from public, anon, authenticated', table_name);
  end loop;
end;
$$;

-- Both mode changes and hunt starts serialize on the game row. Whichever
-- transaction wins commits its mode before the other checks eligibility.
create function private.prepare_pirate_game()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.games where id = new.game_id for update;
  if exists (select 1 from private.hunt_rounds where game_id = new.game_id) then
    raise exception using errcode = '55000', message = 'Pirate mode cannot be enabled on a Time Hunt game';
  end if;
  update public.games set phase = 'setup' where id = new.game_id;
  return new;
end;
$$;

revoke all on function private.prepare_pirate_game() from public, anon, authenticated;
create trigger prepare_pirate_game
  before insert on private.pirate_games
  for each row execute function private.prepare_pirate_game();

-- Enforce the mode boundary at the hunt state table. This also covers callers
-- other than start_hunt without copying that existing function's long body.
create function private.reject_pirate_hunt_round()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.games where id = new.game_id for update;
  if exists (select 1 from private.pirate_games where game_id = new.game_id) then
    raise exception using errcode = '55000', message = 'Time Hunt cannot start in a Pirate game';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_pirate_hunt_round() from public, anon, authenticated;

create trigger reject_pirate_hunt_round
  before insert on private.hunt_rounds
  for each row execute function private.reject_pirate_hunt_round();

-- ============================================================================
-- pirate gm setup
-- ============================================================================

-- First GM-only Pirate setup operations. No player-facing Pirate RPC is
-- exposed until its state transition and denial tests have been added.
create function private.pirate_normalize_answer(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(value)), '[^a-z0-9]+', '', 'g');
$$;
revoke all on function private.pirate_normalize_answer(text) from public, anon, authenticated;

create function public.pirate_enable(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game_status text;
  current_phase text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select status, phase into game_status, current_phase from public.games where id = g;
  if game_status is null then
    raise exception using errcode = '22023', message = 'game not found';
  end if;
  if exists (select 1 from private.pirate_games where game_id = g) then
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', current_phase);
  end if;
  if game_status <> 'draft' or current_phase is not null then
    raise exception using errcode = '55000', message = 'only a draft ordinary game can enable Pirate mode';
  end if;
  insert into private.pirate_games (game_id) values (g);
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', 'setup');
end;
$$;

create function public.pirate_set_site(
  g uuid, zone_id uuid, kind text, reward text,
  oath_index smallint, oath_word text, prompt text, answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  zone_record record;
  previous_hash text;
  normalized text;
  new_hash text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or zone_id is null or kind is null then
    raise exception using errcode = '22023', message = 'game, zone and kind are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if not exists (select 1 from private.pirate_games where game_id = g) then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  if (select phase from public.games where id = g) <> 'setup' then
    raise exception using errcode = '55000', message = 'Pirate site setup is closed';
  end if;
  select z.shape, z.trigger_mode, z.zone_type, z.active into zone_record
  from public.zones z where z.id = zone_id and z.game_id = g;
  if not found then
    raise exception using errcode = '22023', message = 'zone is not in this game';
  end if;
  if zone_record.zone_type <> 'event' or not zone_record.active then
    raise exception using errcode = '22023', message = 'Pirate site needs an active event zone';
  end if;
  if kind not in ('riddle', 'cache', 'lighthouse', 'harbour', 'treasure') then
    raise exception using errcode = '22023', message = 'invalid Pirate site kind';
  end if;
  if kind = 'lighthouse' and zone_record.shape <> 'circle' then
    raise exception using errcode = '22023', message = 'lighthouse must be a circle';
  end if;
  if kind in ('riddle', 'cache', 'lighthouse') and zone_record.trigger_mode <> 'silent' then
    raise exception using errcode = '22023', message = 'this Pirate site needs a silent zone';
  end if;
  if kind = 'treasure' and zone_record.trigger_mode <> 'gm_confirm' then
    raise exception using errcode = '22023', message = 'treasure zone needs GM confirmation';
  end if;
  if kind = 'riddle' then
    if reward is null or reward not in ('bearing', 'oath') then
      raise exception using errcode = '22023', message = 'riddle reward must be bearing or oath';
    end if;
    if reward = 'oath' and (oath_index is null or oath_word is null or pg_catalog.btrim(oath_word) = '') then
      raise exception using errcode = '22023', message = 'oath index and word are required';
    end if;
    if reward = 'bearing' and (oath_index is not null or oath_word is not null) then
      raise exception using errcode = '22023', message = 'bearing riddles cannot contain oath words';
    end if;
  elsif reward is not null or oath_index is not null or oath_word is not null then
    raise exception using errcode = '22023', message = 'only riddles have a reward or oath word';
  end if;
  if kind in ('riddle', 'cache') and (prompt is null or pg_catalog.btrim(prompt) = '') then
    raise exception using errcode = '22023', message = 'riddle or cache prompt is required';
  end if;
  if kind not in ('riddle', 'cache') and answer is not null then
    raise exception using errcode = '22023', message = 'this site has no answer';
  end if;

  select s.answer_hash into previous_hash from private.pirate_sites s where s.zone_id = pirate_set_site.zone_id;
  if answer is not null then
    if pg_catalog.char_length(answer) > 100 then
      raise exception using errcode = '22023', message = 'answer is too long';
    end if;
    normalized := private.pirate_normalize_answer(answer);
    if normalized = '' then
      raise exception using errcode = '22023', message = 'answer must contain English letters or digits';
    end if;
    new_hash := pg_catalog.encode(extensions.digest(normalized || ':' || zone_id::text, 'sha256'), 'hex');
  elsif kind in ('riddle', 'cache') then
    new_hash := previous_hash;
  end if;
  if kind in ('riddle', 'cache') and new_hash is null then
    raise exception using errcode = '22023', message = 'answer is required for this site';
  end if;

  insert into private.pirate_sites (
    zone_id, game_id, kind, reward, oath_index, oath_word, prompt, answer_hash
  ) values (
    zone_id, g, kind, reward, oath_index, oath_word, prompt, new_hash
  ) on conflict on constraint pirate_sites_pkey do update set
    kind = excluded.kind,
    reward = excluded.reward,
    oath_index = excluded.oath_index,
    oath_word = excluded.oath_word,
    prompt = excluded.prompt,
    answer_hash = excluded.answer_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'zone_id', zone_id, 'answer_set', new_hash is not null);
end;
$$;

create function public.pirate_clear_site(g uuid, zone_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or zone_id is null then
    raise exception using errcode = '22023', message = 'game and zone are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if (select phase from public.games where id = g) <> 'setup' then
    raise exception using errcode = '55000', message = 'Pirate site setup is closed';
  end if;
  if exists (select 1 from private.pirate_claims where game_id = g and pirate_claims.zone_id = pirate_clear_site.zone_id)
     or exists (select 1 from private.pirate_attempts where game_id = g and pirate_attempts.zone_id = pirate_clear_site.zone_id)
     or exists (select 1 from private.pirate_readings where game_id = g and pirate_readings.zone_id = pirate_clear_site.zone_id) then
    return pg_catalog.jsonb_build_object('status', 'history_exists');
  end if;
  delete from private.pirate_sites where game_id = g and pirate_sites.zone_id = pirate_clear_site.zone_id;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'not_found' end);
end;
$$;

create function public.pirate_set_treasure(g uuid, lat double precision, lng double precision, value integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or lat is null or lng is null or value is null
     or lat < -90 or lat > 90 or lng < -180 or lng > 180
     or value < 0 or value > 1000 then
    raise exception using errcode = '22023', message = 'invalid treasure point or value';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  if (select phase from public.games where id = g) not in ('setup', 'charting')
     or exists (select 1 from private.pirate_readings where game_id = g) then
    raise exception using errcode = '55000', message = 'treasure point is locked';
  end if;
  update private.pirate_games
  set treasure_geog = extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography,
      treasure_value = value, updated_at = now()
  where game_id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$$;

create function public.pirate_validate(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  issues text[] := array[]::text[];
  crew_count integer;
  missing_crew_count integer;
  wrong_size_count integer;
  bearing_count integer;
  oath_count integer;
  cache_count integer;
  lighthouse_count integer;
  harbour_count integer;
  treasure_count integer;
  missing_answers integer;
  overlap_count integer;
  bad_lighthouse_count integer;
  treasure_point extensions.geography(Point, 4326);
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  select treasure_geog into treasure_point from private.pirate_games where game_id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;

  select count(*)::integer into crew_count from public.factions where game_id = g;
  if crew_count <> 4 then
    issues := pg_catalog.array_append(issues, 'Exactly four crews are required');
  end if;
  select count(*)::integer into missing_crew_count
  from public.game_players gp
  left join public.characters c on c.game_id = gp.game_id and c.user_id = gp.profile_id and not c.is_npc
  left join public.factions f on f.id = c.faction_id and f.game_id = g
  where gp.game_id = g and gp.role = 'player' and (c.id is null or f.id is null);
  if missing_crew_count > 0 then
    issues := pg_catalog.array_append(issues, 'Every player needs a character in a crew');
  end if;
  select count(*)::integer into wrong_size_count from (
    select f.id from public.factions f
    left join public.characters c on c.faction_id = f.id and c.game_id = g and not c.is_npc
    left join public.game_players gp on gp.game_id = g and gp.profile_id = c.user_id and gp.role = 'player'
    where f.game_id = g
    group by f.id having count(gp.profile_id) not between 3 and 4
  ) wrong_sizes;
  if wrong_size_count > 0 then
    issues := pg_catalog.array_append(issues, 'Each crew needs three or four players');
  end if;

  select count(*) filter (where s.kind = 'riddle' and s.reward = 'bearing'),
         count(*) filter (where s.kind = 'riddle' and s.reward = 'oath'),
         count(*) filter (where s.kind = 'cache'),
         count(*) filter (where s.kind = 'lighthouse'),
         count(*) filter (where s.kind = 'harbour'),
         count(*) filter (where s.kind = 'treasure'),
         count(*) filter (where s.kind in ('riddle', 'cache') and s.answer_hash is null)
    into bearing_count, oath_count, cache_count, lighthouse_count,
         harbour_count, treasure_count, missing_answers
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.active
  where s.game_id = g;
  if bearing_count <> 7 then issues := pg_catalog.array_append(issues, 'Seven bearing riddles are required'); end if;
  if oath_count <> 4 then issues := pg_catalog.array_append(issues, 'Four oath riddles are required'); end if;
  if cache_count <> 8 then issues := pg_catalog.array_append(issues, 'Eight caches are required'); end if;
  if lighthouse_count <> 6 then issues := pg_catalog.array_append(issues, 'Six lighthouses are required'); end if;
  if harbour_count <> 3 then issues := pg_catalog.array_append(issues, 'Three Safe Harbours are required'); end if;
  if treasure_count <> 1 or treasure_point is null then
    issues := pg_catalog.array_append(issues, 'A treasure zone and secret point are required');
  end if;
  if missing_answers > 0 then
    issues := pg_catalog.array_append(issues, 'Every riddle and cache needs an answer');
  end if;
  if oath_count = 4 and (
    select count(distinct s.oath_index) from private.pirate_sites s
    join public.zones z on z.id = s.zone_id and z.active
    where s.game_id = g and s.reward = 'oath'
  ) <> 4 then
    issues := pg_catalog.array_append(issues, 'Oath words must cover indexes one to four');
  end if;
  select count(*)::integer into overlap_count
  from private.pirate_sites a
  join private.pirate_sites b on b.game_id = a.game_id and b.zone_id > a.zone_id
  join public.zones za on za.id = a.zone_id and za.active
  join public.zones zb on zb.id = b.zone_id and zb.active
  where a.game_id = g and extensions.st_dwithin(
    za.geog, zb.geog, coalesce(za.radius_m, 0) + coalesce(zb.radius_m, 0)
  );
  if overlap_count > 0 then
    issues := pg_catalog.array_append(issues, 'Pirate site zones overlap');
  end if;
  if treasure_point is not null then
    select count(*)::integer into bad_lighthouse_count
    from private.pirate_sites s join public.zones z on z.id = s.zone_id
    where s.game_id = g and s.kind = 'lighthouse'
      and (z.shape <> 'circle' or extensions.st_distance(z.geog, treasure_point) not between 200 and 1500);
    if bad_lighthouse_count > 0 then
      issues := pg_catalog.array_append(issues, 'Lighthouses must be circles 200 to 1500 metres from treasure');
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'ready', pg_catalog.cardinality(issues) = 0,
    'issues', pg_catalog.to_jsonb(issues),
    'counts', pg_catalog.jsonb_build_object(
      'crews', crew_count, 'bearing_riddles', bearing_count, 'oath_riddles', oath_count,
      'caches', cache_count, 'lighthouses', lighthouse_count,
      'harbours', harbour_count, 'treasure_sites', treasure_count
    )
  );
end;
$$;

revoke all on function public.pirate_enable(uuid) from public, anon;
revoke all on function public.pirate_set_site(uuid, uuid, text, text, smallint, text, text, text) from public, anon;
revoke all on function public.pirate_clear_site(uuid, uuid) from public, anon;
revoke all on function public.pirate_set_treasure(uuid, double precision, double precision, integer) from public, anon;
revoke all on function public.pirate_validate(uuid) from public, anon;
grant execute on function public.pirate_enable(uuid) to authenticated;
grant execute on function public.pirate_set_site(uuid, uuid, text, text, smallint, text, text, text) to authenticated;
grant execute on function public.pirate_clear_site(uuid, uuid) to authenticated;
grant execute on function public.pirate_set_treasure(uuid, double precision, double precision, integer) to authenticated;
grant execute on function public.pirate_validate(uuid) to authenticated;

-- ============================================================================
-- pirate phase control
-- ============================================================================

create function private.emit_pirate_event(p_game_id uuid, p_type text, p_payload jsonb)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, profile_id, type, status, player_visible, payload)
  select p_game_id, player.profile_id, p_type, 'confirmed', true, p_payload
  from public.game_players player
  where player.game_id = p_game_id and player.role = 'player';
$$;
revoke all on function private.emit_pirate_event(uuid, text, jsonb) from public, anon, authenticated;

create function public.pirate_set_phase(g uuid, next_phase text, message text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phases constant text[] := array['setup', 'charting', 'cursed', 'truce', 'hunt', 'hoard', 'recall', 'finished'];
  current_phase text;
  current_index integer;
  next_index integer;
  clean_message text := pg_catalog.btrim(message);
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or next_phase is null then
    raise exception using errcode = '22023', message = 'game and phase are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  next_index := pg_catalog.array_position(phases, next_phase);
  if next_index is null then
    raise exception using errcode = '22023', message = 'invalid Pirate phase';
  end if;
  if clean_message is not null and pg_catalog.char_length(clean_message) > 300 then
    raise exception using errcode = '22023', message = 'phase message is too long';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase into current_phase from public.games game
  join private.pirate_games pirate on pirate.game_id = game.id
  where game.id = g;
  if not found then
    raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
  end if;
  current_index := pg_catalog.array_position(phases, current_phase);
  if current_index is null then
    raise exception using errcode = '55000', message = 'invalid current Pirate phase';
  end if;
  if current_phase = next_phase then
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', current_phase);
  end if;
  if current_phase = 'finished' or pg_catalog.abs(next_index - current_index) <> 1 then
    raise exception using errcode = '55000', message = 'Pirate phase can move only one step';
  end if;
  if current_phase = 'setup' and next_phase = 'charting'
     and not (public.pirate_validate(g)->>'ready')::boolean then
    raise exception using errcode = '55000', message = 'Pirate setup is not ready';
  end if;
  update public.games
  set phase = next_phase,
      status = case when next_phase = 'finished' then 'finished'
                    when next_phase = 'setup' then 'draft'
                    when next_phase = 'charting' then 'active'
                    else status end
  where id = g;
  perform private.emit_pirate_event(g, 'pirate_phase', pg_catalog.jsonb_build_object(
    'phase', next_phase, 'message', coalesce(nullif(clean_message, ''),
      'Pirate phase: ' || next_phase)
  ));
  return pg_catalog.jsonb_build_object('status', 'ok', 'phase', next_phase);
end;
$$;

create function public.pirate_set_paused(g uuid, paused boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or paused is null then
    raise exception using errcode = '22023', message = 'game and paused value are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  update private.pirate_games pirate set paused = pirate_set_paused.paused, updated_at = now()
  where pirate.game_id = g and pirate.paused is distinct from pirate_set_paused.paused;
  if not found then
    if not exists (select 1 from private.pirate_games where game_id = g) then
      raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
    end if;
  else
    perform private.emit_pirate_event(g, 'pirate_phase',
      pg_catalog.jsonb_build_object('paused', paused, 'message',
        case when paused then 'The tide has stopped.' else 'The tide moves again.' end));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'paused', paused);
end;
$$;

create function public.pirate_set_pvp(g uuid, enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid := auth.uid();
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or enabled is null then
    raise exception using errcode = '22023', message = 'game and PvP value are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  update private.pirate_games set pvp_enabled = enabled, updated_at = now()
  where game_id = g and pvp_enabled is distinct from enabled;
  if not found then
    if not exists (select 1 from private.pirate_games where game_id = g) then
      raise exception using errcode = '55000', message = 'Pirate mode is not enabled';
    end if;
  else
    perform private.emit_pirate_event(g, 'pirate_phase',
      pg_catalog.jsonb_build_object('pvp_enabled', enabled, 'message',
        case when enabled then 'Parley is open.' else 'Parley is closed.' end));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'pvp_enabled', enabled);
end;
$$;

revoke all on function public.pirate_set_phase(uuid, text, text) from public, anon;
revoke all on function public.pirate_set_paused(uuid, boolean) from public, anon;
revoke all on function public.pirate_set_pvp(uuid, boolean) from public, anon;
grant execute on function public.pirate_set_phase(uuid, text, text) to authenticated;
grant execute on function public.pirate_set_paused(uuid, boolean) to authenticated;
grant execute on function public.pirate_set_pvp(uuid, boolean) to authenticated;

-- ============================================================================
-- pirate gm role guard
-- ============================================================================

-- The existing dashboard can promote game members to GM. Keep that path,
-- but protect the owner and the final GM for Pirate game-night continuity.
create function private.protect_pirate_gm_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.role <> 'gm' or new.role = 'gm' then return new; end if;
  elsif old.role <> 'gm' then
    return old;
  end if;
  if not exists (select 1 from private.pirate_games where game_id = old.game_id)
     or not exists (select 1 from public.games where id = old.game_id) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if old.profile_id = (select gm_id from public.games where id = old.game_id) then
    raise exception using errcode = '55000', message = 'cannot remove the game owner GM';
  end if;
  if (select count(*) from public.game_players
      where game_id = old.game_id and role = 'gm') <= 1 then
    raise exception using errcode = '55000', message = 'cannot remove the last GM';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.protect_pirate_gm_role() from public, anon, authenticated;
create trigger protect_pirate_gm_role
  before update of role or delete on public.game_players
  for each row execute function private.protect_pirate_gm_role();

-- ============================================================================
-- pirate site claims
-- ============================================================================

-- Server-held presence and position are the only proof of being on site.
create function private.pirate_current_sites(p_game_id uuid, p_user_id uuid)
returns table (
  zone_id uuid, kind text, reward text, oath_index smallint, oath_word text,
  prompt text, answer_hash text, site_name text
)
language sql
stable
set search_path = ''
as $$
  select s.zone_id, s.kind, s.reward, s.oath_index, s.oath_word,
         s.prompt, s.answer_hash, z.name
  from private.pirate_sites s
  join public.zones z on z.id = s.zone_id and z.game_id = p_game_id
  join private.zone_state state on state.zone_id = z.id and state.profile_id = p_user_id
  where s.game_id = p_game_id and z.active and state.inside
    and state.inside_since is not null
    and state.inside_since <= now() - pg_catalog.make_interval(secs => z.dwell_seconds);
$$;
revoke all on function private.pirate_current_sites(uuid, uuid) from public, anon, authenticated;

create function private.emit_pirate_crew_event(
  p_game_id uuid, p_faction_id uuid, p_type text, p_payload jsonb
)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, profile_id, type, status, player_visible, payload)
  select p_game_id, player.profile_id, p_type, 'confirmed', true, p_payload
  from public.game_players player
  join public.characters character on character.game_id = player.game_id
    and character.user_id = player.profile_id and not character.is_npc
  where player.game_id = p_game_id and player.role = 'player'
    and character.faction_id = p_faction_id;
$$;
revoke all on function private.emit_pirate_crew_event(uuid, uuid, text, jsonb)
  from public, anon, authenticated;

create function public.site_here(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  site record;
  candidate_count integer;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  if not exists (select 1 from private.pirate_games where game_id = g) then
    return null;
  end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return null;
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  select count(*)::integer into candidate_count from private.pirate_current_sites(g, caller);
  if candidate_count = 0 then return null; end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select * into site from private.pirate_current_sites(g, caller) limit 1;
  return pg_catalog.jsonb_build_object(
    'site_name', site.site_name, 'kind', site.kind, 'reward', site.reward,
    'prompt', site.prompt,
    'claimed_by_my_crew', exists (
      select 1 from private.pirate_claims claim
      where claim.game_id = g and claim.zone_id = site.zone_id
        and claim.faction_id = crew_id and claim.voided_at is null
    )
  );
end;
$$;

create function public.claim_site(g uuid, answer text, idem uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  game_phase text;
  game_paused boolean;
  secret bytea;
  normalized text;
  request_hash text;
  prior record;
  site record;
  candidate_count integer;
  answer_digest text;
  wrong_count integer;
  claim_id uuid;
  cache_rank integer;
  payout integer;
  result jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or answer is null or idem is null or pg_catalog.char_length(answer) > 100 then
    raise exception using errcode = '22023', message = 'game, bounded answer and request ID are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  normalized := private.pirate_normalize_answer(answer);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.hmac_secret
    into game_phase, game_paused, secret
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  request_hash := pg_catalog.encode(
    extensions.hmac(pg_catalog.convert_to('claim:' || normalized || ':' || g::text, 'UTF8'), secret, 'sha256'), 'hex');
  select attempt.request_hash, attempt.result into prior
  from private.pirate_attempts attempt
  where attempt.game_id = g and attempt.profile_id = caller and attempt.idem = claim_site.idem;
  if found then
    if prior.request_hash <> request_hash then
      return pg_catalog.jsonb_build_object('status', 'idempotency_conflict');
    end if;
    return prior.result;
  end if;
  if game_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if game_phase not in ('charting', 'cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;

  select count(*)::integer into candidate_count
  from private.pirate_current_sites(g, caller) current_site
  where current_site.kind in ('riddle', 'cache');
  if candidate_count = 0 then return pg_catalog.jsonb_build_object('status', 'no_site'); end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select * into site from private.pirate_current_sites(g, caller) current_site
  where current_site.kind in ('riddle', 'cache') limit 1;
  if exists (select 1 from private.pirate_claims claim
             where claim.zone_id = site.zone_id and claim.faction_id = crew_id
               and claim.voided_at is null) then
    return pg_catalog.jsonb_build_object('status', 'already_claimed');
  end if;

  select count(*)::integer into wrong_count from private.pirate_attempts attempt
  where attempt.game_id = g and attempt.zone_id = site.zone_id
    and attempt.faction_id = crew_id and not attempt.ok
    and attempt.created_at > now() - interval '120 seconds';
  if wrong_count >= 3 then
    return pg_catalog.jsonb_build_object('status', 'locked_out', 'remaining_seconds', 120);
  end if;
  answer_digest := pg_catalog.encode(
    extensions.digest(normalized || ':' || site.zone_id::text, 'sha256'), 'hex');
  if site.answer_hash is null or normalized = '' or answer_digest <> site.answer_hash then
    result := pg_catalog.jsonb_build_object('status', case when wrong_count + 1 >= 3 then 'locked_out' else 'wrong' end,
      'attempts_remaining', greatest(0, 3 - wrong_count - 1),
      'remaining_seconds', case when wrong_count + 1 >= 3 then 120 else 0 end);
    insert into private.pirate_attempts (
      game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
    ) values (g, site.zone_id, crew_id, caller, idem, request_hash, false, result);
    return result;
  end if;

  if site.kind = 'cache' then
    select count(*)::integer + 1 into cache_rank from private.pirate_claims claim
    where claim.zone_id = site.zone_id and claim.voided_at is null;
    if cache_rank > 4 then return pg_catalog.jsonb_build_object('status', 'fully_claimed'); end if;
    payout := (array[20, 15, 10, 5])[cache_rank];
  end if;
  insert into private.pirate_claims (game_id, zone_id, faction_id, claimed_by, rank)
  values (g, site.zone_id, crew_id, caller, cache_rank) returning id into claim_id;
  if site.kind = 'cache' then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'doubloon', payout, 'cache', claim_id, caller);
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'doubloon', 'amount', payout,
      'rank', cache_rank, 'site_name', site.site_name);
  elsif site.reward = 'bearing' then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, actor_id)
    values (g, crew_id, 'bearing', 1, 'riddle', claim_id, caller);
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'bearing', 'amount', 1,
      'site_name', site.site_name);
  else
    result := pg_catalog.jsonb_build_object('status', 'ok', 'reward', 'oath',
      'oath_index', site.oath_index, 'oath_word', site.oath_word, 'site_name', site.site_name);
  end if;
  insert into private.pirate_attempts (
    game_id, zone_id, faction_id, profile_id, idem, request_hash, ok, result
  ) values (g, site.zone_id, crew_id, caller, idem, request_hash, true, result);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_claim', result);
  return result;
end;
$$;

revoke all on function public.site_here(uuid) from public, anon;
revoke all on function public.claim_site(uuid, text, uuid) from public, anon;
grant execute on function public.site_here(uuid) to authenticated;
grant execute on function public.claim_site(uuid, text, uuid) to authenticated;

-- ============================================================================
-- pirate compass
-- ============================================================================

-- Bearings are computed only from server-held lighthouse and treasure points.
-- The game advisory lock serializes a reading with shard ledger changes.
create function public.compass_reading(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  treasure extensions.geography;
  secret bytea;
  balance integer;
  level smallint;
  half_width smallint;
  candidate_count integer;
  lighthouse record;
  previous record;
  hash_bytes bytea;
  unit_fraction numeric;
  true_deg double precision;
  arc_centre smallint;
  reading_time timestamptz;
  response jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.treasure_geog, pirate.hmac_secret
    into phase_name, is_paused, treasure, secret
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if treasure is null then return pg_catalog.jsonb_build_object('status', 'not_ready'); end if;
  if not exists (select 1 from public.player_positions position
                 where position.game_id = g and position.profile_id = caller
                   and position.recorded_at >= now() - interval '120 seconds') then
    return pg_catalog.jsonb_build_object('status', 'stale');
  end if;
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id and ledger.currency = 'bearing';
  if balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
  level := least(balance, 5)::smallint;
  half_width := (array[90, 45, 25, 12, 5])[level]::smallint;

  select count(*)::integer into candidate_count
  from private.pirate_current_sites(g, caller) current_site
  where current_site.kind = 'lighthouse';
  if candidate_count = 0 then return pg_catalog.jsonb_build_object('status', 'no_site'); end if;
  if candidate_count > 1 then return pg_catalog.jsonb_build_object('status', 'ambiguous'); end if;
  select current_site.zone_id, current_site.site_name, zone.geog into lighthouse
  from private.pirate_current_sites(g, caller) current_site
  join public.zones zone on zone.id = current_site.zone_id
  where current_site.kind = 'lighthouse' limit 1;
  if not exists (select 1 from public.zones zone where zone.id = lighthouse.zone_id
                 and zone.shape = 'circle') then
    return pg_catalog.jsonb_build_object('status', 'not_ready');
  end if;

  select reading.centre_deg, reading.half_width_deg, reading.created_at into previous
  from private.pirate_readings reading
  where reading.zone_id = lighthouse.zone_id and reading.faction_id = crew_id
    and reading.shards = level and reading.voided_at is null;
  if found then
    return pg_catalog.jsonb_build_object('status', 'ok',
      'lighthouse_name', lighthouse.site_name, 'centre_deg', previous.centre_deg,
      'half_width_deg', previous.half_width_deg, 'level', level, 'taken_at', previous.created_at);
  end if;

  true_deg := pg_catalog.degrees(extensions.st_azimuth(lighthouse.geog, treasure));
  hash_bytes := extensions.hmac(
    pg_catalog.convert_to(crew_id::text || ':' || lighthouse.zone_id::text || ':' || level::text, 'UTF8'),
    secret, 'sha256');
  unit_fraction := (
    pg_catalog.get_byte(hash_bytes, 0)::numeric * 16777216
    + pg_catalog.get_byte(hash_bytes, 1)::numeric * 65536
    + pg_catalog.get_byte(hash_bytes, 2)::numeric * 256
    + pg_catalog.get_byte(hash_bytes, 3)::numeric
  ) / 4294967296.0;
  arc_centre := pg_catalog.mod(
    pg_catalog.round(true_deg + (2 * unit_fraction - 1) * 0.8 * half_width)::integer + 360,
    360)::smallint;
  insert into private.pirate_readings (
    game_id, zone_id, faction_id, shards, centre_deg, half_width_deg, taken_by
  ) values (g, lighthouse.zone_id, crew_id, level, arc_centre, half_width, caller)
  returning created_at into reading_time;
  response := pg_catalog.jsonb_build_object('status', 'ok',
    'lighthouse_name', lighthouse.site_name, 'centre_deg', arc_centre,
    'half_width_deg', half_width, 'level', level, 'taken_at', reading_time);
  perform private.emit_pirate_crew_event(g, crew_id, 'pirate_reading', response);
  return response;
end;
$$;

create function public.treasure_band(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  treasure extensions.geography;
  own_point extensions.geography;
  balance integer;
  metres double precision;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('band', 'locked'); end if;
  select game.phase, pirate.paused, pirate.treasure_geog
    into phase_name, is_paused, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found or is_paused or phase_name not in ('cursed', 'hunt', 'hoard') or treasure is null then
    return pg_catalog.jsonb_build_object('band', 'locked');
  end if;
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id and ledger.currency = 'bearing';
  if balance < 3 then return pg_catalog.jsonb_build_object('band', 'locked'); end if;
  select position.geog into own_point from public.player_positions position
  where position.game_id = g and position.profile_id = caller
    and position.recorded_at >= now() - interval '120 seconds';
  if own_point is null then return pg_catalog.jsonb_build_object('band', 'stale'); end if;
  metres := extensions.st_distance(own_point, treasure);
  return pg_catalog.jsonb_build_object('band', case
    when metres <= 25 then '25' when metres <= 100 then '100' else 'far' end);
end;
$$;

revoke all on function public.compass_reading(uuid) from public, anon;
revoke all on function public.treasure_band(uuid) from public, anon;
grant execute on function public.compass_reading(uuid) to authenticated;
grant execute on function public.treasure_band(uuid) to authenticated;

-- ============================================================================
-- pirate player state
-- ============================================================================

-- A player receives only their own crew's state. Site and distance details
-- continue to pass through the dedicated server-side presence checks.
create function public.get_pirate_state(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  player_role text;
  crew_id uuid;
  crew_name text;
  crew_color text;
  phase_name text;
  is_paused boolean;
  is_pvp_enabled boolean;
  shards integer;
  doubloons integer;
  oath_words jsonb;
  reading_list jsonb;
  mercy_end timestamptz;
  parley_info jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  select player.role into player_role from public.game_players player
  where player.game_id = g and player.profile_id = caller;
  if player_role is null then
    raise exception using errcode = '42501', message = 'game membership required';
  end if;
  select game.phase, pirate.paused, pirate.pvp_enabled
    into phase_name, is_paused, is_pvp_enabled
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;
  if player_role <> 'player' then
    return pg_catalog.jsonb_build_object('is_pirate', true, 'role', player_role,
      'phase', phase_name, 'paused', is_paused, 'pvp_enabled', is_pvp_enabled);
  end if;
  select faction.id, faction.name, faction.color into crew_id, crew_name, crew_color
  from public.characters character
  join public.factions faction on faction.id = character.faction_id and faction.game_id = g
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then
    return pg_catalog.jsonb_build_object('is_pirate', true, 'role', 'player',
      'phase', phase_name, 'paused', is_paused, 'pvp_enabled', is_pvp_enabled,
      'status', 'no_crew');
  end if;
  select coalesce(sum(delta) filter (where currency = 'bearing'), 0)::integer,
         coalesce(sum(delta) filter (where currency = 'doubloon'), 0)::integer
    into shards, doubloons
  from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = crew_id;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'index', site.oath_index, 'word', site.oath_word) order by site.oath_index), '[]'::jsonb)
    into oath_words
  from private.pirate_claims claim
  join private.pirate_sites site on site.zone_id = claim.zone_id
  where claim.game_id = g and claim.faction_id = crew_id
    and claim.voided_at is null and site.reward = 'oath';
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'lighthouse_name', zone.name, 'centre_deg', reading.centre_deg,
    'half_width_deg', reading.half_width_deg, 'level', reading.shards,
    'taken_at', reading.created_at) order by reading.created_at desc), '[]'::jsonb)
    into reading_list
  from private.pirate_readings reading
  join public.zones zone on zone.id = reading.zone_id and zone.game_id = g
  where reading.game_id = g and reading.faction_id = crew_id and reading.voided_at is null;
  select mercy.until_at into mercy_end from private.pirate_mercy mercy
  where mercy.game_id = g and mercy.faction_id = crew_id and mercy.until_at > now();
  select pg_catalog.jsonb_build_object(
    'id', parley.id, 'state', parley.state,
    'role', case when parley.target_faction = crew_id then 'target' else 'attacker' end,
    'can_act', coalesce(caller = parley.target_profile
      or caller = parley.attacker_profile, false),
    'self_reported', case when caller = parley.target_profile then parley.target_report is not null
                          when caller = parley.attacker_profile then parley.attacker_report is not null
                          else false end,
    'code', case when parley.target_profile = caller and parley.state = 'open'
                 then parley.code else null end,
    'code_expires_at', parley.code_expires_at,
    'target_faction', parley.target_faction, 'attacker_faction', parley.attacker_faction,
    'opponent_name', case when parley.target_faction = crew_id then attacker.name else target.name end,
    'choice', parley.choice, 'winner_faction', parley.winner_faction,
    'plunder', parley.plunder, 'far_apart', parley.far_apart)
    into parley_info
  from private.pirate_parleys parley
  join public.factions target on target.id = parley.target_faction
  left join public.factions attacker on attacker.id = parley.attacker_faction
  where parley.game_id = g and parley.voided_at is null
    and private.pirate_parley_live(parley.state)
    and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)
  order by parley.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'role', 'player', 'phase', phase_name,
    'paused', is_paused, 'pvp_enabled', is_pvp_enabled,
    'crew', pg_catalog.jsonb_build_object('id', crew_id, 'name', crew_name, 'color', crew_color),
    'shards', shards, 'doubloons', doubloons, 'oath', oath_words,
    'readings', reading_list, 'mercy_until', mercy_end, 'active_parley', parley_info,
    'site_here', public.site_here(g), 'band', public.treasure_band(g)->>'band');
end;
$$;

revoke all on function public.get_pirate_state(uuid) from public, anon;
grant execute on function public.get_pirate_state(uuid) to authenticated;

-- ============================================================================
-- pirate gm overview
-- ============================================================================

-- GM-only operational snapshot. The answer hashes and game secret remain private.
create function public.gm_pirate_overview(g uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  game_phase text;
  game_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  treasure_amount integer;
  crew_rows jsonb;
  site_rows jsonb;
  award_info jsonb;
  parley_rows jsonb;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null then
    raise exception using errcode = '22023', message = 'game is required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  select game.phase, pirate.paused, pirate.pvp_enabled,
         pirate.treasure_geog, pirate.treasure_value
    into game_phase, game_paused, pvp_on, treasure, treasure_amount
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('is_pirate', false); end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', faction.id, 'name', faction.name, 'color', faction.color,
    'shards', coalesce((select sum(delta)::integer from private.pirate_ledger ledger
                       where ledger.game_id = g and ledger.faction_id = faction.id
                         and ledger.currency = 'bearing'), 0),
    'doubloons', coalesce((select sum(delta)::integer from private.pirate_ledger ledger
                          where ledger.game_id = g and ledger.faction_id = faction.id
                            and ledger.currency = 'doubloon'), 0),
    'oath_count', (select count(*) from private.pirate_claims claim
                   join private.pirate_sites site on site.zone_id = claim.zone_id
                   where claim.game_id = g and claim.faction_id = faction.id
                     and claim.voided_at is null and site.reward = 'oath'),
    'reading_count', (select count(*) from private.pirate_readings reading
                      where reading.game_id = g and reading.faction_id = faction.id
                        and reading.voided_at is null),
    'last_claim_at', (select max(claim.created_at) from private.pirate_claims claim
                      where claim.game_id = g and claim.faction_id = faction.id
                        and claim.voided_at is null),
    'mercy_until', (select mercy.until_at from private.pirate_mercy mercy
                    where mercy.game_id = g and mercy.faction_id = faction.id)
  ) order by faction.name), '[]'::jsonb) into crew_rows
  from public.factions faction where faction.game_id = g;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'zone_id', site.zone_id, 'name', zone.name, 'kind', site.kind,
    'reward', site.reward, 'oath_index', site.oath_index,
    'answer_set', site.answer_hash is not null,
    'active', zone.active,
    'claims', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', claim.id, 'faction_id', claim.faction_id, 'rank', claim.rank,
      'claimed_at', claim.created_at) order by claim.created_at)
      from private.pirate_claims claim
      where claim.game_id = g and claim.zone_id = site.zone_id and claim.voided_at is null), '[]'::jsonb)
  ) order by zone.name), '[]'::jsonb) into site_rows
  from private.pirate_sites site join public.zones zone on zone.id = site.zone_id
  where site.game_id = g;

  select pg_catalog.jsonb_build_object('id', award.id, 'faction_id', award.faction_id,
    'crew_name', faction.name, 'awarded_at', award.created_at)
    into award_info
  from private.pirate_treasure_awards award
  join public.factions faction on faction.id = award.faction_id
  where award.game_id = g and award.voided_at is null;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', parley.id, 'state', parley.state, 'choice', parley.choice,
    'target_faction', parley.target_faction, 'target_name', target.name,
    'attacker_faction', parley.attacker_faction, 'attacker_name', attacker.name,
    'target_report', parley.target_report, 'attacker_report', parley.attacker_report,
    'winner_faction', parley.winner_faction, 'plunder', parley.plunder,
    'far_apart', parley.far_apart, 'created_at', parley.created_at
  ) order by parley.created_at desc), '[]'::jsonb) into parley_rows
  from private.pirate_parleys parley
  join public.factions target on target.id = parley.target_faction
  left join public.factions attacker on attacker.id = parley.attacker_faction
  where parley.game_id = g and parley.voided_at is null
    and private.pirate_parley_live(parley.state);

  return pg_catalog.jsonb_build_object(
    'is_pirate', true, 'phase', game_phase, 'paused', game_paused,
    'pvp_enabled', pvp_on,
    'treasure', case when treasure is null then null else pg_catalog.jsonb_build_object(
      'lat', extensions.st_y(treasure::extensions.geometry),
      'lng', extensions.st_x(treasure::extensions.geometry),
      'value', treasure_amount) end,
    'crews', crew_rows, 'sites', site_rows, 'treasure_award', award_info,
    'parleys', parley_rows);
end;
$$;

revoke all on function public.gm_pirate_overview(uuid) from public, anon;
grant execute on function public.gm_pirate_overview(uuid) to authenticated;

-- ============================================================================
-- pirate treasure award
-- ============================================================================

-- The on-site Ghost Captain verifies the spoken oath outside the app, then
-- records the one active treasure award for the game.
create function public.gm_award_treasure(g uuid, faction_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  phase_name text;
  amount integer;
  crew_name text;
  award_id uuid;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or faction_id is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'game, crew and reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.treasure_value into phase_name, amount
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then raise exception using errcode = '55000', message = 'Pirate mode is not enabled'; end if;
  if phase_name <> 'hoard' then return pg_catalog.jsonb_build_object('status', 'wrong_phase'); end if;
  select faction.name into crew_name from public.factions faction
  where faction.game_id = g and faction.id = gm_award_treasure.faction_id;
  if crew_name is null then
    raise exception using errcode = '22023', message = 'crew is not in this game';
  end if;
  if exists (select 1 from private.pirate_treasure_awards award
             where award.game_id = g and award.voided_at is null) then
    return pg_catalog.jsonb_build_object('status', 'already_awarded');
  end if;
  insert into private.pirate_treasure_awards (game_id, faction_id, awarded_by)
  values (g, faction_id, caller) returning id into award_id;
  if amount > 0 then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, reason, actor_id)
    values (g, faction_id, 'doubloon', amount, 'treasure', award_id, clean_reason, caller);
  end if;
  perform private.emit_pirate_event(g, 'pirate_treasure',
    pg_catalog.jsonb_build_object('crew_name', crew_name, 'amount', amount,
      'message', crew_name || ' claimed the hoard.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'award_id', award_id,
    'crew_name', crew_name, 'amount', amount);
end;
$$;

create function public.gm_void_treasure(g uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  award record;
  amount integer;
  balance integer;
  crew_name text;
begin
  if caller is null then
    raise exception using errcode = '28000', message = 'not authenticated';
  end if;
  if g is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'game and correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select id, faction_id into award from private.pirate_treasure_awards
  where game_id = g and voided_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_awarded'); end if;
  select coalesce(sum(delta), 0)::integer into amount from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.ref_id = award.id and ledger.source = 'treasure';
  select coalesce(sum(delta), 0)::integer into balance from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.faction_id = award.faction_id and ledger.currency = 'doubloon';
  if balance < amount then return pg_catalog.jsonb_build_object('status', 'insufficient_balance'); end if;
  update private.pirate_treasure_awards
  set voided_at = now(), voided_by = caller, void_reason = clean_reason
  where id = award.id;
  if amount > 0 then
    insert into private.pirate_ledger (game_id, faction_id, currency, delta, source, ref_id, reason, actor_id)
    values (g, award.faction_id, 'doubloon', -amount, 'treasure', award.id, clean_reason, caller);
  end if;
  select faction.name into crew_name from public.factions faction where faction.id = award.faction_id;
  perform private.emit_pirate_event(g, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'void_treasure', 'crew_name', crew_name,
      'reason', clean_reason, 'message', 'The treasure award was corrected by the GM.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'award_id', award.id, 'amount_reversed', amount);
end;
$$;

revoke all on function public.gm_award_treasure(uuid, uuid, text) from public, anon;
revoke all on function public.gm_void_treasure(uuid, text) from public, anon;
grant execute on function public.gm_award_treasure(uuid, uuid, text) to authenticated;
grant execute on function public.gm_void_treasure(uuid, text) to authenticated;

-- ============================================================================
-- pirate parley open join
-- ============================================================================

-- Parley is consent based: a target player shows a short-lived code and a
-- second player joins it. All mutations use the same per-game advisory lock.
create function private.pirate_parley_presence(
  p_game_id uuid, p_profile_id uuid, p_phase text, p_treasure extensions.geography
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare own_point extensions.geography;
begin
  select position.geog into own_point from public.player_positions position
  where position.game_id = p_game_id and position.profile_id = p_profile_id
    and position.recorded_at >= now() - interval '120 seconds';
  if own_point is null then return 'stale'; end if;
  if exists (select 1 from private.pirate_sites site
             join public.zones zone on zone.id = site.zone_id and zone.active
             join private.zone_state state on state.zone_id = zone.id
               and state.profile_id = p_profile_id and state.inside
             where site.game_id = p_game_id and site.kind = 'harbour') then
    return 'safe_harbour';
  end if;
  if p_phase = 'hoard' and p_treasure is not null
     and extensions.st_dwithin(own_point, p_treasure, 100) then
    return 'treasure_exclusion';
  end if;
  return null;
end;
$$;
revoke all on function private.pirate_parley_presence(uuid, uuid, text, extensions.geography)
  from public, anon, authenticated;

create function private.emit_pirate_parley_event(p_game_id uuid, p_parley_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare session record;
begin
  select target_faction, attacker_faction, state, winner_faction, plunder
    into session from private.pirate_parleys where id = p_parley_id and game_id = p_game_id;
  if not found then return; end if;
  perform private.emit_pirate_crew_event(p_game_id, session.target_faction, 'pirate_parley',
    pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'state', session.state,
      'winner_faction', session.winner_faction, 'plunder', session.plunder));
  if session.attacker_faction is not null then
    perform private.emit_pirate_crew_event(p_game_id, session.attacker_faction, 'pirate_parley',
      pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'state', session.state,
        'winner_faction', session.winner_faction, 'plunder', session.plunder));
  end if;
end;
$$;
revoke all on function private.emit_pirate_parley_event(uuid, uuid) from public, anon, authenticated;

create function private.pirate_queue_dispute(p_game_id uuid, p_parley_id uuid, p_reason text)
returns void
language sql
set search_path = ''
as $$
  insert into public.game_events (game_id, type, status, player_visible, payload)
  values (p_game_id, 'pirate_dispute', 'pending', false,
    pg_catalog.jsonb_build_object('parley_id', p_parley_id, 'reason', p_reason));
$$;
revoke all on function private.pirate_queue_dispute(uuid, uuid, text) from public, anon, authenticated;

create function private.pirate_sweep_parleys(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare expired record;
begin
  for expired in
    update private.pirate_parleys parley
    set state = 'expired', updated_at = now()
    where parley.game_id = p_game_id and parley.state = 'open'
      and parley.code_expires_at <= now() and parley.voided_at is null
    returning parley.id
  loop
    perform private.emit_pirate_parley_event(p_game_id, expired.id);
  end loop;
  for expired in
    update private.pirate_parleys parley
    set state = 'disputed', updated_at = now()
    where parley.game_id = p_game_id
      and parley.state in ('joined', 'yielded', 'fighting', 'awaiting_choice')
      and parley.updated_at <= now() - interval '300 seconds' and parley.voided_at is null
    returning parley.id
  loop
    perform private.pirate_queue_dispute(p_game_id, expired.id, 'Parley timed out');
    perform private.emit_pirate_parley_event(p_game_id, expired.id);
  end loop;
end;
$$;
revoke all on function private.pirate_sweep_parleys(uuid) from public, anon, authenticated;

create function public.open_parley(g uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  code_bytes bytea;
  new_code text;
  code_available boolean := false;
  session_id uuid;
  expires_at timestamptz;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null then raise exception using errcode = '22023', message = 'game is required'; end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  blocked := private.pirate_parley_presence(g, caller, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  if exists (select 1 from private.pirate_mercy mercy
             where mercy.game_id = g and mercy.faction_id = crew_id and mercy.until_at > now()) then
    return pg_catalog.jsonb_build_object('status', 'mercy');
  end if;
  select id, code, code_expires_at, target_profile into session
  from private.pirate_parleys parley
  where parley.game_id = g and parley.target_faction = crew_id
    and parley.state = 'open' and parley.voided_at is null
  order by parley.created_at desc limit 1;
  if found then
    if session.target_profile = caller then
      return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
        'code', session.code, 'code_expires_at', session.code_expires_at);
    end if;
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and parley.state in ('joined', 'yielded', 'fighting', 'awaiting_choice', 'disputed')
               and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)) then
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  for attempts in 1..10 loop
    code_bytes := extensions.gen_random_bytes(2);
    new_code := pg_catalog.lpad(((pg_catalog.get_byte(code_bytes, 0) * 256
      + pg_catalog.get_byte(code_bytes, 1)) % 10000)::text, 4, '0');
    if not exists (select 1 from private.pirate_parleys parley
                   where parley.game_id = g and parley.code = new_code
                     and parley.state = 'open') then
      code_available := true;
      exit;
    end if;
  end loop;
  if not code_available then
    raise exception using errcode = '55000', message = 'could not allocate a Parley code';
  end if;
  insert into private.pirate_parleys (
    game_id, target_faction, target_profile, code, code_expires_at, state
  ) values (g, crew_id, caller, new_code, now() + interval '90 seconds', 'open')
  returning id, code_expires_at into session_id, expires_at;
  perform private.emit_pirate_parley_event(g, session_id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session_id,
    'code', new_code, 'code_expires_at', expires_at);
end;
$$;

create function public.join_parley(g uuid, code text, idem uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  crew_id uuid;
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  treasure extensions.geography;
  blocked text;
  session record;
  previous record;
  own_point extensions.geography;
  target_point extensions.geography;
  apart boolean;
  recent_count integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or code is null or code !~ '^[0-9]{4}$' or idem is null then
    raise exception using errcode = '22023', message = 'game, four-digit code and request ID are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  select character.faction_id into crew_id from public.characters character
  where character.game_id = g and character.user_id = caller and not character.is_npc;
  if crew_id is null then return pg_catalog.jsonb_build_object('status', 'no_crew'); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select parley.id, parley.code, parley.state into previous
  from private.pirate_parleys parley
  where parley.game_id = g and parley.attacker_profile = caller and parley.join_idem = idem;
  if found then
    return pg_catalog.jsonb_build_object('status', case when previous.code = code then 'ok' else 'idempotency_conflict' end,
      'parley_id', previous.id, 'state', previous.state);
  end if;
  select game.phase, pirate.paused, pirate.pvp_enabled, pirate.treasure_geog
    into phase_name, is_paused, pvp_on, treasure
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select parley.id, parley.target_faction, parley.target_profile into session
  from private.pirate_parleys parley
  where parley.game_id = g and parley.code = join_parley.code
    and parley.state = 'open' and parley.code_expires_at > now() and parley.voided_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'invalid_code'); end if;
  if session.target_faction = crew_id then return pg_catalog.jsonb_build_object('status', 'same_crew'); end if;
  blocked := private.pirate_parley_presence(g, caller, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', blocked); end if;
  blocked := private.pirate_parley_presence(g, session.target_profile, phase_name, treasure);
  if blocked is not null then return pg_catalog.jsonb_build_object('status', 'target_' || blocked); end if;
  if exists (select 1 from private.pirate_mercy mercy
             where mercy.game_id = g and mercy.faction_id in (crew_id, session.target_faction)
               and mercy.until_at > now()) then
    return pg_catalog.jsonb_build_object('status', 'mercy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and private.pirate_parley_live(parley.state)
               and parley.id <> session.id
               and (parley.target_faction = crew_id or parley.attacker_faction = crew_id)) then
    return pg_catalog.jsonb_build_object('status', 'crew_busy');
  end if;
  if exists (select 1 from private.pirate_parleys parley
             where parley.game_id = g and parley.voided_at is null
               and parley.state in ('resolved', 'disputed')
               and parley.updated_at > now() - interval '30 minutes'
               and ((parley.target_faction = session.target_faction and parley.attacker_faction = crew_id)
                 or (parley.target_faction = crew_id and parley.attacker_faction = session.target_faction))) then
    return pg_catalog.jsonb_build_object('status', 'pair_cooldown');
  end if;
  select count(*)::integer into recent_count from private.pirate_parleys parley
  where parley.game_id = g and parley.attacker_faction = crew_id
    and parley.created_at > now() - interval '1 hour' and parley.voided_at is null;
  if recent_count >= 3 then return pg_catalog.jsonb_build_object('status', 'hourly_limit'); end if;
  select position.geog into own_point from public.player_positions position
  where position.game_id = g and position.profile_id = caller;
  select position.geog into target_point from public.player_positions position
  where position.game_id = g and position.profile_id = session.target_profile;
  apart := extensions.st_distance(own_point, target_point) > 75;
  update private.pirate_parleys
  set attacker_faction = crew_id, attacker_profile = caller, join_idem = idem,
      far_apart = apart, state = 'joined', updated_at = now()
  where id = session.id;
  perform private.emit_pirate_parley_event(g, session.id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'parley_id', session.id,
    'state', 'joined', 'far_apart', apart);
end;
$$;

revoke all on function public.open_parley(uuid) from public, anon;
revoke all on function public.join_parley(uuid, text, uuid) from public, anon;
grant execute on function public.open_parley(uuid) to authenticated;
grant execute on function public.join_parley(uuid, text, uuid) to authenticated;

-- ============================================================================
-- pirate parley resolution
-- ============================================================================

create function private.pirate_parley_balance(p_game_id uuid, p_faction_id uuid, p_currency text)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(ledger.delta), 0)::integer from private.pirate_ledger ledger
  where ledger.game_id = p_game_id and ledger.faction_id = p_faction_id
    and ledger.currency = p_currency;
$$;
revoke all on function private.pirate_parley_balance(uuid, uuid, text) from public, anon, authenticated;

create function private.pirate_resolve_transfer(
  p_game_id uuid, p_parley_id uuid, p_winner uuid, p_loser uuid,
  p_currency text, p_amount integer, p_actor uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_amount < 0 or p_amount > private.pirate_parley_balance(p_game_id, p_loser, p_currency) then
    raise exception using errcode = '55000', message = 'Parley transfer would overdraw a crew';
  end if;
  if p_amount > 0 then
    insert into private.pirate_ledger (
      game_id, faction_id, currency, delta, source, ref_id, actor_id
    ) values
      (p_game_id, p_loser, p_currency, -p_amount, 'parley', p_parley_id, p_actor),
      (p_game_id, p_winner, p_currency, p_amount, 'parley', p_parley_id, p_actor);
  end if;
  update private.pirate_parleys
  set state = 'resolved', winner_faction = p_winner, plunder = p_currency, updated_at = now()
  where id = p_parley_id and game_id = p_game_id;
  insert into private.pirate_mercy (game_id, faction_id, until_at, source_parley_id)
  values (p_game_id, p_loser, now() + interval '15 minutes', p_parley_id)
  on conflict (game_id, faction_id) do update
    set until_at = excluded.until_at, source_parley_id = excluded.source_parley_id;
  perform private.emit_pirate_parley_event(p_game_id, p_parley_id);
end;
$$;
revoke all on function private.pirate_resolve_transfer(uuid, uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated;

-- Yield and Fight both wait for independent reports from the exact two
-- players in the session. Choosing Yield alone never moves currency.
create function public.parley_choice(g uuid, parley_id uuid, choice text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  session record;
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or choice is null or choice not in ('yield', 'fight') then
    raise exception using errcode = '22023', message = 'game, Parley and valid choice are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, state, parley.choice as saved_choice into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.target_profile <> caller then
    raise exception using errcode = '42501', message = 'only the target player may choose';
  end if;
  if session.state in ('yielded', 'fighting') and session.saved_choice = choice then
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', session.state);
  end if;
  if session.state <> 'joined' then
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  update private.pirate_parleys
  set choice = parley_choice.choice,
      state = case when parley_choice.choice = 'yield' then 'yielded' else 'fighting' end,
      updated_at = now()
  where id = parley_id;
  perform private.emit_pirate_parley_event(g, parley_id);
  return pg_catalog.jsonb_build_object('status', 'ok',
    'state', case when choice = 'yield' then 'yielded' else 'fighting' end);
end;
$$;

create function public.parley_report(g uuid, parley_id uuid, winner_faction uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  session record;
  target_vote uuid;
  attacker_vote uuid;
  amount integer;
  loser_balance integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or winner_faction is null then
    raise exception using errcode = '22023', message = 'game, Parley and winner are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, attacker_profile, target_faction, attacker_faction,
         target_report, attacker_report, choice, state into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if caller is distinct from session.target_profile
     and caller is distinct from session.attacker_profile then
    raise exception using errcode = '42501', message = 'only the two Parley players may report';
  end if;
  if winner_faction is distinct from session.target_faction
     and winner_faction is distinct from session.attacker_faction then
    raise exception using errcode = '22023', message = 'winner must be one of the two crews';
  end if;
  target_vote := session.target_report;
  attacker_vote := session.attacker_report;
  if caller = session.target_profile then
    if target_vote is not null and target_vote <> winner_faction then
      return pg_catalog.jsonb_build_object('status', 'already_reported');
    end if;
    target_vote := winner_faction;
  else
    if attacker_vote is not null and attacker_vote <> winner_faction then
      return pg_catalog.jsonb_build_object('status', 'already_reported');
    end if;
    attacker_vote := winner_faction;
  end if;
  if session.state not in ('yielded', 'fighting') then
    if target_vote = session.target_report and attacker_vote = session.attacker_report then
      return pg_catalog.jsonb_build_object('status', 'ok', 'state', session.state);
    end if;
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  update private.pirate_parleys
  set target_report = target_vote, attacker_report = attacker_vote, updated_at = now()
  where id = parley_id;
  if target_vote is null or attacker_vote is null then
    perform private.emit_pirate_parley_event(g, parley_id);
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'awaiting_report');
  end if;
  if target_vote <> attacker_vote
     or (session.choice = 'yield' and target_vote <> session.attacker_faction) then
    update private.pirate_parleys set state = 'disputed', updated_at = now() where id = parley_id;
    perform private.pirate_queue_dispute(g, parley_id, 'Players disagreed on the Parley outcome');
    perform private.emit_pirate_parley_event(g, parley_id);
    return pg_catalog.jsonb_build_object('status', 'disputed', 'state', 'disputed');
  end if;
  if session.choice = 'yield' then
    loser_balance := private.pirate_parley_balance(g, session.target_faction, 'doubloon');
    amount := least(loser_balance, greatest(3, pg_catalog.ceil(loser_balance * 0.10)::integer));
    perform private.pirate_resolve_transfer(g, parley_id, session.attacker_faction,
      session.target_faction, 'doubloon', amount, caller);
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved', 'amount', amount);
  end if;
  update private.pirate_parleys
  set state = 'awaiting_choice', winner_faction = target_vote, updated_at = now()
  where id = parley_id;
  perform private.emit_pirate_parley_event(g, parley_id);
  return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'awaiting_choice',
    'winner_faction', target_vote);
end;
$$;

create function public.parley_plunder(g uuid, parley_id uuid, currency text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  phase_name text;
  is_paused boolean;
  pvp_on boolean;
  session record;
  winner_profile uuid;
  loser uuid;
  loser_balance integer;
  amount integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or currency is null or currency not in ('bearing', 'doubloon') then
    raise exception using errcode = '22023', message = 'game, Parley and plunder choice are required';
  end if;
  if not exists (select 1 from public.game_players player
                 where player.game_id = g and player.profile_id = caller and player.role = 'player') then
    raise exception using errcode = '42501', message = 'player membership required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select game.phase, pirate.paused, pirate.pvp_enabled into phase_name, is_paused, pvp_on
  from private.pirate_games pirate join public.games game on game.id = pirate.game_id
  where pirate.game_id = g;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_pirate'); end if;
  if is_paused then return pg_catalog.jsonb_build_object('status', 'paused'); end if;
  if phase_name not in ('cursed', 'hunt', 'hoard') then
    return pg_catalog.jsonb_build_object('status', 'wrong_phase');
  end if;
  if not pvp_on then return pg_catalog.jsonb_build_object('status', 'pvp_disabled'); end if;
  perform private.pirate_sweep_parleys(g);
  select target_profile, attacker_profile, target_faction, attacker_faction,
         winner_faction, choice, state, plunder into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  winner_profile := case when session.winner_faction = session.target_faction
                     then session.target_profile else session.attacker_profile end;
  if session.winner_faction is null or caller <> winner_profile then
    raise exception using errcode = '42501', message = 'only the winning Parley player may choose plunder';
  end if;
  if session.state = 'resolved' and session.plunder = currency then
    return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved');
  end if;
  if session.state <> 'awaiting_choice' or session.choice <> 'fight' then
    return pg_catalog.jsonb_build_object('status', 'wrong_state');
  end if;
  loser := case when session.winner_faction = session.target_faction
                then session.attacker_faction else session.target_faction end;
  loser_balance := private.pirate_parley_balance(g, loser, currency);
  if currency = 'bearing' then
    if loser_balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
    amount := 1;
  else
    amount := least(loser_balance, greatest(5, pg_catalog.ceil(loser_balance * 0.25)::integer));
  end if;
  perform private.pirate_resolve_transfer(g, parley_id, session.winner_faction,
    loser, currency, amount, caller);
  return pg_catalog.jsonb_build_object('status', 'ok', 'state', 'resolved',
    'currency', currency, 'amount', amount);
end;
$$;

revoke all on function public.parley_choice(uuid, uuid, text) from public, anon;
revoke all on function public.parley_report(uuid, uuid, uuid) from public, anon;
revoke all on function public.parley_plunder(uuid, uuid, text) from public, anon;
grant execute on function public.parley_choice(uuid, uuid, text) to authenticated;
grant execute on function public.parley_report(uuid, uuid, uuid) to authenticated;
grant execute on function public.parley_plunder(uuid, uuid, text) to authenticated;

-- ============================================================================
-- pirate parley gm rulings
-- ============================================================================

-- Disagreement stops automated scoring. A GM can rule with an audit reason,
-- or void the Parley and append exact compensating ledger entries.
create function public.gm_resolve_parley(
  g uuid, parley_id uuid, winner_faction uuid, currency text, reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  session record;
  loser uuid;
  balance integer;
  amount integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or winner_faction is null or currency is null
     or currency not in ('bearing', 'doubloon') or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'Parley ruling needs winner, currency and reason';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  perform private.pirate_sweep_parleys(g);
  select target_faction, attacker_faction, choice, state, voided_at into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.voided_at is not null then return pg_catalog.jsonb_build_object('status', 'voided'); end if;
  if session.state <> 'disputed' then return pg_catalog.jsonb_build_object('status', 'wrong_state'); end if;
  if session.choice is null then return pg_catalog.jsonb_build_object('status', 'no_exchange'); end if;
  if winner_faction is distinct from session.target_faction
     and winner_faction is distinct from session.attacker_faction then
    raise exception using errcode = '22023', message = 'winner must be a Parley crew';
  end if;
  if session.choice = 'yield' and (winner_faction <> session.attacker_faction or currency <> 'doubloon') then
    return pg_catalog.jsonb_build_object('status', 'yield_requires_attacker_doubloons');
  end if;
  loser := case when winner_faction = session.target_faction
                then session.attacker_faction else session.target_faction end;
  balance := private.pirate_parley_balance(g, loser, currency);
  if session.choice = 'yield' then
    amount := least(balance, greatest(3, pg_catalog.ceil(balance * 0.10)::integer));
  elsif currency = 'bearing' then
    if balance < 1 then return pg_catalog.jsonb_build_object('status', 'no_shards'); end if;
    amount := 1;
  else
    amount := least(balance, greatest(5, pg_catalog.ceil(balance * 0.25)::integer));
  end if;
  update private.pirate_parleys
  set resolved_by = caller, resolution_reason = clean_reason, updated_at = now()
  where id = parley_id;
  perform private.pirate_resolve_transfer(g, parley_id, winner_faction, loser, currency, amount, caller);
  update public.game_events
  set status = 'confirmed', resolved_at = now(), resolved_by = caller
  where game_id = g and type = 'pirate_dispute' and status = 'pending'
    and payload->>'parley_id' = parley_id::text;
  perform private.emit_pirate_crew_event(g, session.target_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'resolve_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty ruled on a Parley.'));
  perform private.emit_pirate_crew_event(g, session.attacker_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'resolve_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty ruled on a Parley.'));
  return pg_catalog.jsonb_build_object('status', 'ok', 'amount', amount, 'currency', currency);
end;
$$;

create function public.gm_void_parley(g uuid, parley_id uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  clean_reason text := pg_catalog.btrim(reason);
  session record;
  deficit integer;
  reversal_count integer;
begin
  if caller is null then raise exception using errcode = '28000', message = 'not authenticated'; end if;
  if g is null or parley_id is null or clean_reason is null
     or pg_catalog.char_length(clean_reason) not between 3 and 300 then
    raise exception using errcode = '22023', message = 'Parley and correction reason are required';
  end if;
  if not private.is_game_gm(g, caller) then
    raise exception using errcode = '42501', message = 'GM access required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pirate:' || g::text, 0));
  select target_faction, attacker_faction, voided_at into session
  from private.pirate_parleys parley where parley.game_id = g and parley.id = parley_id;
  if not found then return pg_catalog.jsonb_build_object('status', 'not_found'); end if;
  if session.voided_at is not null then return pg_catalog.jsonb_build_object('status', 'already_voided'); end if;
  select count(*)::integer into deficit from private.pirate_ledger ledger
  where ledger.game_id = g and ledger.ref_id = parley_id and ledger.source = 'parley'
    and ledger.delta > 0
    and private.pirate_parley_balance(g, ledger.faction_id, ledger.currency) < ledger.delta;
  if deficit > 0 then return pg_catalog.jsonb_build_object('status', 'insufficient_balance'); end if;
  insert into private.pirate_ledger (
    game_id, faction_id, currency, delta, source, ref_id, reason, actor_id
  ) select g, ledger.faction_id, ledger.currency, -ledger.delta,
           'gm', parley_id, clean_reason, caller
    from private.pirate_ledger ledger
    where ledger.game_id = g and ledger.ref_id = parley_id and ledger.source = 'parley';
  get diagnostics reversal_count = row_count;
  update private.pirate_parleys
  set state = 'voided', voided_at = now(), voided_by = caller,
      void_reason = clean_reason, updated_at = now()
  where id = parley_id;
  delete from private.pirate_mercy mercy
  where mercy.game_id = g and mercy.source_parley_id = parley_id;
  update public.game_events
  set status = 'dismissed', resolved_at = now(), resolved_by = caller
  where game_id = g and type = 'pirate_dispute' and status = 'pending'
    and payload->>'parley_id' = parley_id::text;
  perform private.emit_pirate_parley_event(g, parley_id);
  perform private.emit_pirate_crew_event(g, session.target_faction, 'pirate_ruling',
    pg_catalog.jsonb_build_object('action', 'void_parley', 'reason', clean_reason,
      'parley_id', parley_id, 'message', 'The Admiralty voided a Parley.'));
  if session.attacker_faction is not null then
    perform private.emit_pirate_crew_event(g, session.attacker_faction, 'pirate_ruling',
      pg_catalog.jsonb_build_object('action', 'void_parley', 'reason', clean_reason,
        'parley_id', parley_id, 'message', 'The Admiralty voided a Parley.'));
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reversal_rows', reversal_count);
end;
$$;

revoke all on function public.gm_resolve_parley(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.gm_void_parley(uuid, uuid, text) from public, anon;
grant execute on function public.gm_resolve_parley(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.gm_void_parley(uuid, uuid, text) to authenticated;
