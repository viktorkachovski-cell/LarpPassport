# Agent implementation brief: UI first, then bonuses, QR and direction

Prepared: 2026-09-07. Code baseline: `a5c00b9a033c6bcd71615948249a795d86534a5c`.

**This file is a plan, not an implementation or deployment record.** The owner explicitly requested Markdown only for this task. All work boxes below start unchecked. The owner reports rebuilding the Android APK and is doing device QA; this brief does not independently verify that build.

## 1. Instructions for the implementing agent

1. Work in the Git repository `LarpPassport`, currently at `J:\BackEnd\LARPBackend\LarpPassport`, not its parent repository. Read applicable `AGENTS.md` instructions and check the working tree before editing.
2. Read this brief, [the reliability release record](RELIABILITY_RELEASE_2026-09-07.md), and [implemented game rules](TIME_HUNT_GAMEPLAY.md). The older [staff review](STAFF_REVIEW_2026-09-07.md) records the original UI numbering; its historical reliability findings are not a new to-do list.
3. Compare the current code with this baseline. Locate the latest definition of each SQL function across migrations; later `CREATE OR REPLACE` definitions override earlier ones.
4. Implement one task card at a time. Do all six approved UI cards before adding gameplay features. Preserve working behavior and avoid unrelated rewrites or dependency upgrades.
5. An instruction labelled **Existing** describes inspected code. A name labelled **Proposed** does not exist yet. Do not call a proposed RPC from a client before its migration and tests exist.
6. UI work may proceed when implementation is requested. Resolve the gameplay decisions in section 5 with the owner before implementing dependent mechanics. An unanswered decision is not approval. Continue unrelated approved work while it is pending.
7. For each card, record changed files, tests run, manual checks, and remaining limitations. Do not mark device QA complete from a JavaScript export or mocked test.
8. This brief does not instruct you to push, deploy, modify hosted data, rebuild an APK, or implement deferred features. Follow the authorization in the implementation task. Previously granted access need not be requested again when it still covers the action.

### Delivery order

| Order | Task | Depends on | Rule approval needed? |
| --- | --- | --- | --- |
| 1 | U01: truthful connection and sync status | Existing recovery and tracking code | No |
| 2 | U02: important actions and persistent outcomes | U01 status/error conventions | No |
| 3 | U04: readable type and touch targets | Existing theme | No |
| 4 | U05: accessibility and reduced motion | U04, then audit all changed controls | No |
| 5 | U06: responsive GM tables and touch map drawing | U04/U05 conventions | No |
| 6 | U07: plain operational wording | Apply consistently across U01–U06 | No |
| 7 | Q01: scan a QR code to join | UI complete; existing join RPC | No, if it remains equivalent to typed join |
| 8 | B01/B02: bonus grants, inventory and target-location reward | Decisions G1–G5 | Yes |
| 9 | Q02: treasure scanning awards a bonus | Q01 scanner/parser, B01, decisions G1/G2/G5/G6 | Yes |
| 10 | D01: direction alongside the proximity bar | Decisions G3/G7; B01 only if direction is a bonus | Yes |

**Not in this release:** original UI item 3 (expanded GM readiness checklist), item 8 (password recovery/auth deep-link work), daylight/theme presets, game duplication, offline rules cards, timeline exports, and expanded dispute reporting. Keep the readiness information and other controls that already exist. QR joining is explicitly included by this new request.

## 2. Current implementation map

Paths below are relative to the repository root. `D` means `larp-dashboard`; `M` means `larp-passport/mobile`. These are path abbreviations for this document, not configured aliases.

| Area | Existing file or symbol | Use it for |
| --- | --- | --- |
| Web shell and game list | `D/src/App.jsx`, `D/src/components/GamesList.jsx` | Account/game navigation and operational wording |
| Web game orchestration | `D/src/components/GameView.jsx` | Authoritative snapshot refresh, Realtime recovery, pending events, GM join code, lazy map loading |
| Web hunt | `D/src/components/HuntPanel.jsx` | Claims, chain, GM assignment, existing readiness and recovery controls |
| Web events | `D/src/components/EventsPanel.jsx` | Pending breaches, broadcast outcomes, independently paginated history |
| Web tables/forms | `D/src/components/PlayersPanel.jsx`, `CharactersPanel.jsx`, `TemplatePanel.jsx`, `AuthScreen.jsx` in the same directory | Responsive data editing, labels, focus and outcomes |
| Web map | `D/src/components/MapPanel.jsx`: `startDraw`, `cancelDraw`, `finalizePolygon`, `submitEditor` | Touch drawing, editor flow and map resizing |
| Web geometry/theme | `D/src/lib/geo.js`, `D/src/styles.css` | Existing shape conversion, palette, focus and responsive rules |
| Mobile entry/config | `M/App.js`, `M/app.json`, `M/package.json` | Screen lifecycle, native permissions and dependency configuration |
| Mobile game list/auth | `M/src/screens/GamesScreen.js`, `M/src/screens/AuthScreen.js` | Existing typed join, sign-in and wording |
| Mobile game UI | `M/src/screens/GameScreen.js` | Inline `HuntPanel`, `ProximitySignal`, `LiveDot`, `EventsTab`, `PlayerMessageBox`, `SharingTab`, `CharacterSheet`, `CreateCharacter`, `Field` |
| Mobile visual tokens | `M/src/lib/theme.js` | `C` color tokens and `F` font tokens |
| Mobile sync telemetry | `M/src/lib/locationTask.js`: `queueStatus`, `isSharing`, `syncNotifications` | Existing queue metadata, native tracking state and notification recovery |
| Mobile reliability helpers | `M/src/lib/trackingSession.js`, `pingStore.js`, `eventDelivery.js`, `gameSnapshot.js`, `locationConsent.js` in the same directory | Ownership, serialized tracking lifecycle, durable queue and authoritative recovery |
| Hunt schema and distance bands | `supabase/migrations/20260711125051_add_time_hunt_gameplay.sql` | Original tables and `private.hunt_distance_band` |
| Current player hunt response | `supabase/migrations/20260715201214_fix_hunt_status_stale_found.sql`: `public.get_hunt_status(g)` | Caller-scoped target/proximity response; preserve the nonparticipant fix |
| Locked character fields | `supabase/migrations/20260907153825_prevent_player_reset_of_locked_stats.sql` | Server-owned stat validation; bonuses must not bypass it |
| Current tracking/event correctness | `supabase/migrations/20260907153842_reliable_tracking_and_event_delivery.sql` | Shared hunt locks, monotonic GPS adjudication, separate event delivery cursor |
| Database tests | `supabase/tests/database/001_architecture_and_rls.sql` through `005_tracking_and_delivery.sql`, `supabase/tests/concurrency.py` | Existing security/gameplay/recovery tests and real concurrency harness |
| CI and release instructions | `.github/workflows/ci.yml`, `docs/RELEASE.md`, `docs/SUPABASE_ARCHITECTURE.md` | Actual validation commands and deployment process |

**Stack at this baseline:** Vite/React JavaScript web app; Expo SDK 53 / React Native 0.79 Android app; Supabase/Postgres with PostGIS. `expo-location` is already installed. There is no `expo-camera` dependency, registered app URL scheme, bonus inventory, treasure system or direction field in the player hunt response. Do not introduce Next.js, Expo Router, TypeScript conversion, or another backend to implement this plan.

## 3. Invariants: preserve these in every task

- Keep both the general character/event workflow and Time Hunt. Additive features must not assume every game has a hunt round.
- `join_game(code)` remains the authority for membership, rate limits and active-hunt restrictions. QR must not insert `game_players` directly.
- The GM gets the join code through `gm_get_join_code(g)`. Do not widen generic game queries to `games.*`, expose join codes in public events, or loosen column permissions.
- Players currently receive their target's character name and rounded proximity, not its profile ID or coordinates. GM visibility is privileged and must stay separate.
- `get_hunt_status(g)` supports not-started, nonparticipant, active, eliminated and finished states. A nonparticipant must never inherit another player's target data.
- Ordinary proximity requires both positions to be no more than two minutes old. Preserve the five bands: up to 25 m, 100 m, 300 m, 1 km, and over 1 km. Preserve displayed distance rounding to 10 m. *Amendment 2026-09-07 (decision G7):* in a game whose GM has enabled direction, the rounded-metre readout is withheld from players and `distance_m` is coarsened to the band edge; games with direction off are unchanged.
- Preserve the ten-minute cloak, anonymous victim confirmation, GM overrides, and manual target inheritance. **Every new elimination claim is blocked while any inherited target awaits GM assignment.**
- Hunt start forces active status and GM-only locations. Preserve roster locks, character identity protections, winner resolution, consent revocation and position deletion on elimination.
- Preserve server-validated boundaries, timestamps, claim timing and ordinary one-shot event zones. UI changes must not alter their geometry, thresholds or adjudication.
- `private.hunt_players` uses a `state` column (`alive`/`eliminated`), not an `alive` column. The RPC exposes an `alive` boolean.
- `private.hunt_rounds` is keyed by `game_id`; there is currently no persistent per-round UUID. Reset/start recreates round state. Do not use `game_id` alone as a once-per-round redemption key.
- `game_events.seq` is timeline identity; `delivery_seq` is notification delivery order. The delivery cursor is not a user-read/acknowledgement marker. Keep late-visible event recovery and pending-event pagination intact.
- Keep account/game/session ownership of the location queue, captured-session authorization, single-flight delivery, and protection against late responses from old screens/accounts. No bonus mutation belongs in the GPS queue.
- Preserve the existing per-game hunt advisory lock and lock ordering when adding mutations. Current row-trigger writers use a try-lock/retry approach to prevent deadlocks. Do not introduce row-lock-first paths that invert that order.
- Never put service-role credentials in either client. New private data must be accessible through explicitly authorized RPCs; test direct-table denial as well as the intended API.

## 4. First work package: the six approved UI improvements

Keep the **Temporal Field Authority** theme: Android as a personal field passport; web as a GM command console. Reuse midnight navy, off-white, cyan, amber and red. Use IBM Plex Sans for reading, Chakra Petch for headings, and monospace sparingly for IDs/timers. This is a usability refinement, not a visual rebrand.

### U01 — Show truthful connection, tracking and synchronization state

**Edit:** `GameView.jsx`, `GamesList.jsx`, mobile `GamesScreen.js` and `GameScreen.js`; add small helpers in the relevant `src/lib` directories only where useful. Extend `locationTask.js` telemetry only when a required value is unavailable.

1. Track the time of the last successful authoritative response for the current account/game. Reuse existing requests; do not add a second polling system. Record a success only after the relevant request succeeds, not when it starts or a socket connects.
2. Keep separate facts: server response age, Realtime connection state, location sharing enabled, OS permission state, GPS age, queued pings, and failed pings. These can disagree. Do not collapse them into a fabricated single “online” boolean.
3. Reuse `queueStatus(gameId)` fields: `queued`, `lastSent`, `profile`, `oldestPendingAt`, `failed`, `lastError`. `lastSent` concerns ping delivery, not all server activity. Zero queued pings does not prove connectivity. A failed ping count is not a retryable queue count.
4. Query current OS permissions without prompting on every refresh. Read the last local GPS capture time through a minimal owner-scoped telemetry addition if needed; queue metadata does not currently provide this reliably after a successful drain. Do not change GPS sampling intervals, accuracy profiles or consent behavior.
5. Replace decorative assurances such as `UPLINK` and `TRANSMITTING`. Examples: “Server updated 12 s ago”, “Reconnecting”, “Location sharing on · 3 updates queued”, “Location permission needed”, “GPS fix is stale”. Show “Offline” only when supported by a network failure/offline signal, not merely because sharing is off. Before the first result, say “Checking” or “No successful sync yet”.
6. Treat browser `navigator.onLine` and Realtime `SUBSCRIBED` as hints. Preserve authoritative refresh on reconnect/foreground. On account/game change, reset status ownership and reject old responses. Display errors without raw tokens or request headers.

**Accept when:** airplane mode, reconnect, permission revocation, stale GPS, sharing off, queued updates and a second account all produce accurate, distinct messages. A restored socket with a failed snapshot must not claim data is synchronized. Status renders must not restart map, GPS, camera or notification subscriptions.

### U02 — Prioritize decisions; keep consequential outcomes visible

**Edit:** mobile `GameScreen.js`; web `GameView.jsx`, `HuntPanel.jsx`, `EventsPanel.jsx`, plus action forms with disappearing outcomes.

1. Put pending decisions above routine activity: incoming elimination confirmation for the player; pending assignment and breaches for the GM. Provide a count and a link/button to the existing action when it is on another tab. Display only caller-visible data.
2. Derive pending decisions from authoritative pending claims/assignments/events. Do not derive the pending list from the capped history page. Preserve all pages of unresolved GM events.
3. Keep claim, assignment, breach, save and broadcast outcomes visible until dismissed or superseded by a new action. Audit timers such as `EventsPanel.send` and template/character “saved” timers. Replace consequential auto-dismiss behavior with an inline status and accessible dismissal.
4. Acknowledging a visual message must never confirm a defeat, resolve a breach, advance notification cursors or remove an unresolved server action. Keep real confirmation dialogs and existing RPCs.
5. Prevent duplicate submission while a request is pending. On failure preserve form input and offer a clear retry. A success message must follow a successful response, not an optimistic click.

**Accept when:** a late-visible pending breach remains reachable beyond the history limit; navigation/reconnect restores pending actions; a dismissed outcome changes no game state; errors do not disappear before they can be read; existing claim/assignment blocking remains intact.

### U04 — Increase essential text and touch targets

**Edit:** mobile `theme.js` and screen styles; web `styles.css` and controls as necessary.

1. Establish small, shared type/spacing tokens in the current styling system. Use 14–16 logical pixels for mobile operational labels/body text, larger headings, and readable line heights. Keep only genuinely optional decoration small.
2. Audit target/proximity labels, claim controls, sharing status, telemetry, character fields, auth and game join. Current tiny labels include `stateLabel`, `meterLabel`, `inputLabel`, `sheetLabel`, `telemetryLabel` and `sharingFootnote` in `GameScreen.js`.
3. Provide native touch targets at least 48 logical units and aim for 44 CSS pixels on web touch controls. Enlarge actual layout/hit areas without overlapping neighboring actions. Do not merely enlarge the icon.
4. Allow native font scaling. Replace fixed text-container heights where necessary; wrap labels and make forms scrollable above the keyboard. Do not use a blanket font-size replacement or disable scaling to hide clipping.

**Accept when:** small Android screens and large system text retain all actions, long character names and error messages remain readable, the keyboard does not cover the submit action, and GM table density remains usable. Compare before/after screenshots; do not add tests that only assert CSS constants.

### U05 — Accessible forms, focus, status and motion

**Edit:** web forms and icon actions across the mapped components; mobile controls and `LiveDot` in `GameScreen.js`.

1. Associate web inputs with unique labels (`htmlFor`/`id` or valid wrapping). Give every icon-only action an accessible name. Table edit controls need row-specific names, e.g. “Hit points for Alice”, not repeated anonymous inputs.
2. Preserve the focus styles already in `styles.css`; improve gaps rather than replacing them wholesale. Support keyboard access, visible focus, dialog focus return and logical tab order.
3. Add native accessibility labels/roles/states to relevant controls. Keep status understandable with text or icons as well as color. Announce consequential changes without announcing every countdown second.
4. Respect web `prefers-reduced-motion` and native reduced-motion preferences, including changes while the app is open. Stop or replace `LiveDot`'s perpetual opacity loop with a static indicator. Clean up listeners and animations.
5. Measure contrast using actual foreground/background combinations: normal text at least 4.5:1, qualifying large text at least 3:1. Check muted labels, placeholders, warnings and focus indicators; do not assume the palette automatically passes. See [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Accept when:** web keyboard-only use reaches all actions; Android TalkBack reads input names and pending decisions; reduced motion removes decorative looping; errors and statuses remain intelligible without color. Record tested combinations, not a blanket compliance claim.

### U06 — Narrow-screen GM tables and touch map drawing

**Edit:** `PlayersPanel.jsx`, `CharactersPanel.jsx`, `TemplatePanel.jsx`, `MapPanel.jsx`, `styles.css`.

1. Reuse the existing `.table-scroll` rule for dense editable tables that lack a wrapper. Add a clear scroll cue and keyboard-accessible, named region where needed. Prefer this small change over duplicating an entire editable form into a second card implementation.
2. At narrow widths, keep headings, action buttons and pagination reachable without page-wide horizontal overflow. Preserve row identity, edited values, role restrictions and audit controls. Check 360, 390, 768 and desktop widths, plus browser zoom.
3. While drawing a polygon, show **Finish polygon**, **Undo last point**, and **Cancel**. Disable Finish until there are at least three distinct committed vertices. Undo removes the last committed vertex, not the hover cursor. All controls must work by touch and keyboard.
4. Call the existing `finalizePolygon(points)` path so Finish opens the zone editor. It must not immediately call `saveZone`. Retain existing desktop double-click and Escape behavior. Avoid accidental extra vertices from button clicks/double-clicks and close the ring exactly once through the existing geometry conversion.
5. Preserve zone purpose, coordinate order `[longitude, latitude]`, validation, warning distance and event/play-area semantics. Do not include the preview cursor in the saved polygon. Confirm the current circle radius workflow remains usable on touch; fix an input/control defect if reproduced, without changing distance units or defaults.
6. Keep the map lazy-loaded and mounted after first opening. Resize it when its visible container changes, without recreating the map or duplicating listeners. Clean up any added observer.

**Accept when:** a touch-only user can draw, undo, finish, edit and save a polygon; cancel saves nothing; fewer than three distinct vertices cannot be submitted; tables work on narrow screens; repeated tab switches retain the map and create no duplicate handlers. Add focused behavior tests for new drawing controls.

### U07 — Plain operational wording alongside the fiction

**Edit:** visible strings in both clients, including game navigation, sharing and messaging.

| Current wording/pattern | Preferred operational wording |
| --- | --- |
| Deployments used as the game list | Games |
| Disconnect field ID | Sign out |
| Unexplained sharing/transmission label | Location sharing, followed by factual state |
| Fiction-only player message action | Message GM |
| Unclear pending-target state | Waiting for GM target assignment |

Retain themed headings as secondary decoration where useful. Change display strings only; preserve tab keys, database values, event types, RPC names and game terminology needed for decisions. “Claim elimination” must still describe a claim, and “Confirm elimination” must still clearly describe defeat confirmation.

**Accept when:** a new player can identify joining, signing out, enabling sharing and messaging the GM without interpreting the fiction. Both clients use the same operational terms.

### UI package exit checklist

- [x] U01, U02, U04, U05, U06 and U07 implemented (branch `codex/ui-package-direction`, 2026-09-07, one commit per card) and checked by automated tests; see the implementation record below.
- [x] Existing component/unit tests and both client builds pass; behavior tests cover the new sync-status transitions, pending decisions, persistent outcomes, duplicate-submit guards and the polygon drawing controls.
- [ ] General character/event mode and Time Hunt smoke test on real devices — **not performed by the agent** (no device or hosted access in the session).
- [x] No database migration or gameplay change was needed for the UI package. The only migration in this branch belongs to D01.
- [ ] Device/accessibility checks (TalkBack, large system text, 360/390/768 widths on real hardware, reduced motion on device) — **not performed**; automated checks are recorded separately in the implementation record.

### Implementation record (2026-09-07)

- U01: `GameView`/`GamesList` (web) and `GameScreen`/`GamesScreen` (mobile) track the last successful authoritative snapshot separately from the last failed request, the Realtime socket status and the browser online hint; a failed refresh keeps the last good data on screen and says so. Mobile reads OS location permissions without prompting (`locationPermissionStatus`) and records the newest local GPS capture per owner scope (`larp_last_fix_v2:<scope>`), exposed through `queueStatus().lastFixAt`. Pure wording lives in `src/lib/syncStatus.js` in both clients with unit tests.
- U02: pending-decision banner above the dashboard tabs derived from `get_hunt_admin` and the fully paginated pending query; the player app shows an incoming claim above its tabs; outcomes persist until dismissed; every handler ignores repeated submissions while in flight; member and NPC removal confirm first.
- U04: type/spacing tokens (`theme.js` `T`/`S`; CSS `--fs-*`, `--touch`); 48 dp native and 44 px coarse-pointer targets.
- U05: labelled inputs, row-specific accessible names, tablist semantics, alert/status roles, solid focus ring, `prefers-reduced-motion` and `AccessibilityInfo` reduce-motion handling for `LiveDot`. Measured contrast (WCAG formula): muted on panel 7.6:1, red on panel 5.5:1, amber 9.5:1, green 9.3:1, cyan 10.1:1; placeholder raised 4.4→5.4:1, `--line-strong`/`C.lineStrong` raised 2.6→3.4:1 for control boundaries, focus ring 2.8→10:1. Combinations not measured: MapLibre attribution and marker labels over map tiles.
- U06: `TableScroll` region with overflow cue; Finish/Undo/Cancel polygon controls with the three-distinct-vertex rule, duplicate-vertex removal and a ring closed once by `polygonEwkt`; circle radius from the second tap; single `ResizeObserver` resize. Tests: `lib/draw.test.js`, `components/MapPanel.test.jsx`.
- U07: display strings only; tab keys, database values, event types and RPC names unchanged.
- D01: see section 9 note.

## 5. Gameplay decisions required before dependent feature work

Record the owner's choices here, with date and exact parameters. The recommendations are starting points, **not approved rules**. Ask only the decisions needed for the next feature, not the entire table at once.

| ID | Decision | Recommended proposal and tradeoff | Status |
| --- | --- | --- | --- |
| G1 | Which games/rounds support bonuses and treasure? | Enable explicitly for selected games, default off for existing games. Time Hunt-only initially is simpler; generic games require a separately defined session/expiry model. | Unresolved |
| G2 | How are bonuses generated? | Start with GM-issued and treasure-issued single-use grants. Define eligible recipients, allowed types, inventory cap, expiry, duplicate handling and transfer policy. If random rewards are wanted, approve weights/stock before server-side random selection. | Unresolved |
| G3 | What information may be revealed? | Preserve cloak, current target, consent and two-minute freshness rules. A bonus cannot override cloak or reveal another player without explicit approval. Define whether the recipient must also be sharing. | Unresolved |
| G4 | What does “exact coordinates” mean? | One timestamped GPS snapshot of the current target is narrower than live tracking. Choose snapshot versus time-limited live access, display lifetime, and what happens when a target changes. GPS accuracy is not physical certainty. | **Resolved 2026-09-07 (owner): snapshot.** “Exact coordinates” means one timestamped GPS snapshot of the current target, never time-limited live access. Still open before B02 can be built: display lifetime, behaviour on target change, and the B01 inputs G1, G2, G3 and G5. No bonus code exists at this baseline; B01/B02 remain deferred. |
| G5 | When is a bonus spent, invalidated or restored? | Spend only on successful server activation; do not spend when no eligible fix exists. Expire access on target change, elimination, reset or game end. Decide inventory behavior on GM restore/reopen, refunds, and the reset boundary. | Unresolved |
| G6 | Treasure redemption rules | Choose once per player per round versus first scanner/global stock, eligibility, location radius if any, cooldowns, and code rotation. Static QR possession alone cannot prove physical presence; GPS checking adds permission/accuracy tradeoffs and is not spoof-proof. | Unresolved |
| G7 | Direction availability and precision | Choose always available in opted-in hunts versus a temporary bonus; choose coarse compass sectors versus a degree bearing. Bearing plus distance can approximate target coordinates and materially reduce secrecy. Preserve cloak and stale-location suppression. | **Resolved 2026-09-07 (owner).** Availability: always available in opted-in hunts, not a bonus. Opt-in is a per-game GM setting (`games.direction_enabled`, default **off**, so existing games are unchanged). Precision: exact true-north bearing in whole degrees `[0, 360)`. Distance: while direction is enabled the player sees only the five vague bands (very close → very far); the 10 m rounded readout is withheld for that game, and the `distance_m` field is coarsened to the band’s upper edge so an already-installed APK still renders a value that reveals nothing beyond the band. Games with direction off keep today’s rounded metres. Cloak, two-minute freshness and stale-location suppression apply unchanged to the bearing. No accuracy-based “unreliable” threshold is approved; coincident fixes report direction unavailable. |

Do not silently choose a new cloak duration, reveal lifetime, inventory cap, reward probability, GPS eligibility radius or direction accuracy threshold. Implement the approved values as validated server policy, with tests.

## 6. Q01 — QR scanning to join a game

**Existing:** `GamesScreen.js` already joins by typed code using `join_game(code)`; `GameView.jsx` retrieves the GM's code using `gm_get_join_code(g)`. No camera package or app link scheme is configured.

**Proposed additions:** `M/src/components/QrScanner.js`, `M/src/lib/qrPayload.js`, and a small dashboard QR display component. These paths are proposals; create them only during implementation.

1. Define one versioned, bounded QR format, with distinct purposes. Suggested join payload: `{"app":"larp-passport","v":1,"type":"join","code":"<existing join code>"}`. Validate the exact shape, field types, supported version, allowed purpose and length; reuse the existing server's join-code validation. Do not accept arbitrary JSON actions or automatically open URLs.
2. Share the parser contract and test fixtures between join and treasure scanning. Start with the in-app scanner. An external camera opening the app requires separate deep-link handling and native configuration; it is not required for basic QR joining and must not pull deferred password-recovery work into scope.
3. Show **Join by QR** beside the existing manual code entry. Request camera permission only after that action. Handle denial, permanent denial, no camera, cancellation and returning from settings. Keep manual join available.
4. Install the Expo-compatible camera version through `npx expo install expo-camera`, checking SDK 53 compatibility and the lockfile. Do not copy the latest SDK package version or upgrade Expo to add scanning. Configure QR scanning only, no photo upload/storage or unnecessary microphone permission.
5. Permit only one scan submission in flight. Unmount the camera when leaving the screen/backgrounding or after a valid scan. Pause scanning while showing the preview/result. Let the user confirm joining, then call the existing join RPC and refresh membership through the normal successful-join path.
6. Handle invalid/unsupported codes, already joined, active-round roster lock, expired/changed code, rate limit, network timeout and account switch. Never report membership success from parsing alone. Keep scanned join codes out of analytics, error logs and public events.
7. In the authenticated GM dashboard, render the current code as a downloadable/printable QR with game name and readable manual code. Generate locally using a compatible, small QR library; do not send join codes to a third-party QR image service. Preserve the existing privilege boundary.

**Accept when:** a printed or second-screen QR joins through the exact same authorization path as typed entry; invalid codes cause no mutation; repeated camera callbacks do not repeat joins; camera denial leaves manual entry working. Test on the native Android build. A newly added native camera dependency requires a new APK; the APK the owner just rebuilt cannot be assumed to contain it.

## 7. B01/B02 — Bonus generation and target-coordinate reward

### B01: establish a server-owned bonus ledger

**Dependencies:** approved G1, G2 and G5. For target-revealing rewards also resolve G3 and G4.

**Proposed private entities:** `bonus_grants`, `bonus_uses`, and explicit per-round identity associated with `hunt_rounds`. Names are suggestions, not existing schema. Keep the first implementation small; do not build a marketplace, trading system or arbitrary rules engine.

1. Before SQL changes, read the applicable Supabase/Postgres skills and inspect current function definitions. Create a new migration using the project's Supabase CLI workflow; never edit a migration already applied to a hosted project.
2. Define a durable round identity: add a server-generated round UUID (or an equivalently explicit lifecycle entity) and attach round-scoped grants/redemptions to it. Start/reset must produce the intended new identity; GM restore/reopen must follow G5. Explain cleanup/foreign keys before writing the migration. Existing clients must continue receiving compatible responses.
3. Model each grant with an immutable ID, game, recipient, approved scope/round, whitelisted bonus type, source, creation time, expiry and explicit consumption/revocation state. Enforce constraints and indexes used by actual lookup paths. Do not put inventory in client-editable `characters.fields`.
4. Proposed RPC contracts: `gm_grant_bonus(g, recipient, bonus_type, request_id)`, `get_my_bonuses(g)`, and `use_bonus(g, grant_id, request_id)`. Final signatures must match approved policy. The server derives caller identity; a player cannot choose another recipient when reading/using a grant.
5. Make grant/use idempotency keys scoped to caller, game and operation. The same key with different parameters must fail. A retry must return the same authorized outcome without spending or granting twice. Bind expiry and access checks to server time.
6. Under the existing game lock, validate membership, role, game/round, eligibility and inventory, then mutate atomically. Inventory validation and consumption cannot be separate client calls. Add explicit RPC execute grants/revokes, a safe search path and direct-table denial tests.
7. If G2 enables random generation, choose rewards on the server from the approved configuration; persist the choice once per award attempt. Retries must never reroll. Do not accept client-selected weights, bonus type or quantity for a treasure award.
8. Emit only scoped, non-sensitive grant/use event metadata. Do not store coordinates or bearer QR tokens in event payloads, notification bodies or Sentry data. Use the existing event delivery pipeline without treating delivery as user acknowledgement.

### B02: use a bonus to receive target coordinates

1. Resolve the current target on the server from authenticated hunt state. Do not accept an arbitrary target profile ID from the player. Validate current target, living participation, consent, cloak, fresh position and approved game policy at activation.
2. Return only the approved disclosure: for a snapshot, suggested fields are grant/use ID, target display name, latitude, longitude, `recorded_at`, `accuracy_m`, and access expiry. These are proposed fields. Label the result “Target location at <time>” and show accuracy, not “live exact position”.
3. Define retry storage without widening access: an already spent request may retrieve its original snapshot only while the same user remains authorized under G3–G5. It must not obtain a fresh fix on every retry. Keep any stored snapshot private and short-lived according to the approved policy.
4. Do not embed exact coordinates in `game_events`; an expiring UI cannot revoke historical event copies. Clear sensitive screen/cache state on account/game change, backgrounding, expiry and invalidating hunt changes. Revalidate before showing it again. Data already seen or screenshotted cannot be recalled; disclose this limitation when choosing G4.
5. Add a small inventory/use panel in `GameScreen.js`, extracting a component if helpful. Show available, expired, used and temporarily unavailable states with reasons. Keep claims separate. On uncertain network outcome, retry the same request ID rather than starting a second consumption.
6. Coordinate text is sufficient for the first approved snapshot display. If a map preview is added, lazy-load it and show timestamp/accuracy. Do not automatically open an external maps service with target coordinates.

**Accept when:** two simultaneous uses spend once; a lost response is recoverable under the approved access window; other users/other games cannot read grants or results; cloak/stale/consent/target-change/reset cases follow approved policy; no failed eligibility check spends inventory; locked character stats remain protected.

## 8. Q02 — Scan treasure and receive a bonus

**Dependencies:** Q01's parser/scanner, B01's grant ledger, approved G1/G2/G5/G6. This is a distinct QR purpose, not a second interpretation of a join code.

**Proposed private entities/RPCs:** `treasures`, `treasure_redemptions`, `gm_create_treasure`, `gm_disable_treasure`, `redeem_treasure(g, token, request_id)`. Final signatures and names belong in the implementation migration.

1. Create treasure configuration through GM-authorized server operations: game/round scope, name, allowed reward configuration, active period, stock/redemption policy and optional approved position/radius. Ordinary event zones and play-area boundary logic must remain unchanged; do not overload a zone breach into a reward.
2. Generate an unguessable token on the server and store its hash privately. Return the plaintext only to the creating GM for QR production. Provide explicit rotation/reissue behavior instead of retaining publicly queryable plaintext. Never log tokens.
3. Suggested payload: `{"app":"larp-passport","v":1,"type":"treasure","game":"<uuid>","token":"<opaque token>"}`. Do not encode coordinates, player identity, bonus quantity or trusted reward instructions. Enforce parser limits and reject unknown versions/purposes.
4. On scan, verify the active signed-in game matches. Show a preview/claim action and call `redeem_treasure`. Membership, round, time, stock, recipient and reward selection are validated by the server. A screenshot of the QR is still a valid copy of a static bearer token; implement G6 rather than promising physical anti-cheat.
5. If G6 requires a location radius, evaluate an eligible recent server-held position and approved accuracy threshold. A client-supplied “inside” boolean is never evidence. Explain permission/stale/accuracy failures without silently changing location consent or background tracking.
6. Atomically record redemption, decrement any shared stock and create exactly one grant. Use unique constraints for the chosen per-player/global policy and the existing lock order. The same retry must return the same grant; simultaneous users competing for the final unit must not both win.
7. Scanner callbacks must not issue parallel requests. Offline scans may show the parsed code, but cannot award a bonus. Retry an uncertain request with the same request ID; do not enqueue it with location pings. Persist only what is needed for safe retry in an account/game-scoped store and remove it after resolution/logout.
8. GM UI should support print/download, disable and explicit token rotation, plus remaining stock/redemption summary. Player UI receives only the player's own result; no listing of hidden treasure positions/tokens or others' inventory.

**Accept when:** duplicate callbacks, request replay, wrong game, nonmember, disabled/expired treasure, exhausted stock, round reset and concurrent last-item redemption are covered. A rejected redemption creates no grant; retries of a successful redemption never create another.

## 9. D01 — Direction plus the existing near/far bar

**Dependencies:** approved G3/G7, and G5/B01 if direction is a consumable. Always retain current distance bands and rounded meters.

1. Extend `get_hunt_status(g)` additively, or add a narrowly scoped RPC if bonus authorization requires it. Compute direction inside the same authorization/freshness branch that permits the signal. Do not send raw target coordinates to calculate a client arrow.
2. Proposed response under `target.proximity`: `bearing_deg` (nullable, true-north reference), `direction_state`, and enough source/validity timestamps to expire the signal locally. Distinguish not enabled, unavailable, stale, cloaked and unreliable. Omit directional data for unauthorized/nonparticipant/eliminated/finished states as policy requires.
3. For an approved precise bearing, use the PostGIS geography azimuth from hunter to target, converted from radians to degrees, normalized to `[0, 360)`. Verify installed schema/function qualification. Coincident points yield no bearing. See [PostGIS ST_Azimuth](https://postgis.net/docs/ST_Azimuth.html). Apply approved sector rounding on the server if G7 selects coarse direction.
4. Update mobile `ProximitySignal` to display compass direction and signal age above/beside the existing five bars. Start with a north-referenced label/compass; do not imply the screen's top points north. Web, if it displays this player signal, should use the same north-referenced representation without assuming a heading sensor.
5. For a phone-relative arrow, use a foreground-only heading subscription from the installed `expo-location` API. When true heading is valid, rotation is `(bearing_deg - trueHeading + 360) % 360`. Never subtract magnetic heading from a true-north bearing without a valid conversion. No trustworthy heading means fall back to a cardinal label, not a made-up arrow.
6. Respect compass calibration/accuracy and approved GPS uncertainty rules. At coincident/very close or inaccurate fixes, keep the distance UI and show direction unavailable when appropriate. Do not invent a threshold that becomes an unapproved eligibility rule.
7. Smooth only visual arrow movement using shortest-angle interpolation across 359°/0°. Smoothing must not extend authorization or freshness. Stop heading listeners when the screen is hidden/backgrounded, on account/game change, or when direction is unavailable. Do not change background GPS frequency to make the arrow feel smoother.
8. Suppress a previously cached arrow when its fix expires, the target changes, cloak activates, consent is revoked or the app loses a usable current state. Preserve explicit waiting/stale/cloaked messages. Reduced-motion mode must still communicate direction without decorative rotation.

**Accept when:** cardinal/intercardinal fixtures, 359°/0° transitions, coincident points, poor compass calibration, stale positions, cloak, target changes, missing heading and background/foreground transitions behave correctly. Existing bands and claims are unchanged. Database tests prove direction is not leaked through unauthorized response branches.

**Implemented 2026-09-07** under decision G7: migration `20260907180000_hunt_direction_bearing.sql` (adds `games.direction_enabled`, `private.hunt_band_edge_m`, redefines `get_hunt_status` additively), pgTAP `006_hunt_direction.sql` (34 assertions: grants, RLS, N/E/S/W, 360→0 wrap, coincident, stale, cloak, non-participant, eliminated), dashboard **Hunter direction** control in `GameView`, mobile `src/lib/direction.js` (pure helpers with unit tests) and `DirectionSignal` in `GameScreen.js` (foreground-only `watchHeadingAsync`, true heading only, shortest-angle arrow smoothing, reduced-motion aware, local `valid_until` expiry). Not covered by automated checks: real compass behaviour, calibration states and background/foreground transitions on a device. The migration has **not** been applied to the hosted project and no APK was built.

## 10. Validation and handoff requirements

Use the repository's current CI as the command authority; it pins Node 24.16.0 and Supabase CLI 2.116.0 at this baseline. Run relevant existing tests before/after changes. Add behavior/regression tests for new state, parser, transaction and authorization boundaries; do not add snapshot tests merely to mirror styles.

| Scope | Working directory | Commands/checks |
| --- | --- | --- |
| Dashboard | `larp-dashboard` | `npm ci`, `npm test`, `npm run build` |
| Mobile | `larp-passport/mobile` | `npm ci`, `npm test`, `npx expo-doctor@1.20.4`, `npx expo export --platform android --output-dir dist-test` |
| Database changes | Repository root, local Supabase running | `supabase test db supabase/tests/database`; `python supabase/tests/concurrency.py` |
| Documentation/rules | Repository root | Update gameplay/API docs only after behavior exists; check links, proposed names and release notes |

Mobile export requires the documented `EXPO_PUBLIC_*` configuration. CI uses placeholders only to prove bundling; do not put placeholder values in a release build or print real credentials. Run SQL tests against the local disposable database by default. Hosted changes/tests require authorization covering the specific action; “all data is test data” does not mean drop/reset the hosted project.

### Minimum regression matrix

- **UI:** all six cards; small/large screens, large text, long names, keyboard, TalkBack, reduced motion, dark-theme contrast, offline/reconnect, pending actions beyond the first history page, map touch controls.
- **Existing games:** general character/event operations; start hunt; reject/confirm claim; pending GM inheritance blocks claims; cloak; boundaries; eliminate/revoke location; finish; restore; reset. Keep existing regression suites green.
- **QR:** malformed/oversized/unknown-version payloads; purpose confusion; denied camera; repeated callbacks; already-member join; active-round refusal; printed-code readability; account switch during request; no token/code leakage in logs.
- **Bonuses/treasure:** anon/nonmember/cross-game/cross-user access; expired/revoked grant; locked stats; duplicate/idempotency-key misuse; stale/absent/withdrawn GPS; target change; reset identity; restore/reopen policy; concurrency with consumption, stock, elimination and reset.
- **Direction:** server permission branches; approved precision; north/east/south/west; 0° wrap; same position; stale/poor GPS; true/magnetic mismatch; sensor absence; listener cleanup; unchanged distance bar.
- **Performance:** preserve lazy map loading and existing polling/GPS cadence; no parallel scanner submissions, accumulating listeners, full-history downloads or per-row network loops. Measure regressions before optimizing unrelated code.

### Future release sequence, when authorized

1. Finish and review the UI package independently; it should not require a database deployment.
2. For feature packages, settle the relevant decision rows, implement migrations/contracts and tests, then clients. Test compatibility with the already distributed APK: added fields/RPCs must not require old clients to understand bonuses or direction.
3. Inspect pending migration history before applying anything. Do not reapply the reliability migrations or replace all hosted functions from a historical schema dump. Use additive migrations and an explicit rollback/disable strategy; evaluate rollback effects on already granted inventory.
4. Run CI and the required manual checks. Only then publish the approved commit and deploy the web/backend changes covered by authorization. Confirm the deployed revision and migration versions.
5. Build/distribute a compatible APK when requested, especially after adding camera/native configuration. Record the APK build identity and actual device QA results. A web deployment cannot update an installed native binary.
6. Return a concise handoff: completed task IDs, changed behavior, tests/manual evidence, exact release identifiers if deployed, and remaining risks or untested cases. Leave deferred items untouched.

## 11. API reference notes for future agents

- [Expo Camera documentation](https://docs.expo.dev/versions/latest/sdk/camera/) documents the scanner component and installation workflow. The latest page currently targets a newer SDK than this repository. Confirm the SDK 53-compatible package's own types/config plugin before using any listed prop; the attempted SDK 53 documentation URL was unavailable during this review.
- [Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/) describes heading subscriptions and true/magnetic heading. Verify the installed `expo-location` version's types and cleanup contract before implementation rather than assuming the latest signature.
- [PostGIS azimuth documentation](https://postgis.net/docs/ST_Azimuth.html) defines the geography bearing convention and coincident-point behavior.
- [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) defines the contrast checks for U05. The 44-pixel web touch target in U04 is a design target, not a claim about the WCAG AA minimum.

### Copyable task starter

> Read `docs/AGENT_PLAN_UI_BONUSES_QR_DIRECTION.md` and the applicable repository instructions. Implement only task `<TASK_ID>` and its already-approved prerequisites. Inspect the current code and latest SQL definitions first. Preserve every invariant in section 3 and all existing modes. If a required gameplay decision is unresolved, explain the specific choice to the owner and continue only independent authorized work. Run the relevant tests and manual checks from the task card and section 10. Report changed files, behavior, test evidence and remaining limitations. Do not include deferred work or publish/deploy without authorization covering that action.
