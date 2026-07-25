# Supabase Architecture

Hosted project: **`ufcnxkowpkwayczbfnzy`** ("Passport", eu-west-1),
PostgreSQL **17.6**. The previous `larp-passport` project
(`ondotybaijthxsodstts`) remains a rollback target until both clients pass the
cutover smoke test.

*Last verified against the live database: 2026-07-25.*

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
enforced in Postgres through RLS and the RPC boundary.

## Core Invariant: Games Are Self-Contained

**No query spans games.** Every read and write is scoped to a single
`game_id`. A player's position, zone state, hunt state, and event history in one
game carry no meaning in another, and are never joined or aggregated across
games.

This is load-bearing for the indexing strategy below: every hot-path index leads
with `game_id`. Introducing a cross-game feature (a career profile, a
multi-game leaderboard, "all my events everywhere") would invalidate those
indexes and require a deliberate revisit — it is not a drop-in addition.

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
| `hunt_rounds` | One row per game: hunt phase, winner, timing |
| `hunt_players` | Per-player hunt state, target chain, elimination |
| `hunt_claims` | Elimination claims awaiting victim or GM response |

`zones_view` and `player_positions_view` are security-invoker views. Realtime
publishes only `characters`, `game_events`, `game_players`,
`player_positions`, and `zones`. The `private` telemetry and hunt tables are
deliberately **not** published — hunt state reaches clients only through
`get_hunt_status` / `get_hunt_admin`, which redact according to the caller's
role and the target's cloak timer.

## Security Boundaries

Every app table has RLS enabled. Anonymous users have no app table or RPC
grants. Authenticated users receive explicit table privileges, then RLS limits
rows to their game, role, identity, and configured location visibility.

RLS predicates wrap `auth.uid()` as `(select auth.uid())` so Postgres hoists it
into an InitPlan and evaluates it once per query rather than once per row. The
helper functions `private.is_game_gm`, `is_game_member`, `same_faction`, and
`shares_game_with` are `STABLE` with an inflated `COST 100`, which pushes them
after cheap column filters in the planner's evaluation order. **Preserve both
properties** when editing policies; losing either quietly reintroduces per-row
subquery execution.

### RPC Surface

All of the following are `SECURITY DEFINER` with `search_path = ''`, executable
by `authenticated`:

**Core gameplay**
- `join_game(code)` — validates/rate-limits the join code, creates membership.
- `set_location_consent(g, grant_consent)` — records consent and revocation.
- `ingest_pings(g, pings, last_seen_seq)` — validates up to 500 points/256 KiB,
  deduplicates retries, updates the latest position, evaluates zones, and
  piggybacks visible events. **This is the hot path; keep it idempotent.**
- `send_gm_message(g, message)`, `gm_get_join_code(g)`

**Hunt subsystem**
- Read: `get_hunt_status(g)`, `get_hunt_admin(g)`
- Player: `request_elimination(g)`, `respond_elimination(claim_id, confirm)`
- GM: `start_hunt(g)`, `reset_hunt(g)`, `gm_set_hunt_chain(g, player_ids)`,
  `gm_assign_next_target(g, hunter_id)`, `gm_eliminate_player(g, victim_id)`,
  `gm_restore_player(g, profile_id)`,
  `gm_resolve_elimination(claim_id, confirm)`

These intentionally use definer rights because they cross RLS/private-table
boundaries. Removing definer execution would break the API contract. Any **new**
definer RPC must replicate the full pattern: explicit authentication check,
input validation, fully schema-qualified references, explicit `revoke`/`grant`
of execute, and database test coverage.

### Security Advisor Baseline

The expected advisor output is **17 warnings**:

- **16 ×** `authenticated_security_definer_function_executable` — one per RPC
  above. Intentional and expected.
- **1 ×** `auth_leaked_password_protection` — currently disabled. This is a
  genuine open item, not an accepted tradeoff; it is a dashboard toggle
  (Authentication → Password strength) and is worth enabling, especially since
  email confirmation is off.

Treat **any deviation from this set** as the signal — a new warning name, or a
definer function that is not in the list above. A raw count alone is no longer
a useful tripwire now that the RPC surface grows with gameplay features.

*(The previous "3 expected warnings" baseline predates the hunt subsystem and
is obsolete.)*

## PostGIS

PostGIS is installed in `extensions`, not `public`. Consequently:

- `spatial_ref_sys` is `extensions.spatial_ref_sys` and is not exposed by the
  Data API.
- Geometry/geography types and functions are explicitly qualified.
- The old ineffective `spatial_ref_sys` write trigger is unnecessary.
- No event trigger is needed to repair RLS after the fact. Migrations enable
  RLS and create policies in the same change that creates each table.

### Known: `zones_geog_idx` is not used by any current query

The GiST index on `zones.geog` is never chosen by the planner. Both spatial
access paths reach zones by `game_id` first:

- `evaluate_zones` loops over `zones where game_id = ... and active` and tests
  each zone individually — no spatial search is issued.
- The `near_zone` profile check in `ingest_pings` calls
  `st_dwithin(pos, z.geog, 250 + coalesce(z.radius_m, 0))`. The distance
  argument depends on the candidate row, so PostGIS cannot rewrite it into the
  index-backed bounding-box form and the planner falls back to evaluating every
  candidate. Measured on 20k zones: cost 42,002 / 82.7 ms, versus 42 / 0.24 ms
  for the same query with a constant distance.

This is harmless at current scale because `zones_game_active_idx (game_id)
WHERE active` narrows to a handful of rows before the distance test runs. The
index is retained as a cheap hedge: `zones` is small and rarely written, so it
costs almost nothing, and it becomes load-bearing the moment any genuinely
spatial query is added (nearest-zone lookup, cross-game zone search, map
viewport queries). **Do not treat the "unused index" advisor notice on
`zones_geog_idx` as actionable** without first confirming no such query exists.

## Indexing Strategy

Indexes lead with `game_id` because of the game-isolation invariant above.
Partial indexes are used aggressively: they stay small, and they keep hot,
short-lived working sets (pending events, open claims) separate from cold
history.

### Location tables are not the bottleneck

Contrary to intuition, the location tables need no special tuning:

- **`location_pings`** is effectively write-only. Nothing reads it except the
  purge job, which is served by `(game_id, recorded_at DESC)` through a
  parameterized nested loop over the tiny `games` table. Volume is roughly
  **10 MB per 20-player 8-hour game-day** including indexes — negligible against
  the free tier with a 7-day default `purge_after_days`.
- **`player_positions`** holds exactly one row per player per game (~20 rows
  during play). The primary key `(game_id, profile_id)` covers every access.

The real hot paths are `game_events` and the statement volume inside
`evaluate_zones`.

### Hot-path indexes and their rationale

| Index | Serves | Why this shape |
| --- | --- | --- |
| `game_events_game_profile_seq_idx (game_id, profile_id, seq) WHERE player_visible` | The event tail piggybacked on **every** `ingest_pings` call from every player | Leading `game_id` prevents walking a player's history in other games; `seq` last matches `ORDER BY seq ASC` natively instead of a backward scan |
| `game_events_game_pending_idx (game_id, seq DESC) WHERE status = 'pending'` | GM dashboard polling the unresolved-event queue | Self-cleaning: a row leaves the index when the GM confirms or dismisses it, so size tracks open queue depth, not total history |
| `game_events_game_seq_idx (game_id, seq DESC)` | GM event feed, retention purge | General game-scoped ordering |
| `characters_game_id_idx (game_id)` | GM roster read | Unconditional — `characters_one_player_per_game_idx` is partial on `WHERE NOT is_npc`, which excludes NPCs and cannot be proven for a plain `game_id` lookup. Also gives `characters_game_id_fkey` a usable index |
| `location_pings (game_id, profile_id, recorded_at)` UNIQUE | Ping idempotency (`ON CONFLICT DO NOTHING`) | Deduplicates client retries |
| `private_pings_game_time_idx (game_id, recorded_at DESC)` | Daily retention purge | The unique index above cannot serve it — `profile_id` sits between the two predicate columns and Postgres does not skip-scan here |
| `hunt_claims_pending_hunter_idx / _victim_idx (game_id, ×_id) WHERE status='pending'` UNIQUE | `get_hunt_status` claim lookups; enforces one open claim per side | Uniqueness makes the `ORDER BY ... LIMIT 1` free |
| `hunt_players_game_state_idx (game_id, state)` | Alive-count in `get_hunt_status` | — |

Measured impact (240k-event simulation, player in 12 games):

| Query | Before | After |
| --- | --- | --- |
| `ingest_pings` event tail | 6.35 ms, 1,992 rows discarded | 0.02 ms, 0 discarded |
| GM pending-event poll | 9.35 ms, 20,000 rows discarded | 0.013 ms, 0 discarded |
| Pending index size | 9.5 MB (general index) | 64 kB (partial) |

`game_events_profile_visible_idx (profile_id, seq DESC) WHERE player_visible`
was **dropped** — it existed to serve cross-game "all my visible events" reads,
which the game-isolation invariant rules out. It is strictly superseded by
`game_events_game_profile_seq_idx` for every real access path.

**Foreign keys:** every FK has a covering index. Note that a *partial* index
cannot satisfy an FK constraint check unless its predicate is implied by
`col = $1` (true for `WHERE col IS NOT NULL`, false for predicates like
`WHERE NOT is_npc`). Check this when adding partial indexes to FK columns.

## Retention And Free Tier

Four daily `pg_cron` jobs keep operational data bounded:

| Job | Schedule (UTC) | Rule |
| --- | --- | --- |
| `purge-location-pings` | 03:15 | Per game's `purge_after_days` setting, 1–90 |
| `purge-finished-game-positions` | 03:20 | Latest positions removed when a game is finished |
| `purge-join-attempts` | 03:25 | Removed after two days |
| `purge-game-events` | 03:30 | Finished games, events older than 14 days |

Default autovacuum settings are adequate at current volumes; the daily bulk
deletes are small enough that bloat does not accumulate meaningfully. Revisit
per-table `autovacuum_vacuum_scale_factor` only if `location_pings` sustains
millions of rows between purges.

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

Every schema change ships with a database test. Current hosted coverage is
transactional and leaves no fixtures behind. It verifies schema/RLS/grants,
Auth profile creation, GM membership, join flow, zone privacy, consent,
character text limits, idempotent pings, PostGIS zone state, and event
emission — plus index-shape assertions for the hot-path indexes above.

**MCP discipline:** `apply_migration` for all DDL, `execute_sql` for read-only
queries and simulations only. User impersonation requires two sequential
`set local` statements in the same transaction, `role` first then
`request.jwt.claims`. Fixture users use UUIDs beginning `99999999-` and are
cleaned up in the same session.

### Platform settings not managed by migrations

- **Auth URLs:** Site URL and Redirect URLs are set to
  `https://larp-passport.vercel.app` (Authentication → URL Configuration).
- **Email confirmation is DISABLED** (Authentication → Sign In / Providers →
  Email). This resolves Supabase's fake-success-on-duplicate-registration
  behaviour; join-code gating makes the tradeoff acceptable. Do not re-enable
  without revisiting duplicate-registration handling.
- **Leaked password protection is DISABLED** — open item, see the advisor
  baseline above.

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

The EAS `development`, `preview`, and `production` environments are configured
with `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and
`EXPO_PUBLIC_SENTRY_DSN`. Local Expo uses the ignored `.env.local` file.
Environment variables are baked in at bundle time — verify production values
point at `ufcnxkowpkwayczbfnzy` before an EAS production build.

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
   update, consent, map position, zone event, hunt round, and realtime refresh.
3. Set the same Vercel variables for Production and redeploy the verified
   artifact. Build a mobile test binary with the new Expo variables.
4. Keep the old Supabase project untouched until the smoke test is complete.
5. Roll back by restoring the old client URL/key and redeploying; no data merge
   is required because the project never went live.
