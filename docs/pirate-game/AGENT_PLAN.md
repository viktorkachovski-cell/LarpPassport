# Agent implementation brief: PirateGame ("The Black Tide")

Prepared: 2026-10-07. Amended 2026-10-07: `react-native-svg` compass (P-M0, P-M3), O3/O4 decided. Code baseline: `34e10202353f1d0a58ba078b0a10c0fd2f14c58c` (`main`).
Implementation baseline refreshed to merged `main` commit `17a1d02` before continuing the code work. The prepared baseline above remains historical context.
Game date: Saturday 2026-10-31, 16:30 to 23:00. Test run, 12 to 16 players, 2 GMs.

**This file is a plan, not an implementation or deployment record.** Every task card starts unchecked. Rules are defined in [GAME_GUIDE.md](GAME_GUIDE.md); where this brief and the guide disagree on a rule, the guide wins and the disagreement must be reported to the owner. Do not update `docs/SUPABASE_ARCHITECTURE.md` until a change is applied and verified; that file records verified state only.

Owner clarification, 2026-10-07: the guide's `public.games.phase` is authoritative; Pirate-specific pause and PvP controls remain in `private.pirate_games`. Treasure coordinates may change in `setup` or `charting`, then lock before `cursed` enables readings. The dedicated Pirate APK uses the existing Android package ID and replaces the regular app on a phone. Owner decision, 2026-10-07 (later): Time Hunt ships as a separate app with its own package ID; see section 8. The guide calls for three Safe Harbours. These clarifications supersede older task-card wording below where it has not yet been implemented.

---

## 1. Instructions for the implementing agent

1. Work in the `LarpPassport` repository. Check the working tree and read any `AGENTS.md` before editing.
2. Read, in order: [GAME_GUIDE.md](GAME_GUIDE.md), this brief, [../SUPABASE_ARCHITECTURE.md](../SUPABASE_ARCHITECTURE.md), [../TIME_HUNT_GAMEPLAY.md](../TIME_HUNT_GAMEPLAY.md), [../RELEASE.md](../RELEASE.md), and [../TIME_HUNT_BACKLOG.md](../TIME_HUNT_BACKLOG.md) section 1 (its invariants still apply).
3. Compare the current code with the baseline. For every SQL function you touch or call, find its **latest** definition across migrations; later `create or replace` definitions win.
4. Implement one task card at a time in the delivery order (section 10). Each card is a separate commit with its tests.
5. **Existing** marks inspected code. **Proposed** marks names that do not exist yet. Never call a proposed RPC from a client before its migration and pgTAP tests exist and pass.
6. Preserve all existing behaviour. PirateGame is an **additive game mode**: standard games and Time Hunt games must behave exactly as before. No unrelated refactors, no dependency upgrades, no Expo SDK change, no TypeScript conversion, no new backend.
7. For each card, record changed files, tests run, manual checks and remaining limitations. A JS export or mocked test is not device QA.
8. This brief does not authorise pushing, deploying, applying migrations to the hosted project, or building an APK. Follow the authorisation given in the implementation task.

The four-week release freeze is **waived by the owner** for this test run. A short stabilisation window still applies (section 10).

---

## 2. Approved rules this brief implements

| ID | Rule |
| --- | --- |
| R1 | Crews are the game's `factions`. 4 crews of 3 to 4. A player's crew is their character's `faction_id`. |
| R2 | Currencies: bearing shards and doubloons are ledger-tracked. Oath words are revealed by site claims and shown in the app; they are not a ledger currency and not plunderable. |
| R3 | Riddle sites give **either** +1 shard **or** one oath word (word index 1 to 4). Each crew may claim each site once. A correct on-site answer is required. |
| R4 | Caches give doubloons by crew arrival order: 20 / 15 / 10 / 5. Each crew may claim each cache once. A correct on-site code is required. |
| R5 | Compass readings only inside a lighthouse; one reading per crew per lighthouse per shard level. Arc half-width by shards: 0 = none, 1 = 90°, 2 = 45°, 3 = 25°, 4 = 12°, 5+ = 5°. Deterministic offset, true bearing always inside the arc. |
| R6 | Distance band to the treasure (≤25 m, ≤100 m, else "far") only for crews with 3+ shards. No 300 m band. |
| R7 | Parley: the target opens Parley and shows a short code; the attacker enters it; the target chooses Yield or Fight. After the physical exchange, the two players in the session independently confirm the result for either choice. Fight is rock-paper-scissors played physically; both report the agreed winner. Yield requires both to confirm the attacker as winner. No transfer occurs after only one report; disagreement goes to the GM. |
| R8 | Yield: attacker crew gains 10% of the target crew's doubloons (minimum 3, capped at balance). Never a shard. |
| R9 | Fight: the winner chooses 1 shard **or** 25% of the loser's doubloons (minimum 5, capped at balance). Applies whichever side wins. |
| R10 | Protections: loser crew gets 15 min Davy's Mercy; same crew pair cannot Parley for 30 min; max 3 Parleys initiated per crew per rolling hour; no Parley inside Safe Harbours, during `truce`, or within 100 m of the treasure. |
| R11 | Treasure: 40 doubloons, claimable only in phase `hoard` (from 22:00), awarded once by a GM after hearing the full oath. |
| R12 | Phases: `setup → charting → cursed → truce → hunt → hoard → recall → finished`, advanced by a GM. |
| R13 | GM corrections never edit or delete history: they add compensating ledger rows or set void flags, require a reason, record the actor, and emit a crew-visible "Admiralty ruling" event. |

---

## 3. Current implementation map (reuse)

`D` = `larp-dashboard`, `M` = `larp-passport/mobile`, `S` = `supabase`.

| Area | Existing file or symbol | Reuse for |
| --- | --- | --- |
| GM authorisation | `private.is_game_gm(g, user)`, `private.is_game_member(...)`, `private.same_faction(...)` in `S/migrations/20260711092731_secure_api_and_policies.sql` | Every pirate RPC's auth check |
| Crews | `public.factions`, `public.characters.faction_id` (player changes guarded in `private.validate_character_write`, latest in `20260907153825_prevent_player_reset_of_locked_stats.sql`) | Crew identity. Verify players cannot change their own `faction_id`; if they can, the pirate guard in P-DB1 must block it while a pirate game is past `setup`. |
| Zones | `public.zones` (`shape`, `radius_m`, `trigger_mode` auto/gm_confirm/silent, `dwell_seconds`, `one_shot`, `active`, `payload` jsonb), `private.rearm_zone_on_change()` | All pirate sites |
| Presence | `private.zone_state` (`inside`, `inside_since`, `last_evaluated_at`) maintained by `private.evaluate_zones` from `ingest_pings` | Server-side presence proof. Read only; never write zone state from pirate RPCs. |
| Latest position | `public.player_positions` | Freshness check (≤ 2 min) and treasure distance |
| Events | `public.game_events` (`type`, `payload`, `player_visible`, `status`, `seq`, `delivery_seq`) and the mobile/dashboard delivery path | Logbook entries, rulings, broadcasts, dispute queue |
| Bearing math | `S/migrations/20260907185433_hunt_direction_bearing.sql` (`extensions.st_azimuth`, band edges, freshness) | Pattern for `compass_reading`; do not modify the hunt function |
| Advisory locks | `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('hunt:' \|\| game_id::text, 0))` | Same pattern with prefix `'pirate:'` |
| pgcrypto | Installed in `extensions` (`extensions.gen_random_bytes` already used) | `extensions.hmac`, `extensions.digest` |
| Mobile compass | `M/src/lib/direction.js` (`usableTrueHeading`, `headingQuality`, `shortestAngleDelta`, `formatBearing`), `Location.watchHeadingAsync` in `M/src/screens/GameScreen.js` | Compass dial rotation. No new sensor module. |
| Mobile theme | `M/src/lib/theme.js` (`C` colours, `F` fonts), fonts loaded in `M/App.js` | Pirate palette (P-M1) |
| Mobile delivery and recovery | `M/src/lib/eventDelivery.js`, `gameSnapshot.js`, `syncStatus.js`, `trackingSession.js`, `pingStore.js` | Unchanged. Pirate actions are **not** queued in the ping queue. |
| Dashboard | `D/src/components/GameView.jsx`, `MapPanel.jsx` (zone drawing and editor), `EventsPanel.jsx` (broadcasts, pending events), `PlayersPanel.jsx`, `HuntPanel.jsx` | Shell, map, broadcasts and pending queue. New pirate panels sit beside them. |
| Tests | `S/tests/database/001`–`006`, `S/tests/concurrency.py`, mobile Jest (`M/src/lib/__tests__`), dashboard Vitest (`*.test.jsx`) | Extend, never regress |

**Not present at baseline:** `react-native-svg` (approved addition, P-M0), `expo-camera`, any pirate table or RPC, a co-GM promotion path (verify: `is_game_gm` reads `game_players.role`, so a second GM is supported by data, but check whether any UI or RPC can create one).

---

## 4. Invariants

All invariants in `TIME_HUNT_BACKLOG.md` section 1 and in the `larp-passport-supabase` / `larp-passport-mobile` skills still apply. In particular: never edit an applied migration; RLS and policies in the same migration as each new table; schema-qualify everything with `search_path = ''`; the location queue data-loss invariant; Realtime publication stays at its current five tables.

Pirate-specific invariants:

1. **The treasure coordinate, riddle answers, cache codes and the game HMAC secret never leave the server.** Not in `zones.payload`, not in events, not in any RPC response (GM responses included for answers and secret; the treasure point may be shown to GMs only).
2. **Players never receive zone geometry or zone IDs through pirate RPCs.** Existing zone privacy stays. The server resolves "which site am I at" from `private.zone_state`.
3. **Mode isolation.** A game is a pirate game iff a row exists in `private.pirate_games`. A game cannot be both a pirate game and run a Time Hunt round: `start_hunt` must reject pirate games and `pirate_setup` must reject games with hunt state.
4. **One serialisation point per game.** Every pirate mutation takes `pg_advisory_xact_lock(hashtextextended('pirate:' || g, 0))` first, then reads/writes pirate tables. Pirate RPCs never take the hunt lock and never lock `zone_state` or `player_positions` rows.
5. **Append-only ledger.** No `update` or `delete` on `private.pirate_ledger` by any function. Balances are sums. A balance can never go negative: every debit checks the sum under the pirate lock.
6. **Phase gates are server-side.** Every player RPC checks `phase` and `paused` first. The client only reflects state.
7. **Rate limits and rejections return a jsonb status**, never `raise exception`, so attempt counters persist (same rule as the join rate limiter). Reserve exceptions for auth failures and programming errors.
8. **Determinism of the compass.** The same (crew, lighthouse, shard count) always yields the same arc for the life of the game. Rotating the secret after `setup` or moving the treasure from `cursed` onward is forbidden.
9. **No pirate data in the ping queue or `ingest_pings`.** Gameplay actions are direct RPC calls with idempotency keys.
10. **Every new callable `SECURITY DEFINER` RPC** has: auth check, input validation, schema-qualified references, explicit `revoke all ... from public, anon` and `grant execute ... to authenticated`, and pgTAP coverage including direct-table denial. Record the security advisor warning count before and after; the delta must equal the number of new callable definer functions and nothing else.

---

## 5. Architecture

### 5.1 Data model

The schema lives in `supabase/migrations/20261007144147_pirate_game.sql` (all Pirate tables are in `private`) and is not repeated here.

Add nullable `public.games.phase` with a constraint allowing the eight Pirate phases. It remains null for ordinary and Time Hunt games. Pirate mode is still identified by a `private.pirate_games` row. The foundation migration uses game-scoped foreign keys for sites and crews, so cross-game claims and awards are rejected by the database. All Pirate tables: RLS enabled, no grants to `anon` or `authenticated` (private schema, RPC access only), cascades from `games` so retention needs no new cron job. Store answers as `encode(extensions.digest(lower(trim(answer)) || ':' || zone_id::text, 'sha256'), 'hex')`; normalise both sides identically: lowercase, trim, collapse internal whitespace, strip punctuation. The game is English only (O3, decided), so no transliteration or diacritic handling.

### 5.2 Phase and gates

| Phase | Riddle/cache claims | Compass | Parley | Treasure award |
| --- | --- | --- | --- | --- |
| setup | no | no | no | no |
| charting | yes | no | no | no |
| cursed | yes | yes | yes | no |
| truce | no | no | no | no |
| hunt | yes | yes | yes | no |
| hoard | yes | yes | yes (except ≤100 m of treasure) | yes |
| recall, finished | no | no | no | no |

`paused = true` blocks everything for players. `pvp_enabled = false` blocks Parley only. Treasure point is editable in `setup` and `charting` and locks before `cursed`; `hmac_secret` is editable only in `setup`.

### 5.3 Compass computation (`compass_reading`)

```
level      = least(crew_shards, 5)                      -- 0 => return {status:'no_shards'}
h          = case level when 1 then 90 when 2 then 45 when 3 then 25 when 4 then 12 else 5 end
origin     = lighthouse centre (zones.geog for a circle; lighthouses MUST be circles)
true_deg   = degrees(extensions.st_azimuth(origin, treasure_geog))
u          = ('x' || substr(encode(extensions.hmac(faction_id||':'||zone_id||':'||level, hmac_secret, 'sha256'),'hex'),1,8))::bit(32)::bigint / 4294967296.0
offset     = (2*u - 1) * 0.8 * h
centre_deg = round((true_deg + offset + 360) mod 360) mod 360
```

If a non-voided reading exists for (zone, crew, level), return it unchanged (idempotent, no new row). Otherwise insert and emit a logbook event to each crew member. Return `{status:'ok', lighthouse_name, centre_deg, half_width_deg, level, taken_at}`. Never return `true_deg`, offset or the treasure point.

### 5.4 Tunables (`pirate_games.settings`, with defaults)

```json
{ "cache_payouts": [20,15,10,5], "yield_pct": 10, "yield_min": 3,
  "fight_pct": 25, "fight_min": 5, "mercy_minutes": 15, "pair_cooldown_minutes": 30,
  "parley_per_hour": 3, "parley_code_ttl_s": 90, "parley_timeout_s": 300,
  "treasure_exclusion_m": 100, "far_apart_m": 75, "position_max_age_s": 120,
  "wrong_answer_limit": 3, "wrong_answer_lockout_s": 120,
  "arc_half_widths": [90,45,25,12,5], "band_unlock_shards": 3 }
```

The GM can edit these only in `setup` (except mercy and cooldowns, editable any time). Validate types and ranges server-side.

### 5.5 Events emitted (all `player_visible`, one row per crew member unless noted)

Check the latest player event visibility policy first. If players see only rows where `profile_id = auth.uid()` (or broadcast rows), emit one row per crew member (max 4) rather than changing RLS.

| `type` | When | Payload (never secrets) |
| --- | --- | --- |
| `pirate_phase` | phase change (broadcast) | `{phase, message}` |
| `pirate_claim` | site claim | `{site_name, kind, reward, oath_index?, oath_word?, doubloons?, rank?}` |
| `pirate_reading` | new reading | `{lighthouse_name, centre_deg, half_width_deg, level}` |
| `pirate_parley` | each state change (both crews) | `{parley_id, state, outcome?}` |
| `pirate_ruling` | any GM correction (affected crew) | `{action, reason, delta?}` |
| `pirate_dispute` | disputed or timed-out Parley | `player_visible = false`, `status = 'pending'` for the GM queue |
| `pirate_treasure` | treasure awarded (broadcast) | `{crew_name}` |

---

## 6. Database task cards

Each card: one migration via `npx supabase migration new <name>`, plus tests in `S/tests/database/007_pirate_game.sql` (extend per card) and, where noted, `S/tests/concurrency.py`.

- [ ] **P-DB1 `pirate_core_schema`.** Tables from 5.1, RLS on, no client grants, indexes, cascades. Mode isolation is enforced on `private.hunt_rounds` insertion, covering the latest `start_hunt` without duplicating its body; the existing character validator already prevents players from changing their own `faction_id`. Tests: tables exist, RLS on, `authenticated` cannot select/insert any Pirate table, hunt cannot start on a Pirate game, cross-game sites are rejected, and voided treasure awards can be replaced. Code is present; pgTAP execution is pending CI.
- [ ] **P-DB2 `pirate_gm_setup`.** Proposed RPCs (GM only): `pirate_enable(g)`, `pirate_set_site(g, zone_id, kind, reward, oath_index, oath_word, prompt, answer)` (answer write-only; null keeps existing hash), `pirate_clear_site(g, zone_id)`, `pirate_set_treasure(g, lat, lng, value)` (`setup` or `charting` only), `pirate_set_settings(g, settings)`, `pirate_validate(g)` returning a readiness report: 4 crews exist; every member has a crew; 7 bearing riddles, 4 oath riddles with indexes 1 to 4 each exactly once, 8 caches, 6 lighthouses (circles), 3 harbours, treasure set; no two pirate sites overlap (`extensions.st_dwithin` with radii); every riddle/cache has an answer; lighthouse-to-treasure geometry sanity (see S01). Tests: non-GM denied, answer never returned, treasure edit rejected from `cursed` onward, validator catches each failure.
- [ ] **P-DB3 `pirate_phase_control`.** `pirate_set_phase(g, phase, message)` (forward or one step back; `finished` terminal), `pirate_set_paused(g, bool)`, `pirate_set_pvp(g, bool)`. Emits `pirate_phase`. Setting `finished` also sets `games.status = 'finished'` through the existing path so position retention runs. Tests: transitions, non-GM denied, gates in 5.2 enforced by later RPCs.
- [ ] **P-DB4 `pirate_claim_site`.** `claim_site(g, answer, idem uuid)`: auth + member + has crew; phase/paused gate; resolve the site from `zone_state` (`inside` and `inside_since <= now() - dwell_seconds`, zone active, kind riddle or cache) for the **caller**; caller position age ≤ 120 s; exactly one candidate site else `{status:'no_site'|'ambiguous'}`; wrong-answer lockout; already claimed by crew → `{status:'already_claimed'}` (idempotent on `idem`); write claim, ledger row (+1 bearing, or cache payout by `rank = count(non-voided claims on zone) + 1`), events. Also `site_here(g)` returning `{site_name, kind, prompt, claimed_by_my_crew}` for the caller's current site or null. Tests: correct/incorrect answer, lockout persists across calls (jsonb status, no exception), not inside, stale position, dwell not met, double claim, oath reward returns word only to that crew, cache rank 1..4. Concurrency: 4 crews claim the same cache simultaneously → ranks are a permutation of 1..4.
- [ ] **P-DB5 `pirate_compass`.** `compass_reading(g)` per 5.3 (lighthouse resolved from caller's presence like P-DB4). `treasure_band(g)` returning `{band:'25'|'100'|'far'|'locked'|'stale'}` from caller's latest position, `locked` below 3 shards. Tests: no shards, determinism (same inputs → same arc across calls and sessions), true bearing inside arc for all 5 levels across ≥100 random treasure points (property test inside pgTAP via `generate_series`), new arc after shard change, voided reading allows retake with the same result, band thresholds, no secret in any response.
- [ ] **P-DB6 `pirate_parley`.** `open_parley(g)` (target; returns fresh numeric code, 4 digits, TTL 90 s; reuses the caller's open session if any), `join_parley(g, code, idem)` (attacker; all R10 checks; harbour check = either party `inside` a harbour zone; treasure exclusion in `hoard`; sets `far_apart` if positions > 75 m, never blocks), `parley_choice(g, id, 'yield'|'fight')` (target only), `parley_report(g, id, winner_faction)` (the two exact players report independently after either Yield or Fight; agreement resolves Yield or opens Fight plunder choice, mismatch → `disputed` + `pirate_dispute` event), `parley_plunder(g, id, 'bearing'|'doubloon')` (winning player only; bearing only if loser has ≥1 shard). Resolution writes paired ledger rows and mercy for the loser crew. A sweep inside each call expires stale sessions (`parley_timeout_s`) into `disputed`. `get_pirate_state(g)` returns the caller's active session. Tests: every rejection reason, code reuse/expiry, wrong-player reporting, yield maths with small balances (min and cap), fight both directions, plunder bearing with 0 shards rejected, mercy and cooldown, per-hour cap, `pvp_enabled=false`. Concurrency: two attackers join the same code at once (exactly one wins); two simultaneous plunders against the same crew never drive a balance negative.
- [ ] **P-DB7 `pirate_state`.** `get_pirate_state(g)` for players: `{is_pirate, phase, paused, pvp_enabled, crew:{id,name,color}, shards, doubloons, oath:[{index,word}], readings:[...], mercy_until, active_parley, site_here, band}`. One call powers the whole mobile screen. `gm_pirate_overview(g)` for GMs: all crews with balances, oath progress (indexes only), readings, mercy, last claim, member staleness, cache board, open/disputed parleys, treasure point and award. Tests: non-member denied, player never sees other crews' oath words or readings, GM sees all except answers and secret.
- [ ] **P-DB8 `pirate_gm_corrections`.** Per GAME_GUIDE 7.6: `gm_adjust`, `gm_claim_for` (skips presence and answer checks; still respects uniqueness and computes cache rank at that moment), `gm_void_claim` (voids claim, writes reversing ledger row, frees the slot; does **not** re-rank other crews' cache claims), `gm_void_parley` (reverses its ledger rows, removes the mercy it granted if still the latest), `gm_resolve_parley`, `gm_void_reading`, `gm_set_mercy`. All require `reason` (3 to 300 chars), emit `pirate_ruling`, and resolve any related `pirate_dispute` event. Tests: each action, reason required, non-GM denied, reversals are exact (balances return to pre-action values), double void is a no-op status.
- [ ] **P-DB9 `pirate_treasure`.** `gm_award_treasure(g, faction_id, reason)` only in `hoard`, once (unique), writes ledger `source='treasure'`, emits `pirate_treasure`. `gm_void_treasure(g, reason)` reverses. Tests: wrong phase, second award rejected, void then re-award works.
- [ ] **P-DB10 co-GM.** Verify how a second GM joins today. If no path exists, add `gm_set_member_role(g, profile_id, 'gm'|'player')` (GM only; cannot demote the last GM or `games.gm_id`). Tests accordingly.

---

## 7. Dashboard task cards (`larp-dashboard`)

Mount everything under a `PiratePanel` shown in `GameView` only when `get_pirate_state`/`gm_pirate_overview` reports a pirate game. Standard and Time Hunt games render exactly as before. Every mutating control shows a pending state, the RPC status text, and requires a reason where the RPC does. Must work on a phone-width browser: the Ghost Captain runs the treasure award and corrections from a phone.

- [ ] **P-D1 Setup tab.** Enable pirate mode; crew (faction) creation using existing faction tools; "Set as pirate site" form on top of the existing `MapPanel` zone editor (kind, reward, oath index/word, prompt, answer as a password-style write-only field with "answer set ✓"); treasure point picker (map click, disabled from `cursed` onward); settings editor; **readiness report** from `pirate_validate` with each failure linked to the offending zone.
- [ ] **P-D2 Phase bar.** Current phase, next/previous buttons with confirm dialog, Pause, PvP kill switch, canned in-fiction messages per phase (editable text, defaults in a constants file), live clock with schedule hints (16:30 muster ... 22:50 recall).
- [ ] **P-D3 Crews table.** From `gm_pirate_overview`: crew, shards, doubloons, oath n/4, readings count, mercy countdown, last claim age, stale members, crew-spread warning (max pairwise member distance > 300 m). Row drill-down: ledger history with source/actor/reason, claims, readings (centre, width, level), Parley history. Refresh via existing Realtime on `game_events` plus 30–60 s fallback poll, matching current recovery conventions.
- [ ] **P-D4 Cache board and site status.** Per site: claims by crew with rank and time; a quick "deactivate site" (existing zone `active` flag) with reason logged as a ruling broadcast if desired.
- [ ] **P-D5 Disputes and corrections.** Disputed/timed-out Parley queue (pending `pirate_dispute` events) with Resolve/Void; correction dialogs for every P-DB8 action; treasure award and void (P-DB9).
- [ ] **P-D6 Map layer.** Existing player map coloured by crew; pirate sites with kind icons; treasure point (GM only); lighthouse arcs per selected crew (helps the GM judge who is close). The mapless fallback table gets crew and staleness columns.

Tests (Vitest): PiratePanel hidden for non-pirate games; readiness failures render; answer never echoed into the DOM after save; correction dialog blocks empty reason; dispute resolution calls the right RPC; phone-width snapshot of the treasure award control.

---

## 8. Mobile task cards (`larp-passport/mobile`)

New code goes in new files under `M/src/pirate/` (components) and `M/src/lib/pirate*.js` (pure logic) with their own `StyleSheet` built from theme tokens. Keep the Sharing/consent tab, sync status and event delivery untouched.

**App split (implemented 2026-10-07).** One Expo project builds two apps. `APP_VARIANT` (`pirate` by default, or `hunt`) selects the name and Android package in `app.config.js`, and `metro.config.js` resolves `*.pirate.js` / `*.hunt.js` before `*.js`. `GameScreen.pirate.js` and `GameScreen.hunt.js` share `screens/game/GameFrame.js` (layout and the character, logbook and sharing tabs) and `screens/game/session.js` (snapshot, Realtime, recovery polling, sharing). `lib/brand.<variant>.js` holds the palette and app-specific copy. Neither bundle contains the other game's screens; each app lists only its own games.

**Exactly one new native module is approved: `react-native-svg`** (owner decision 2026-10-07), for the compass only (P-M0, P-M3). Nothing else native: no `react-native-reanimated`, no Skia, no `expo-sensors`, no Lottie. The pirate APK is a separate build (O4), so the native rebuild is expected.

- [ ] **P-M0 Install and prove `react-native-svg` (do this first, in week one).** Run `npx expo install react-native-svg` from `larp-passport/mobile` (lets Expo pick the SDK 53 version, 15.11.2 at the time of writing; never hand-pin), then `npx expo-doctor@latest`. Render a trivial `<Svg>` behind a dev-only flag, then produce an **EAS preview APK** and confirm it boots on a real device. This catches the known autolinking / `babel-preset-expo` boot-crash pattern while there is still time; do not leave the first native build to game week. Jest: add the `react-native-svg` mock (or a manual mock under `__mocks__`) so existing suites keep running.
- [ ] **P-M1 Pirate theme.** Palette per app in `lib/brand.pirate.js` / `lib/brand.hunt.js`, selected at bundle time by `APP_VARIANT` (superseded the original `EXPO_PUBLIC_APP_THEME` switch). Export the same `C`/`F` names so no call sites change. Pirate palette: parchment/ink on dark sea, lantern amber accent, blood red for danger; keep the existing contrast rules (text ≥ 4.5:1, borders ≥ 3:1). Optional pirate display font via an `@expo-google-fonts/*` package installed with `npx expo install` (JS + asset only); body text stays IBM Plex for legibility. 
- [ ] **P-M2 State hook.** `usePirateState(gameId)`: calls `get_pirate_state`, refreshes on relevant `game_events` types and with the existing foreground/visibility polling rules (no polling in background, 30–60 s fallback). Pure reducer in `lib/pirateState.js` with Jest tests.
- [ ] **P-M3 Compass tab (`react-native-svg` + built-in `Animated`).**
  - **Structure.** `M/src/pirate/CompassDial.js`, a memoized component isolated like `<Countdown/>`, so heading updates never rerender the rest of `GameScreen`. Inside it, one `<Svg>` with two layers:
    - **Rose layer** (static per reading): compass-rose artwork as vector paths in theme colours, cardinal letters, and the **arc wedge** from `centre − h` to `centre + h` drawn as a `Path` (arc command), plus a thin centre line. It only rerenders when the displayed reading changes.
    - **Rotation:** the `<Svg>` sits inside an `Animated.View` rotated by `−smoothedHeading` with `useNativeDriver: true`. The SVG is never redrawn per frame; only the native transform changes.
  - **Heading pipeline (`M/src/lib/pirateCompass.js`, pure, Jest-tested).**
    - Source: the existing `Location.watchHeadingAsync`, filtered through `usableTrueHeading` from `direction.js`. Never substitute magnetic heading.
    - **Unwrap** across 0°/360° with `shortestAngleDelta` into a continuous angle, then **exponential smoothing** with α ≈ 0.25.
    - **Throttle** React state updates to about 15 Hz. Animate with a short `Animated.timing` (about 80 ms) to the unwrapped value, so the dial never spins the long way round.
    - Subscribe only while the Compass tab is visible **and** the app is foregrounded (`AppState`); unsubscribe otherwise to save battery.
  - **Arc geometry (same module).** `arcPath(centreDeg, halfWidthDeg, radius)` returns the SVG path string and must handle the 0/360 seam and the ±90° case (large-arc flag). `bearingRangeLabel(centre, h)` returns text such as `047°–097°`.
  - **Trust and calibration.** Use `headingQuality`. On `low` or `none`, dim the dial, keep the arc visible, and show "Wave the phone in a figure-8 to calibrate". Always show the numeric range and `cardinalLabel` beside the dial, so crews can plot on the paper chart even when the magnetometer is disturbed by metal or old stone walls.
  - **Readings list.** Below the dial: one row per lighthouse reading (lighthouse name, `formatBearing` range, shard level). Tapping a row shows that arc on the dial. Default: the most recent reading.
  - **Actions.** "Take reading" is enabled only when `site_here.kind = 'lighthouse'`. Show the treasure band banner when it is unlocked.
  - **Accessibility.** Respect `useReducedMotion` (no smoothing animation, direct set). Give the dial an `accessibilityLabel` with the bearing range in words.
  - **Tests (Jest).** Smoothing across the seam (359° → 1° moves +2°, not −358°); `arcPath` for h = 5, 12, 25, 45, 90 including seam-crossing centres; range labels; throttle behaviour with fake timers; render test with the SVG mock.

- [ ] **P-M4 Site tab ("Landfall").** When `site_here` is a riddle or cache: show prompt, answer input, submit (`claim_site` with an idempotency key generated per attempt and reused on retry), result card (shard, oath word with index, doubloons with rank). Clear messages for every status (`no_site`, `locked_out` with remaining seconds, `already_claimed`, `wrong`). When at no site: "No landmark in sight" plus a hint that dwell takes ~20 s.
- [ ] **P-M5 Hold tab.** Shards (with arc width they give), doubloons, oath words 1–4 (known/unknown slots), mercy countdown (isolated `<Countdown/>` pattern; no full-screen ticking).
- [ ] **P-M6 Parley tab.** Target flow: "Open Parley" → large code with expiry ring → Yield/Fight choice → both players confirm the result after the physical exchange → waiting/agreed/disputed. For Yield, both confirm the attacker won; for Fight, each reports the winner. Attacker flow: enter code → waiting for choice → confirm result → if the winning player, choose plunder (bearing disabled when the loser has none). Every screen shows server state from `get_pirate_state`; buttons disabled while a call is in flight; recover correctly after app restart mid-Parley.
- [ ] **P-M7 Logbook.** Reuse the existing events tab rendering with pirate copy for the `pirate_*` types and rulings ("The Admiralty has ruled: ..."). Notifications for `pirate_phase`, `pirate_parley` (when we are the target or waiting), and `pirate_treasure` through the existing notification sync.

Tests (Jest): compass seam maths, state reducer, Parley client state machine including restart recovery, status-to-message mapping. The 22 queue tests and all existing suites stay green.

---

## 9. Tooling

- [x] **S01 Triangulation simulator** (`tools/pirate/simulate_triangulation.py`, stdlib only). Input: treasure lat/lng and lighthouse lat/lng list in JSON. For each shard level and each lighthouse pair: crossing angle at the treasure, estimated intersection area of the two arcs, and the best 2- and 3-reading search area. Flag pairs with crossing angle < 30° or > 150° and any lighthouse closer than 200 m or farther than 1.5 km from the treasure. Estimates use a local grid and a simulation seed; rerun with candidate locations before P-D1 data entry.
- [ ] **S02 Test-game seeder** (`tools/pirate/seed_test_game.sql`, local stack only): 4 crews, 29 sites around a sample area, treasure, answers `test1`… for local and CI-like manual testing. Never run against the hosted project.

---

## 10. Delivery order and calendar

| Order | Cards | Target date |
| --- | --- | --- |
| 1 | P-DB1, P-DB2, P-DB3, P-DB10, S01 | Mon 12 Oct |
| 2 | P-DB4, P-DB5, P-DB7 | Wed 14 Oct |
| 3 | P-DB6, P-DB8, P-DB9 | Fri 16 Oct |
| 4 | P-D1 to P-D6 | Mon 19 Oct |
| 5 | P-M0 (EAS preview APK booting on a device) | Mon 12 Oct, in parallel with order 1 |
| 6 | P-M1 to P-M7 | Thu 22 Oct |
| 7 | Hosted migrations applied, Vercel preview, pirate APK from tag `game-2026-pirate-v1.0.0` | Fri 23 Oct |
| 8 | **Field rehearsal** in the real play area at dusk, 2 GMs + 4 to 6 testers (section 11) | Sat 24 Oct |
| 9 | Fixes from rehearsal; final tag `game-2026-pirate-v1.0.x` | by Tue 27 Oct |
| 10 | **Stabilisation:** verified bug fixes only, no new features; content entry and printed charts | 28 to 31 Oct |

If the calendar slips, cut in this order: P-D6 arcs layer, P-M7 notifications (logbook still works), P-M1 custom font, settings editor (use defaults). Never cut P-DB8 corrections or `gm_claim_for`: they are the game-night safety net.

---

## 11. Verification before game night

Automated (all green in CI): pgTAP 001–007, `concurrency.py` including the pirate cases, dashboard Vitest + build, mobile Jest + `expo export`. Security advisor delta recorded and explained.

Field rehearsal checklist (real devices, the actual area, after dark):

- [ ] Every pirate site triggers presence within 30 s of arrival on at least 2 different phone models; adjust radii where not.
- [ ] Each riddle answer and cache code verified on site by the person who wrote it.
- [ ] Lighthouse readings: arcs plotted on the printed chart actually contain the treasure; at least one crew finds it from readings alone.
- [ ] Compass dial direction matches a physical compass within ~15° after calibration; the dial stays smooth (no visible jitter or long-way spins) while walking; the calibration hint appears near metal structures.
- [ ] Parley end to end: yield, fight with agreement, fight with disagreement (dispute appears for GM), app killed mid-Parley.
- [ ] GM corrections from a **phone browser** by the second GM: `gm_claim_for`, `gm_adjust`, void and resolve Parley, award treasure.
- [ ] Phase changes reach all phones; pause blocks actions; PvP kill switch works.
- [ ] Airplane mode for 5 min, then reconnect: location queue flushes, claims retried with the same idempotency key do not double-award.
- [ ] Battery drain over 60 min recorded per phone to size power banks for 6.5 h.

---

## 12. Definition of done and release record

Done per card: code changed, tests added and run green, edge cases above covered, risks stated. Release record `docs/pirate-game/RELEASE_RECORD_2026-10.md` (create at release): git tag and commit, APK sha256 and build number, latest migration filename on hosted `Passport`, advisor warning count, Vercel deployment id, test counts, rehearsal results, known limitations.

---

## 13. Owner decisions and content still needed

| ID | Item | Blocks |
| --- | --- | --- |
| O1 | Treasure point and 6 lighthouse locations (use S01), still to be decided | P-D1 data entry, rehearsal |
| O2 | Oath words 1–4, riddle prompts and answers, cache codes, still to be decided | Data entry |
| O3 | ~~Answer normalisation~~ **Decided:** English only; lowercase, trim, whitespace, punctuation | Closed |
| O4 | ~~Shared or separate APK~~ **Decided:** separate apps. `APP_VARIANT=pirate` (default; EAS `preview`/`production`) builds the Pirate app; `APP_VARIANT=hunt` (EAS `preview-hunt`/`production-hunt`) builds Time Hunt | Closed |
| O6 | **Decided:** Pirate APK keeps `com.larppassport.app`, so it replaces an installed LARP Passport. Time Hunt uses `com.larppassport.timehunt` and installs beside it | Closed |
| O5 | Printed chart design and scale | Rehearsal |

**Out of scope for this test run:** QR codes and camera, in-app map for players, moving treasure, Ghost Fleet player mechanics, app-enforced oath trading, items (spyglass, rum, parrot), iOS.
