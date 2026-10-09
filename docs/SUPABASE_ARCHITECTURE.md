# Supabase Architecture

Updated 2026-10-09 against the ordered repository migrations. Hosted migration history is recorded in [Pirate implementation status](pirate-game/IMPLEMENTATION_STATUS.md); source code and a live deployment are separate evidence.

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
| `pirate_games` | Pirate mode, pause/PvP, secret treasure/HMAC state and frozen value |
| `pirate_sites` / `pirate_attempts` | Private site answers/oath words and crew-wide wrong-answer lockout |
| `pirate_claims` / `pirate_ledger` | Crew claims and append-only bearing/doubloon accounting |
| `pirate_readings` / `pirate_captains` | Deterministic compass records and captain ownership |
| `pirate_parleys` / `pirate_mercy` | Two-player encounters, reports, transfers and loser immunity |
| `pirate_treasure_awards` | Audited one-active-award hoard history |

`zones_view` and `player_positions_view` are security-invoker views. Realtime
publishes only `characters`, `game_events`, `game_players`,
`player_positions`, and `zones`.

## Security Boundaries

Every app table has RLS enabled. Anonymous users have no app table or RPC
grants. Authenticated users receive explicit table privileges, then RLS limits
rows to their game, role, identity, and configured location visibility.
Profiles are visible only to the user themselves and to members of a shared
game. The `games.join_code` column is excluded from the member SELECT grant
(clients must name columns; `select *` on `games` fails) and is served to GMs
through `gm_get_join_code`.

Core membership/Time Hunt RPCs include:

- `join_game(code)`: validates/rate-limits the join code and creates membership.
- `gm_get_join_code(g)`: returns the game's join code to its GMs only.
- `set_location_consent(g, grant_consent)`: records consent and revocation;
  revocation also deletes the latest stored position.
- `ingest_pings(g, pings)`: accepts up to 500 points/256 KiB while the game
  is draft or active, skips and counts invalid points instead of rejecting the
  batch, deduplicates retries, updates the latest position, evaluates recent
  points (newest 50 within 10 minutes) against zones, and returns
  `{accepted, rejected, profile: {mode}}` or `{accepted: 0, rejected, reason}`.
  Events reach phones through `get_player_event_delivery`; the legacy
  `last_seen_seq` argument is still accepted and ignored so installed builds
  keep resolving the call.
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

Core and Pirate RPCs intentionally use `SECURITY DEFINER` with `search_path = ''` where they cross RLS/private-table boundaries. They require explicit authentication/authorization, input validation, schema qualification and restricted grants. Check advisor findings against actual callable functions rather than relying on a historical warning count.

## Pirate mode

A row in `private.pirate_games` identifies the mode; `public.games.phase` stores its phase.
Pirate setup and Hunt start reject incompatible mode state. The ten private Pirate tables deny direct client access;
players use scoped RPCs and GMs use privileged overview/setup/correction calls. No Pirate table is added to Realtime.
Treasure coordinates are GM-only; answer hashes and the HMAC secret are never returned to clients.

Player API and mechanics are described once in [GAME_GUIDE.md](pirate-game/GAME_GUIDE.md).
GM setup uses `pirate_enable`, `pirate_set_site`, `pirate_clear_site`, `pirate_set_treasure`, `pirate_validate`,
`pirate_set_captain`, `pirate_set_phase`, `pirate_set_paused`, `pirate_set_pvp` and `gm_pirate_overview`.
Correction RPCs are `gm_adjust`, `gm_void_claim`, `gm_award_treasure`, `gm_void_treasure`, `gm_resolve_parley` and `gm_void_parley`.
The GM overview returns site prompts and claim ranks, never answers or oath words.

Mutations serialize with the game's `pirate:` advisory transaction lock. In the corrective review migration,
`get_pirate_state` and `gm_pirate_overview` are volatile: they also take that lock and sweep expired Parleys before returning state.
This makes polling release stale codes and surface disputes; it creates no timer/background job. Public RPC signatures/grants remain unchanged.
`private.pirate_parley_pair_presence` shares the fresh-location, exclusion and <=75 m checks at each new participant decision.
Existing committed retries return their saved outcome without a second transfer.

Ledger entries are append-only; claim/Parley/treasure voids compensate them and reject overdraws.
The first `hoard` transition freezes `round(0.40 * highest crew doubloon balance)` once; re-entry and re-awards retain it.
`pirate_games.settings` is reserved storage, not an implemented tunable-settings API.

## Time Hunt

Starting a hunt creates a randomized circular target chain from player-role
members with non-NPC characters. GMs are observers. The active roster is locked
and location visibility is forced to GM-only until reset or completion.

Players receive only their target's character name and a coarse proximity band;
no target profile ID or hunter identity crosses the API boundary. A GM may set
`games.direction_enabled` (default off; column-level select for members,
update through the existing GM-only policy). While it is on, `get_hunt_status`
adds a true-north `bearing_deg` (PostGIS geography azimuth, whole degrees in
`[0, 360)`, `null` for coincident fixes), `direction_state`
(`available` / `unavailable` / `not_enabled`), `computed_at` and a two-minute
`valid_until`, and replaces the 10 m rounded `distance_m` with the band edge
(`distance_is_band_edge = true`) so no client can combine bearing and metres
into coordinates. All of this lives inside the existing fresh, uncloaked
"available" branch: stale, cloaked, waiting, non-participant, eliminated and
finished responses never carry a bearing (`006_hunt_direction.sql`). A confirmed
elimination atomically removes the victim, revokes their location sharing, and
cloaks the hunter for ten minutes. The inherited target remains private and
unassigned until the GM explicitly releases it or replaces the complete chain.
One per-game advisory lock (`private.lock_game`) serializes claims, GM hunt
edits, consent changes and ping ingestion. The final survivor is
recorded as winner and the game is marked finished.

One zone per game may use `zone_type = 'play_area'`. The boundary is evaluated
only while a hunt round is active. Background ping evaluation uses PostGIS
distance-to-edge checks to emit a one-shot warning in the configured band.
Leaving requires having actually been inside and crossing `exit_buffer_m`
beyond the edge (hysteresis against GPS glitches); it then rejects the
player's pending elimination claim and creates a pending GM breach event. It
does not auto-eliminate from GPS alone, and a player whose fixes never entered
the area is not flagged.

Living participants cannot rename or delete their character while a round is
active; the hunt UI identifies targets by character name, so those are locked
alongside the roster. GMs remain able to edit characters at any time.

## PostGIS Fix

PostGIS is installed in `extensions`, not `public`. Consequently:

- `spatial_ref_sys` is `extensions.spatial_ref_sys` and is not exposed by the
  Data API.
- Geometry/geography types and functions are explicitly qualified.
- The old ineffective `spatial_ref_sys` write trigger is unnecessary.
- No event trigger is needed to repair RLS after the fact. Migrations enable
  RLS and create policies in the same change that creates each table.

## Retention And Free Tier

Four daily `pg_cron` jobs keep operational data bounded:

- Raw pings use each game's `purge_after_days` setting, 1-90 days.
- Latest positions are removed when a game is finished.
- Join attempts are removed after two days.
- Events of finished games are removed 14 days after creation.

Deleting an auth user now works even with hunt history: attribution columns
(`characters.user_id`, `hunt_rounds.started_by`/`winner_id`,
`hunt_players.eliminated_by`, `hunt_claims.response_by`) are set to null and
the user's hunt claims are removed. Deleting a GM account still requires
deleting or handing off their games first, and an account that is actively
targeted mid-round cannot be deleted until the round ends.

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
production dashboard is <https://larp-passport.vercel.app>. Client environment configuration must target the reviewed project; verify it for each deployment/APK. A repository push does not apply database migrations.

The maintained pgTAP suite lives in `supabase/tests/database`; it covers architecture/RLS, Hunt privacy/recovery, tracking/delivery and Pirate gameplay. Tests run transactionally and roll back fixtures. `supabase/tests/concurrency.py` and `pirate_concurrency.py` use real concurrent connections to the disposable local database and clean up their fixtures. Current counts and verification limits live in [IMPLEMENTATION_STATUS.md](pirate-game/IMPLEMENTATION_STATUS.md).

### Hosted Auth URL

Auth URL configuration is outside the migrations. Before a release, verify the hosted **Authentication > URL Configuration** Site URL and allowed redirect URLs against `https://larp-passport.vercel.app` (and intentional previews). This review did not inspect hosted Auth settings, so an old setup instruction is not evidence that the setting is still wrong. Local Auth settings in `supabase/config.toml` are separate.

## Local And Device Testing

Use hosted Supabase while developing the native app. This means the phone does
not need access to a backend running on the laptop.

```powershell
cd larp-passport\mobile
npm ci
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
npm ci
npm run dev -- --host
```

If a temporary public dashboard URL is needed, prefer a Vercel preview deploy.
It is closer to production and does not expose a laptop port directly.

## Deployment And Rollback

1. Apply versioned Supabase migrations before deploying clients that depend on
   new RPCs or columns.
2. Run the full gate in [RELEASE.md](RELEASE.md), including all database suites, both concurrency scripts, dashboard tests/build and both Android exports.
3. Push the tested revision to GitHub and deploy that exact revision to Vercel.
4. Build the mobile preview/production binary with the corresponding Expo
   environment variables.
5. For a dashboard-only regression, use Vercel rollback. For a database change,
   create a forward corrective migration rather than editing or deleting an
   applied migration.

See [`TIME_HUNT_GAMEPLAY.md`](TIME_HUNT_GAMEPLAY.md) for the first-game runbook,
field checklist, and hunt-specific recovery procedures.
