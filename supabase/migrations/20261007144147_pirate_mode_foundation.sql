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
    elsif tg_op = 'UPDATE' and new.phase is distinct from old.phase then
      raise exception using errcode = '42501', message = 'Pirate phase must be changed through a GM action';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.protect_pirate_phase() from public, anon, authenticated;
create trigger protect_pirate_phase
  before insert or update of phase on public.games
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

alter table private.pirate_games enable row level security;
create policy pirate_games_deny_clients on private.pirate_games
  for all to anon, authenticated using (false) with check (false);
revoke all on private.pirate_games from public, anon, authenticated;

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
