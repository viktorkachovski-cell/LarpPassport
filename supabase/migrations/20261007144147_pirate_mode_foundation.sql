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
