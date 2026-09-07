# LARP Passport — staff engineering review

Reviewed 7 September 2026. Source baseline: `dc504889b5ce0cb9b4e02532ed4a810c1e01ab05` on `main`.

## Approved implementation follow-up

The owner approved completing F01-F12, pushing to main and deploying Supabase/Vercel. The recommended delayed-GPS policy is included. UI/theme/features and the APK rebuild are deferred.

Local implementation now includes owned GPS sessions and queues, serialized notification delivery with a separate database delivery cursor, reconnect/foreground snapshots, an independent pending-action query, history pagination, retry states, chronology/round/consent guards, and compatible dependency patches. The original review below is retained as the baseline; its "Remaining" labels describe the initial review, not the implementation follow-up.

Validation is in progress. Hosted migration compilation was blocked by automatic approval review; the full migration history will be verified in disposable GitHub CI before hosted deployment.

## Recommendation

Keep the React/Vite dashboard, Expo Android app, and Supabase architecture. Repair the permission and synchronization defects before a real game. A rewrite, another backend service, broad database tuning, or a new game mode is not justified by the evidence collected.

This is an approval-stage review, not a declaration that the entire release is ready. Several small fixes are prepared and tested locally. The remaining repairs below are still required. Nothing has been pushed, deployed, or persistently changed in Supabase.

The user confirmed that existing database data is test data. No existing game was reset or deleted. Database regression fixtures and a temporary function replacement were tested in transactions and rolled back. Sequence counters may have advanced.

## Verified running state

- Supabase project `Passport` (`ufcnxkowpkwayczbfnzy`) reports `ACTIVE_HEALTHY`.
- The production Vercel alias serves the same commit as the reviewed GitHub `main`; the deployment reports `READY`. A newer preview exists, so “latest deployment” alone is not a reliable production check.
- All inspected application tables in `public` and `private` have RLS. The sixteen public security-definer RPCs have an empty search path and no anonymous execute permission. Their authenticated-execution advisor warnings are expected API boundaries, not sixteen independently confirmed vulnerabilities. See [Supabase's explanation](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- Four retention jobs are enabled. Table statistics show a very small test dataset, not a representative live workload. They cannot establish 100-player capacity or justify deleting “unused” indexes.
- Supabase has 22 applied migrations; the original checkout had 18. The four missing migration files have been recovered from hosted migration history into the local patch.
- Existing GitHub CI passed on the baseline commit: [CI run](https://github.com/viktorkachovski-cell/LarpPassport/actions/runs/29474800901).

## Required work list

“Prepared” means a local patch exists. “Remaining” means identified work still needs implementation and verification. P1 items should be resolved before a real game; P2 items are important reliability or maintenance work.

| ID | Priority | Finding and consequence | Status / required action |
| --- | --- | --- | --- |
| F01 | P1 | Players can reset GM-controlled stats to their template defaults. Example: GM sets HP to 3; the player submits HP 10, its default, and the database accepts it despite `player_editable: false`. Removing HP from the submitted JSON also restores the default. | **Prepared and reproduced.** A new migration rejects changes to existing locked fields while retaining defaults on creation and for newly added template fields. Ten regression checks cover numeric/text defaults, omissions, editable notes, GM edits, and template evolution. |
| F02 | P1 | Device tracking is global, but game screens treat it as game-specific. Opening game B while tracking A can show sharing enabled in B, and stopping from B stops A. Signing out does not stop tracking. Queued rows contain a game ID but no account ID, so account switching creates a risk of uploading a previous account's queued fixes under the next account if it also has membership and consent. | **Remaining.** Bind the tracking owner, queue, in-flight requests, and status to both account and game. Stop and reconcile tracking on sign-out/account changes; ensure an old response cannot stop a new session. Add account-switch, game-switch, and in-flight-stop tests. Native execution has not reproduced this yet; the ownership gap is visible in code. |
| F03 | P1 | Notifications use one device-wide highest event sequence. An older event made player-visible after a newer event was seen is skipped; two concurrent notification paths can both read the same cursor and issue duplicates. Initial event loading also advances the cursor for events not actually opened by the player. | **Remaining.** Separate event delivery from read acknowledgement, scope state to account/game, serialize deduplication, and handle late visibility changes. Test GM confirmation after newer messages, concurrent Realtime/background delivery, reconnection, and account changes. Merely adding push notifications would not repair this. |
| F04 | P1 | Game screens do not fully recover missed state. The dashboard relies on live callbacks after its initial load and has no snapshot refresh on reconnect. Mobile foreground recovery refreshes hunt state, but not missed character/event/game updates. The dashboard's hunt refresh does not synchronize the game-status selector. | **Remaining.** Add authoritative snapshot recovery on reconnect/foreground/manual refresh, with stale-request protection. Refresh readiness from members and characters too. Keep lightweight live updates, but do not treat a restored socket as proof that missed changes were replayed. |
| F05 | P1 | The dashboard derives pending work only from its latest 200 events, later capped at 300. An unresolved trigger can disappear from the pending list as unrelated events arrive. | **Remaining.** Load unresolved events independently of recent history, retain them until resolved, and paginate history. Test an old pending breach with more than 300 newer events. |
| F06 | P1 | Boundary ingestion loops oldest-first and stops evaluating after 50 recent samples, despite documentation saying newest 50. Samples from earlier batches or before the current round are not excluded by a last-evaluated/round-start guard. A delayed exit can reject a currently pending claim without comparing the claim's creation time with the sampled exit. | **Game decision required; unchanged.** Agree on delayed-evidence policy, then add chronology, round-reset, backlog, and simultaneous claim/boundary tests before changing this function. The order/cap mismatch was also verified in the hosted function definition. |
| F07 | P2 | The mobile sharing switch ignores Supabase's returned error objects. It can show sharing as enabled after consent failed, or conceal failed revocation. Its text also claimed elimination deletes history immediately, although only the latest position is deleted immediately. | **Prepared.** Check RPC results, roll consent back after failed native startup, stop local GPS before attempting revocation, report remaining server-consent uncertainty, provide a retry action, and correct retention wording. Six unit tests pass. Broader tracking ownership remains F02. |
| F08 | P2 | GM map/player “last seen” uses upload time (`updated_at`), making old fixes uploaded from an offline queue appear fresh. | **Prepared.** Use GPS sample time (`recorded_at`) for age and staleness. Added an offline-backlog regression test. |
| F09 | P2 | Repository and hosted migration history differ. A clean database rebuilt from GitHub would lack deployed indexes and default function-permission hardening. | **Prepared.** Recover the four exact existing migrations. These must be recognized as already applied during deployment; do not reapply them as new migrations. Run a clean-stack CI build with the complete history. |
| F10 | P2 | The map library is included in the initial JavaScript and instantiated before its tab is opened. This adds unnecessary download/initialization work and can initialize a map in a hidden container. | **Prepared.** Defer map loading until first use, preserve it across tab switches, resize when shown, and contain map initialization/loading errors so Hunt remains usable. Initial compressed JS falls from 338.98 KB to 120.10 KB, about **65%**. This measures bundle delivery, not a claimed frame-rate or battery improvement. |
| F11 | P2 | Several loads treat failures as empty data. Mobile can remain on “SYNCING FIELD DATA...” after a failed game load; a failed character read is treated as no character. Game lists silently appear empty on failures. | **Remaining.** Distinguish loading, empty, permission denied, and offline states; provide retry/back controls and do not start character creation after a failed read. Add request-failure tests. |
| F12 | P2 | Dependency advisory checks are not clean. The dashboard reports three high-severity affected packages; mobile reports 25 affected packages, including 12 high and 13 moderate. Several reports propagate through build tooling and do not demonstrate an exploitable installed-player app. | **Remaining.** Triage reachable paths and apply compatible transitive fixes. Separate any Expo/React Native major upgrade from these gameplay repairs and require native GPS validation. Do not use an unreviewed forced audit upgrade. |

Key evidence locations:

- F01: [existing validator](../supabase/migrations/20260715201551_account_deletion_fk_repair.sql), [proposed migration](../supabase/migrations/20260907144947_prevent_player_reset_of_locked_stats.sql), [regression tests](../supabase/tests/database/004_locked_character_fields.sql).
- F02/F03: [location task](../larp-passport/mobile/src/lib/locationTask.js), especially `startSharing`, `stopSharing`, `isSharing`, `notifyEvents`, and `markSeenUpTo`; [queue schema](../larp-passport/mobile/src/lib/pingStore.js); [sign-out](../larp-passport/mobile/src/screens/GamesScreen.js).
- F04/F05: [dashboard game view](../larp-dashboard/src/components/GameView.jsx); [mobile game screen](../larp-passport/mobile/src/screens/GameScreen.js). Realtime delete filtering/old-row limitations also require care when reconciling positions: [Supabase documentation](https://supabase.com/docs/guides/realtime/postgres-changes).
- F06: [ping ingestion and zone evaluation](../supabase/migrations/20260715201125_harden_ping_ingest_and_boundary.sql).
- F12: current `npm audit --json` results from both locked dependency trees. Dashboard examples: [Browserslist](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [Nano ID](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp). No dependency versions were changed during this pass.

## Rules and concurrency decisions

Recommended boundary policy for F06: evaluate the newest 50 eligible fixes in chronological order; do not move boundary state backward; do not use a previous round's fixes for the new round; do not automatically cancel a claim created after the recorded exit. Preserve historical evidence for GM review. This changes edge-case adjudication and needs an explicit decision.

The current implementation also blocks **every** new elimination claim while any inherited target awaits GM assignment, and rejects other pending claims after a confirmation. Preserve that behavior unless the game owner explicitly wants independent hunts to continue during assignment. It is a rules choice, not an optimization.

Before release, add adversarial tests for simultaneous consent revocation/ingestion, elimination/ingestion, and start/roster changes. The code uses a per-game lock for hunt mutations, while ingestion and consent use different paths. These are test gaps and plausible race risks, not races reproduced by the sequential suites in this review. Also verify that eliminated participants cannot resume server-side sharing before GM restoration.

## UI recommendations

1. Show actual connection and synchronization state. Replace decorative “UPLINK”/“TRANSMITTING” assurances with distinct connected, queued offline, permission missing, and stale-GPS states. Display the age of the last successful response and pending queue count.
2. Put incoming elimination confirmations, pending GM assignments, and breaches above routine activity. Keep action outcomes visible until acknowledged; avoid short-lived error messages for consequential operations.
3. Add a GM readiness checklist: player/character coverage, consent, recent fixes, configured play area, and installed app version where available. Explain disabled actions, including roster/status locks during an active hunt.
4. Increase essential mobile text from the current frequent 8–11 px labels. Aim for 14–16 logical pixels for operational reading, reserve small monospace text for optional decoration, and use 48-unit touch targets on native controls. For web touch controls, 44 CSS pixels is a useful enhanced accessibility target, not the WCAG AA minimum. [W3C guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html).
5. Associate web labels with inputs, add accessible names to icon actions, preserve visible focus, support reduced motion, and use status text/icons alongside color. Verify text contrast against [WCAG contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
6. Make GM tables usable on narrow screens through cards or explicit horizontal scrolling. Give map drawing a visible “Finish polygon” button and undo-last-point control for touch use.
7. Keep plain operational labels alongside fiction: “Games,” “Sign out,” “Location sharing,” and “Message GM” are easier to understand under field pressure.
8. Add password recovery and verify confirmation/deep-link destinations. The repository says hosted Auth URL configuration needed attention; its current setting was not independently verified.

These changes should preserve current RPCs, secret-target visibility, victim confirmation, GM overrides, and both the general character/event workflow and Time Hunt.

## Theme recommendation: Temporal Field Authority

Keep and refine the existing theme. It already fits a time-travel hunt and is shared across both clients; a cosmetic rewrite would spend effort without fixing the larger field-usability problems.

| Element | Android player app | Vercel GM dashboard |
| --- | --- | --- |
| Identity | Personal field passport | GM command console |
| Layout | One primary decision per screen; target, signal age, and confirmation state prominent | Map/roster workspace with a persistent pending-action queue |
| Palette | Existing midnight navy, readable off-white, cyan navigation, amber warnings, red danger | Same tokens; quieter surfaces and dense but readable lists |
| Typography | IBM Plex Sans for reading; Chakra Petch headings; monospace only for timing/IDs | Same fonts with consistent hierarchy and larger form labels |
| Daylight option | Optional high-contrast light preset for outdoor use | Optional light preset for bright venues |
| Motion | Minimal, reduced-motion aware; no perpetual decorative effects needed | Reserved for changes that need attention |

Existing palette: background `#0A0E15`, panel `#131A26`, text `#EDF2FA`, cyan `#47D6F0`, amber `#FFB020`, red `#FF5449`. Keep claims clearly labeled and confirmed; color alone must not communicate who is eliminated or whether an action succeeded.

For games outside the time-travel fiction, allow presentation presets and neutral terminology without altering their mechanics or deleting existing controls.

## Additive game improvements

| Suggestion | Benefit | Rule impact |
| --- | --- | --- |
| QR join using the existing join code | Faster check-in, fewer typing errors | None if existing membership/rate-limit checks remain |
| Pre-game phone/readiness check | Finds missing permissions and stale GPS before the start | Advisory only; do not silently add new start restrictions |
| Offline rules/safety/contact card | Players can reach instructions without a connection | None; claims remain online as today |
| GM game/template duplication | Reuse setup without copying player identity, consent, or hunt state | None |
| GM-only post-game timeline export | Review disputes and improve the next event before retention purges records | No scoring change; preserve access controls |
| Better dispute reporting through the existing GM message channel | Clearer recovery without changing victim confirmation | None |

Pause/resume, automatic target inheritance, different cloak durations, scoring, revives, teams, spectator location, and offline elimination are separate mechanics proposals. Do not include them in a reliability patch without explicit rules approval.

## Validation and remaining release gates

Completed on the prepared patch:

- Dashboard: **11/11 tests passed**, production build passed.
- Mobile: **28/28 tests passed**, Android bundle export passed with placeholder configuration, Expo Doctor **18/18 checks passed**.
- Database: **130/130 assertions passed** with the proposed validator inside rollback transactions: 42 architecture/RLS, 66 hunt, 12 boundary, 10 new locked-stat checks.
- Before/after proof: four checks in the new stat suite fail on the existing hosted function and all ten pass with the proposed fix.
- Verified afterward that the latest hosted migration is still `20260725181349`, the proposed validator is not installed, and the specifically checked test users are absent.
- Public production login screen was inspected. A sign-in using the browser's filled credentials failed; authenticated browser flows were not verified. No credentials were changed.

Still required before publishing a complete repair release:

1. Implement and test remaining required findings; obtain the boundary-rule decision.
2. Run the full migration history against a clean disposable Supabase stack. Docker/Postgres tooling was not available locally, so hosted rollback tests do not replace this clean-install gate.
3. Verify representative authenticated dashboard workflows in the browser, including map visibility/resizing and reconnect recovery.
4. Run native Android tests on at least two physical phones: screen off, permission denial/revocation, airplane mode/recovery, account/game switching, and a complete claim/reject/confirm/restore rehearsal. An exported bundle does not prove background GPS behavior.
5. Triage the dependency advisories, verify hosted Auth URLs, and confirm required CI checks on the exact final commit. Pin release tool versions deliberately and align supported Node environments rather than upgrading incidentally.
6. After the user's publishing approval, recheck `main`, integrate the tested patch, recognize recovered migrations as already applied, apply only genuinely new reviewed migrations, and deploy the exact approved revision to Vercel.
7. Build/distribute a matching Android APK through EAS if mobile fixes are to reach players. Vercel/Supabase deployment does not update an installed app. Record commit, migration, app/build version, and APK checksum; run post-deployment smoke tests.

No broad database reset, blanket index removal, architecture replacement, or forced framework upgrade is part of the recommendation.
