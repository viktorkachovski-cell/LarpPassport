-- Clean baseline for a new Supabase project.
-- PostGIS is intentionally installed outside the exposed public schema.
create schema if not exists extensions;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create extension if not exists postgis with schema extensions;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique
    check (char_length(trim(username)) between 3 and 32),
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  gm_id uuid not null references public.profiles(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  template jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(template) = 'object'
      and (not (template ? 'stats') or jsonb_typeof(template->'stats') = 'array')
    ),
  location_visibility text not null default 'gm_only'
    check (location_visibility in ('gm_only', 'faction', 'all')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'finished')),
  purge_after_days integer not null default 7
    check (purge_after_days between 1 and 90),
  join_code text not null
    default upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8))
    check (join_code ~ '^[0-9A-F]{8}$'),
  created_at timestamptz not null default now(),
  unique (join_code)
);

create table public.game_players (
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'player' check (role in ('gm', 'player')),
  joined_at timestamptz not null default now(),
  location_consent_at timestamptz,
  consent_revoked_at timestamptz,
  sharing_enabled boolean not null default false,
  primary key (game_id, profile_id),
  check (
    not sharing_enabled
    or (
      location_consent_at is not null
      and (consent_revoked_at is null or consent_revoked_at < location_consent_at)
    )
  )
);

create table public.factions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null default '#888888'
    check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (game_id, name)
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  name text not null check (char_length(trim(name)) between 1 and 120),
  bio text check (bio is null or char_length(bio) <= 4000),
  fields jsonb not null default '{}'::jsonb check (jsonb_typeof(fields) = 'object'),
  faction_id uuid references public.factions(id) on delete set null,
  is_npc boolean not null default false,
  created_at timestamptz not null default now()
);

-- Players get one character per game; GMs may create any number of NPCs.
create unique index characters_one_player_per_game_idx
  on public.characters (game_id, user_id)
  where not is_npc;

create table public.zones (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  shape text not null default 'circle' check (shape in ('circle', 'polygon')),
  geog extensions.geography(Geometry, 4326) not null,
  radius_m double precision,
  trigger_mode text not null default 'gm_confirm'
    check (trigger_mode in ('auto', 'gm_confirm', 'silent')),
  dwell_seconds integer not null default 0 check (dwell_seconds between 0 and 86400),
  exit_buffer_m double precision not null default 15
    check (exit_buffer_m between 0 and 10000),
  one_shot boolean not null default false,
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  unique (game_id, name),
  check (shape <> 'circle' or (radius_m is not null and radius_m > 0)),
  check (radius_m is null or radius_m <= 100000)
);

create table public.player_positions (
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  geog extensions.geography(Point, 4326) not null,
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 10000),
  battery_pct real check (battery_pct is null or battery_pct between 0 and 100),
  recorded_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (game_id, profile_id)
);

create table public.game_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity unique,
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  zone_id uuid references public.zones(id) on delete set null,
  type text not null check (char_length(type) between 1 and 64),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'dismissed')),
  player_visible boolean not null default false,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create table public.push_tokens (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token text not null check (char_length(token) between 10 and 4096),
  platform text not null default 'android' check (platform in ('android', 'ios')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, token)
);

create table public.character_changes (
  id bigint generated always as identity primary key,
  character_id uuid not null references public.characters(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  changed_by uuid references public.profiles(id) on delete set null,
  old_fields jsonb,
  new_fields jsonb,
  old_name text,
  new_name text,
  changed_at timestamptz not null default now()
);

-- Internal state is not part of the Data API.
create table private.zone_state (
  zone_id uuid not null references public.zones(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  inside boolean not null default false,
  inside_since timestamptz,
  fired_at timestamptz,
  trigger_count integer not null default 0 check (trigger_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (zone_id, profile_id)
);

create table private.location_pings (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.games(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  geog extensions.geography(Point, 4326) not null,
  accuracy_m real check (accuracy_m is null or accuracy_m between 0 and 10000),
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (game_id, profile_id, recorded_at)
);

create table private.join_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code text not null check (char_length(code) <= 16),
  success boolean not null,
  attempted_at timestamptz not null default now()
);

-- Foreign-key and query-path indexes.
create index games_gm_id_idx on public.games (gm_id);
create index game_players_profile_id_idx on public.game_players (profile_id);
create index characters_user_id_idx on public.characters (user_id);
create index characters_faction_id_idx on public.characters (faction_id)
  where faction_id is not null;
create index zones_game_active_idx on public.zones (game_id) where active;
create index zones_geog_idx on public.zones using gist (geog);
create index player_positions_profile_id_idx on public.player_positions (profile_id);
create index game_events_game_seq_idx on public.game_events (game_id, seq desc);
create index game_events_profile_visible_idx
  on public.game_events (profile_id, seq desc) where player_visible;
create index game_events_character_id_idx on public.game_events (character_id)
  where character_id is not null;
create index game_events_zone_id_idx on public.game_events (zone_id)
  where zone_id is not null;
create index game_events_resolved_by_idx on public.game_events (resolved_by)
  where resolved_by is not null;
create index character_changes_character_time_idx
  on public.character_changes (character_id, changed_at desc);
create index character_changes_game_id_idx on public.character_changes (game_id);
create index character_changes_changed_by_idx on public.character_changes (changed_by)
  where changed_by is not null;
create index private_zone_state_profile_id_idx on private.zone_state (profile_id);
create index private_pings_game_time_idx
  on private.location_pings (game_id, recorded_at desc);
create index private_pings_profile_time_idx
  on private.location_pings (profile_id, recorded_at desc);
create index private_join_attempts_failures_idx
  on private.join_attempts (profile_id, attempted_at desc)
  where not success;

-- RLS is mandatory for exposed tables and defense-in-depth for private state.
alter table public.profiles enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.factions enable row level security;
alter table public.characters enable row level security;
alter table public.zones enable row level security;
alter table public.player_positions enable row level security;
alter table public.game_events enable row level security;
alter table public.push_tokens enable row level security;
alter table public.character_changes enable row level security;
alter table private.zone_state enable row level security;
alter table private.location_pings enable row level security;
alter table private.join_attempts enable row level security;

comment on schema private is
  'Internal LARP Passport state and privileged helpers; not exposed through the Data API.';
comment on table private.location_pings is
  'Raw location trail, written only through public.ingest_pings and automatically purged.';
