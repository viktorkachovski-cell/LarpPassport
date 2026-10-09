# Time Hunt backlog: invariants and deferred features

Carried over from the September 2026 UI/bonus/QR/direction brief. The UI package (U01–U07) and direction (D01) are implemented and documented in [TIME_HUNT_GAMEPLAY.md](TIME_HUNT_GAMEPLAY.md); the git history keeps the original brief. What remains here: the invariants every change must preserve, and the features that still wait on owner decisions. **Nothing below the invariants is approved for implementation.**

## 1. Invariants: preserve these in every task

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

## 2. Gameplay decisions required before dependent feature work

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

## 3. Q01 — QR scanning to join a game

**Existing:** `GamesScreen.js` already joins by typed code using `join_game(code)`; the dashboard's `useGameData.js` retrieves the GM's code using `gm_get_join_code(g)`. No camera package or app link scheme is configured.

**Proposed additions:** `M/src/components/QrScanner.js`, `M/src/lib/qrPayload.js`, and a small dashboard QR display component. These paths are proposals; create them only during implementation.

1. Define one versioned, bounded QR format, with distinct purposes. Suggested join payload: `{"app":"larp-passport","v":1,"type":"join","code":"<existing join code>"}`. Validate the exact shape, field types, supported version, allowed purpose and length; reuse the existing server's join-code validation. Do not accept arbitrary JSON actions or automatically open URLs.
2. Share the parser contract and test fixtures between join and treasure scanning. Start with the in-app scanner. An external camera opening the app requires separate deep-link handling and native configuration; it is not required for basic QR joining and must not pull deferred password-recovery work into scope.
3. Show **Join by QR** beside the existing manual code entry. Request camera permission only after that action. Handle denial, permanent denial, no camera, cancellation and returning from settings. Keep manual join available.
4. Install the Expo-compatible camera version through `npx expo install expo-camera`, checking SDK 53 compatibility and the lockfile. Do not copy the latest SDK package version or upgrade Expo to add scanning. Configure QR scanning only, no photo upload/storage or unnecessary microphone permission.
5. Permit only one scan submission in flight. Unmount the camera when leaving the screen/backgrounding or after a valid scan. Pause scanning while showing the preview/result. Let the user confirm joining, then call the existing join RPC and refresh membership through the normal successful-join path.
6. Handle invalid/unsupported codes, already joined, active-round roster lock, expired/changed code, rate limit, network timeout and account switch. Never report membership success from parsing alone. Keep scanned join codes out of analytics, error logs and public events.
7. In the authenticated GM dashboard, render the current code as a downloadable/printable QR with game name and readable manual code. Generate locally using a compatible, small QR library; do not send join codes to a third-party QR image service. Preserve the existing privilege boundary.

**Accept when:** a printed or second-screen QR joins through the exact same authorization path as typed entry; invalid codes cause no mutation; repeated camera callbacks do not repeat joins; camera denial leaves manual entry working. Test on the native Android build. A newly added native camera dependency requires a new APK; the APK the owner just rebuilt cannot be assumed to contain it.

## 4. B01/B02 — Bonus generation and target-coordinate reward

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
5. Add a small inventory/use panel in `src/screens/GameScreen.hunt.js`, extracting a component if helpful. Show available, expired, used and temporarily unavailable states with reasons. Keep claims separate. On uncertain network outcome, retry the same request ID rather than starting a second consumption.
6. Coordinate text is sufficient for the first approved snapshot display. If a map preview is added, lazy-load it and show timestamp/accuracy. Do not automatically open an external maps service with target coordinates.

**Accept when:** two simultaneous uses spend once; a lost response is recoverable under the approved access window; other users/other games cannot read grants or results; cloak/stale/consent/target-change/reset cases follow approved policy; no failed eligibility check spends inventory; locked character stats remain protected.

## 5. Q02 — Scan treasure and receive a bonus

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

## 6. Validation and handoff requirements

Use the repository's current CI as the command authority; it pins Node 24.16.0 and Supabase CLI 2.116.0 at this baseline. Run relevant existing tests before/after changes. Add behavior/regression tests for new state, parser, transaction and authorization boundaries; do not add snapshot tests merely to mirror styles.

| Scope | Working directory | Commands/checks |
| --- | --- | --- |
| Dashboard | `larp-dashboard` | `npm ci`, `npm test`, `npm run build` |
| Mobile | `larp-passport/mobile` | `npm ci`, `npm test`, `npx expo-doctor@1.20.4`, `APP_VARIANT=hunt npx expo export --platform android --output-dir dist-test/hunt` |
| Database changes | Repository root, local Supabase running | `supabase test db supabase/tests/database`; `python supabase/tests/concurrency.py` |
| Documentation/rules | Repository root | Update gameplay/API docs only after behavior exists; check links, proposed names and release notes |

Mobile export requires the documented `EXPO_PUBLIC_*` configuration. CI uses placeholders only to prove bundling; do not put placeholder values in a release build or print real credentials. Run SQL tests against the local disposable database by default. Hosted changes/tests require authorization covering the specific action; “all data is test data” does not mean drop/reset the hosted project.

### Minimum regression matrix

- **Existing games:** general character/event operations; start hunt; reject/confirm claim; pending GM inheritance blocks claims; cloak; boundaries; eliminate/revoke location; finish; restore; reset. Keep existing regression suites green.
- **QR:** malformed/oversized/unknown-version payloads; purpose confusion; denied camera; repeated callbacks; already-member join; active-round refusal; printed-code readability; account switch during request; no token/code leakage in logs.
- **Bonuses/treasure:** anon/nonmember/cross-game/cross-user access; expired/revoked grant; locked stats; duplicate/idempotency-key misuse; stale/absent/withdrawn GPS; target change; reset identity; restore/reopen policy; concurrency with consumption, stock, elimination and reset.
- **Direction:** server permission branches; approved precision; north/east/south/west; 0° wrap; same position; stale/poor GPS; true/magnetic mismatch; sensor absence; listener cleanup; unchanged distance bar.
- **Performance:** preserve lazy map loading and existing polling/GPS cadence; no parallel scanner submissions, accumulating listeners, full-history downloads or per-row network loops. Measure regressions before optimizing unrelated code.

### Future release sequence, when authorized

1. For feature packages, settle the relevant decision rows, implement migrations/contracts and tests, then clients. Test compatibility with the already distributed APK: added fields/RPCs must not require old clients to understand bonuses or direction.
2. Inspect pending migration history before applying anything. Do not reapply the reliability migrations or replace all hosted functions from a historical schema dump. Use additive migrations and an explicit rollback/disable strategy; evaluate rollback effects on already granted inventory.
3. Run CI and the required manual checks. Only then publish the approved commit and deploy the web/backend changes covered by authorization. Confirm the deployed revision and migration versions.
4. Build/distribute a compatible APK when requested, especially after adding camera/native configuration. Record the APK build identity and actual device QA results. A web deployment cannot update an installed native binary.
5. Return a concise handoff: completed task IDs, changed behavior, tests/manual evidence, exact release identifiers if deployed, and remaining risks or untested cases. Leave deferred items untouched.

## 7. API reference notes for future agents

- [Expo Camera documentation](https://docs.expo.dev/versions/latest/sdk/camera/) documents the scanner component and installation workflow. The latest page currently targets a newer SDK than this repository. Confirm the SDK 53-compatible package's own types/config plugin before using any listed prop; the attempted SDK 53 documentation URL was unavailable during this review.
- [Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/) describes heading subscriptions and true/magnetic heading. Verify the installed `expo-location` version's types and cleanup contract before implementation rather than assuming the latest signature.
- [PostGIS azimuth documentation](https://postgis.net/docs/ST_Azimuth.html) defines the geography bearing convention and coincident-point behavior.
