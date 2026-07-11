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
enforced in Postgres through RLS and narrow RPC boundaries.

## Schema

Client-facing `public` tables:

| Table | Purpose |
| --- | --- |
| `profiles` | App profile linked 1:1 to `auth.users` |
| `games` | Game settings, template, state, and join code |
| `game_players` | Membership, role, and location consent |
| `factions` | Per-game factions |
| `characters` | Player characters and GM-created NPCs |
| `zones` | PostGIS event zones and the per-game time-anomaly play area |
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
| `hunt_rounds` | Server-owned lifecycle and winner for each time hunt |
| `hunt_players` | Secret target chain, eliminations, and cloak expiry |
| `hunt_claims` | Victim-confirmed elimination workflow |

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
- `get_hunt_status(g)`: returns only the caller's safe hunt state, target
  character, coarse proximity, and anonymous incoming claim.
- `get_hunt_admin(g)`: returns the complete chain and claim history to the GM.
- `start_hunt(g)` / `reset_hunt(g)`: manage the GM-controlled round lifecycle.
- `request_elimination(g)` / `respond_elimination(claim_id, confirm_elimination)`:
  run the two-device confirmation and target inheritance transaction.
- `gm_resolve_elimination(claim_id, confirm_elimination)`: lets a GM accept or
  reject a pending claim without impersonating the target.
- `gm_eliminate_player(g, victim_id)` / `gm_restore_player(g, profile_id)`:
  apply adjudicated elimination or restoration while repairing the ring.
- `gm_set_hunt_chain(g, player_ids)`: atomically replaces the complete ordered
  chain of living players and rejects stale claims.
- `gm_assign_next_target(g, hunter_id)`: releases the inherited target after a
  confirmed non-final kill.
- `send_gm_message(g, message)`: records a rate-limited player message of at
  most 100 characters in the GM event stream.

These RPCs intentionally use `SECURITY DEFINER` with `search_path = ''` because
they cross RLS/private-table boundaries. Supabase's security advisor therefore
reports fifteen expected warnings. Removing definer execution would break these
API contracts; any new definer RPC needs the same explicit authentication,
validation, schema qualification, revocation, and test coverage.

## Time Hunt

Starting a hunt creates a randomized circular target chain from player-role
members with non-NPC characters. GMs are observers. The active roster is locked
and location visibility is forced to GM-only until reset or completion.

Players receive only their target's character name and a coarse proximity band;
no target profile ID or hunter identity crosses the API boundary. A confirmed
elimination atomically removes the victim, revokes their location sharing, and
cloaks the hunter for ten minutes. The inherited target remains private and
unassigned until the GM explicitly releases it or replaces the complete chain.
Per-game advisory locks serialize simultaneous claims. The final survivor is
recorded as winner and the game is marked finished.

One zone per game may use `zone_type = 'play_area'`. Background ping evaluation
uses PostGIS distance-to-edge checks to emit a one-shot warning in the configured
band. Crossing the boundary rejects the player's pending elimination claim and
creates a pending GM breach event; it does not auto-eliminate from GPS alone.

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

The hosted production project is `Passport` (`ufcnxkowpkwayczbfnzy`). The
production dashboard is <https://larp-passport.vercel.app>. Database migrations
and both clients are currently aligned to this project.

Current hosted test coverage is transactional and leaves no fixtures behind.
It verifies schema/RLS/grants, Auth profile creation, GM membership, join flow,
zone privacy, consent, character text limits, idempotent pings, PostGIS zone
state, and event emission.
The time-hunt suite adds 62 checks covering secret assignments, roster locks,
messages, anonymous confirmation, elimination, GM target assignment, cloak,
location revocation, final-winner completion, and GM recovery. A separate
10-check PostGIS suite covers safe interior positions, edge warnings, exits,
claim forfeiture, duplicate suppression, and warning rearming.

### Hosted Auth URL

The fresh project requires one platform setting that is not database-managed.
In Supabase Dashboard, open **Authentication > URL Configuration**, set **Site
URL** to `https://larp-passport.vercel.app`, and add that same URL to **Redirect
URLs**. Email confirmation is enabled, so this prevents successful confirmation
links from ending on the default `http://localhost:3000` page. Until this is
changed, confirmation still verifies the user, who can return to the app and
sign in manually.

## Local And Device Testing

Use hosted Supabase while developing the native app. This means the phone does
not need access to a backend running on the laptop.

```powershell
cd larp-passport\mobile
npm install
npm run android
```

Use `npm run android` with Android Studio/emulator or a USB-connected device for
full location testing. Expo Go on Android does not support the foreground and
background services required here. `npx expo start --tunnel` is useful only
with a compatible development client or for a limited UI/authentication smoke
test; it does not validate background sharing.

The EAS `development`, `preview`, and `production` environments are configured
with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`EXPO_PUBLIC_SENTRY_DSN`. Local Expo uses the ignored `.env.local` file.

Run the dashboard locally with:

```powershell
cd larp-dashboard
npm install
npm run dev -- --host
```

If a temporary public dashboard URL is needed, prefer a Vercel preview deploy.
It is closer to production and does not expose a laptop port directly.

## Deployment And Rollback

1. Apply versioned Supabase migrations before deploying clients that depend on
   new RPCs or columns.
2. Run both pgTAP suites, dashboard tests/build, and an Android Expo export.
3. Push the tested revision to GitHub and deploy that exact revision to Vercel.
4. Build the mobile preview/production binary with the corresponding Expo
   environment variables.
5. For a dashboard-only regression, use Vercel rollback. For a database change,
   create a forward corrective migration rather than editing or deleting an
   applied migration.

See [`TIME_HUNT_GAMEPLAY.md`](TIME_HUNT_GAMEPLAY.md) for the first-game runbook,
field checklist, and hunt-specific recovery procedures.
