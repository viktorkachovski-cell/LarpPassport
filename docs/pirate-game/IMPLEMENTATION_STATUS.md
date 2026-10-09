# Pirate game implementation status

Updated 2026-10-09. Reviewed checkout: `C:\Users\vikto\Documents\GitHub\LarpPassport`.
Review baseline: merged `main` commit `bb66945`, whose GitHub CI passed. This is source/test evidence, not an APK release record.

## Implemented

| Area | Current behavior and source |
| --- | --- |
| Schema and gameplay | Private Pirate tables, phases, pause/PvP switches, claims, compass, Parley and GM controls start in `20261007181043_pirate_game.sql`. Later definitions supersede earlier ones. |
| Riddles and hoard | `20261007184255_pirate_riddle_sites.sql`: bearing/oath riddles both pay by successful-answer rank; lighthouses only give readings; treasure is a separate secret point and its 40% value freezes once. |
| Captains and claim correction | `20261007190522_pirate_captains_and_claim_void.sql`: only the captain receives readings/band; crew resources are shared; `gm_void_claim` reverses rewards when balances permit. |
| Flexible setup | `20261008071029_pirate_flexible_setup.sql`: layout/attendance differences produce warnings; invalid geometry, missing answers/treasure/captains and zero crews block charting. A missing valid captain can be assigned later. |
| Balance correction | `20261008094234_pirate_gm_adjust.sql`: GM-only bearing/doubloon adjustments, nonnegative balance, mandatory reason, crew-visible audit event. |
| Review fixes | `20261009083530_review_parley_lifecycle.sql`: <=75 m between participants, both fixes <=120 s old and hoard exclusion rechecked on each new decision; status reads expire codes/queue disputes; repeated reports do not extend timeout; plunder retries return original amount; minimum-integer adjustments return validation errors. |
| Dashboard | Pirate setup, phase/safety controls, treasure map marker, captains, balances, site claim board/voids and active Parley disputes. Pirate games skip Hunt admin loads. |
| Android apps | One Expo project; default Pirate package `com.larppassport.app` replaces the old app, and Time Hunt package `com.larppassport.timehunt` installs beside it. Metro resolves variant screens/brands; captain-only compass tab. |

## Verification on 2026-10-09

- Dashboard: 68 Vitest tests and Vite production build.
- Mobile: 79 Jest tests, Expo Doctor 18/18 and Android exports for both variants using CI placeholder configuration. Exports are not APK/device QA.
- Local Docker Supabase: all migrations replayed from scratch; 22 pgTAP files, 480 assertions. The new regression coverage checks each Parley decision for separation, stale fixes, hoard exclusion, pause and PvP disable, plus expiry, retries and grants.
- Real-connection concurrency scripts cover Hunt consent/elimination/roster writes and Pirate captain locking, claim ranks/duplicates, void/reclaim, code joins, simultaneous confirmations/plunder retries and player/GM expiry sweeps (four Hunt races, nine Pirate races).
- Local database advisors reported no security or performance issues at warning/error level.
- Lighthouse simulator: four Python tests. Simulation cannot establish field GPS accuracy.

## Hosted state and release limits

Read-only migration-history inspection on 2026-10-09 confirmed that hosted `Passport`
(`ufcnxkowpkwayczbfnzy`) matches all 32 migrations through `20261008094234_pirate_gm_adjust`.
The new review migration is local/source work and must be applied separately to make its rules live.
Pushing GitHub `main` does not apply Supabase migrations or replace installed APKs.

The hosted backend before that corrective migration only flags >75 m separation at join,
checks GPS/hoard exclusion at open/join, and sweeps expiry during player mutations.
The revised [game guide](GAME_GUIDE.md) describes the reviewed source behavior.

No final signed APK, device boot/gameplay test, field rehearsal or exact live dashboard deployment was verified in this review.
Historical APK/build counts and security-advisor totals are omitted because they do not establish current readiness.
Remaining tools and decisions are listed once in [AGENT_PLAN.md](AGENT_PLAN.md).
