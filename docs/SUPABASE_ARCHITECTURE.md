# Supabase Architecture

## Overview

The rebuilt stack keeps application logic close to the data while retaining
the existing dashboard and mobile contracts:

```text
Vercel dashboard ----\
                      > Supabase Auth + Data API + Realtime
Expo mobile app -----/                 |
                                       +-- public: client-facing state
                                       +-- private: telemetry and workflow state
                                       +-- extensions: PostGIS and spatial_ref_sys
```

There is no separate Node backend to host. The dashboard is a static Vite app,
and both clients use Supabase with the signed-in user's JWT. Authorization is
enforced in Postgres through RLS and three narrow RPC boundaries.

## Schema

Client-facing `public` tables:

| Table | Purpose |
| --- | --- |
| `profiles` | App profile linked 1:1 to `auth.users` |
| `games` | Game settings, template, state, and join code |
| `game_players` | Membership, role, and location consent |
| `factions` | Per-game factions |
| `characters` | Player characters and GM-created NPCs |
| `zones` | PostGIS trigger geometry and behavior |
| `player_positions` | Latest position per player and game |
| `game_events` | Ordered player/GM event stream |
| `push_tokens` | User-owned device notification tokens |
| `character_changes` | Character audit history |

Internal `private` tables:

| Table | Purpose |
| --- | --- |
| `location_pings` | Deduplicated raw location trail with retention |
| `zone_state` | Per-player entry, dwell, exit, and one-shot state |
| `join_attempts` | Join-code rate-limit history |

`zones_view` and `player_positions_view` are security-invoker views. Realtime
publishes only `characters`, `game_events`, `game_players`,
`player_positions`, and `zones`.

## Security Boundaries

Every app table has RLS enabled. Anonymous users have no app table or RPC
grants. Authenticated users receive explicit table privileges, then RLS limits
rows to their game, role, identity, and configured location visibility.

The callable RPCs are:

- `join_game(code)`: validates/rate-limits the join code and creates membership.
- `set_location_consent(g, grant_consent)`: records consent and revocation.
- `ingest_pings(g, pings, last_seen_seq)`: validates up to 500 points/256 KiB,
  deduplicates retries, updates the latest position, evaluates zones, and
  piggybacks visible events.

These RPCs intentionally use `SECURITY DEFINER` with `search_path = ''` because
they cross RLS/private-table boundaries. Supabase's security advisor therefore
reports three expected warnings. Removing definer execution would break these
API contracts; any new definer RPC needs the same explicit authentication,
validation, schema qualification, revocation, and test coverage.

## PostGIS Fix

PostGIS is installed in `extensions`, not `public`. Consequently:

- `spatial_ref_sys` is `extensions.spatial_ref_sys` and is not exposed by the
  Data API.
- Geometry/geography types and functions are explicitly qualified.
- The old ineffective `spatial_ref_sys` write trigger is unnecessary.
- No event trigger is needed to repair RLS after the fact. Migrations enable
  RLS and create policies in the same change that creates each table.

## Retention And Free Tier

Three daily `pg_cron` jobs keep operational data bounded:

- Raw pings use each game's `purge_after_days` setting, 1-90 days.
- Latest positions are removed when a game is finished.
- Join attempts are removed after two days.

For a hobby deployment below 100 users, Supabase Free plus Vercel Hobby is the
simplest architecture. Avoid a VPS for now: it adds patching, backups, TLS,
monitoring, and database operations without adding useful capability here.

## Database Workflow

Migrations in `supabase/migrations` are the schema source of truth. Create new
migrations with the CLI rather than editing an applied migration:

```powershell
npx supabase migration new descriptive_name
npx supabase db reset
npx supabase test db supabase/tests/database
```

The hosted `Passport` rebuild is project `ufcnxkowpkwayczbfnzy`. The previous
`larp-passport` project remains a rollback target until both clients pass the
cutover smoke test.

Current hosted test coverage is transactional and leaves no fixtures behind.
It verifies schema/RLS/grants, Auth profile creation, GM membership, join flow,
zone privacy, consent, character text limits, idempotent pings, PostGIS zone
state, and event emission.

## Local And Device Testing

Use hosted Supabase while developing the native app. This means the phone does
not need access to a backend running on the laptop.

```powershell
cd larp-passport\mobile
npm install
npx expo start --tunnel
```

`--tunnel` is the easiest option when the phone and laptop are on different or
restricted networks. On a trusted same-Wi-Fi network, regular `npx expo start`
is faster. For a native development build, use `npm run android` with Android
Studio/emulator or a USB-connected device.

Run the dashboard locally with:

```powershell
cd larp-dashboard
npm install
npm run dev -- --host
```

If a temporary public dashboard URL is needed, prefer a Vercel preview deploy.
It is closer to production and does not expose a laptop port directly.

## Cutover And Rollback

1. Configure Vercel Preview and a mobile `.env.local` with the new Supabase URL
   and publishable key.
2. Register two test users and verify GM create/edit, player join, character
   update, consent, map position, zone event, and realtime refresh.
3. Set the same Vercel variables for Production and redeploy the verified
   artifact. Build a mobile test binary with the new Expo variables.
4. Keep the old Supabase project untouched until the smoke test is complete.
5. Roll back by restoring the old client URL/key and redeploying; no data merge
   is required because the project never went live.
