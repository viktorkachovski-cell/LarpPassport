# Handoff — UI package (U01, U02, U04, U05, U06, U07) + D01 direction

Branch `codex/ui-package-direction`, 10 commits on top of `main` (`a5c00b9`), 2026-09-07.
Nothing was pushed, deployed, applied to the hosted Supabase project, or built as an APK.

## Apply to your checkout (J:\BackEnd\LARPBackend\LarpPassport)

```powershell
# the plan doc is untracked in your tree today and the branch tracks it; move it aside first
Move-Item docs\AGENT_PLAN_UI_BONUSES_QR_DIRECTION.md _handoff\AGENT_PLAN_original.md
git fetch _handoff\larp-ui-direction.bundle codex/ui-package-direction:codex/ui-package-direction
git checkout codex/ui-package-direction
```
(`_handoff\patches\*.patch` is the same series for `git am`, if you prefer.)

## Decisions recorded (section 5 of the plan)

- **G4** = one timestamped GPS snapshot of the current target. B01/B02 (the bonus ledger that would use it) stay deferred: G1, G2, G3, G5, snapshot lifetime and target-change behaviour are still unresolved.
- **G7** = always available in opted-in hunts (per-game GM toggle `games.direction_enabled`, default off), exact true-north bearing in whole degrees, bands-only distance while on (rounded metres withheld; `distance_m` sent as the band edge so the installed APK renders nothing beyond the band). Section 3 carries the amendment note.

## Changed files (37, +2923/-473)

Dashboard: `GameView`, `GamesList`, `AuthScreen`, `HuntPanel`, `EventsPanel`, `PlayersPanel`, `CharactersPanel`, `TemplatePanel`, `MapPanel`, `styles.css`, `lib/supabase.js`; new `SyncStatus.jsx`, `TableScroll.jsx`, `lib/syncStatus.js`, `lib/draw.js`; tests for all of the above (`MapPanel.test.jsx`, `draw.test.js`, `syncStatus.test.js` new).
Mobile: `GameScreen.js`, `GamesScreen.js`, `AuthScreen.js`, `lib/theme.js`, `lib/locationTask.js`, `lib/supabase.js`; new `lib/syncStatus.js`, `lib/direction.js`, `lib/useReducedMotion.js` and tests.
Database: `supabase/migrations/20260907180000_hunt_direction_bearing.sql`, `supabase/tests/database/006_hunt_direction.sql`.
Docs: `AGENT_PLAN_UI_BONUSES_QR_DIRECTION.md` (decisions, implementation record, checklist), `TIME_HUNT_GAMEPLAY.md`, `SUPABASE_ARCHITECTURE.md`.

## Test evidence (agent sandbox)

| Scope | Result | Caveat |
| --- | --- | --- |
| Dashboard `npm ci`, `npm test`, `npm run build` | 36/36 tests (was 15), build OK | Node 22.22.2 — nodejs.org blocked from the sandbox, CI pins 24.16.0 |
| Mobile `npm ci`, `npm test`, `npx expo export --platform android` | 63/63 tests (was 38; 22 queue tests untouched and green), Hermes bundle exported | Node 22.22.2 |
| `npx expo-doctor@1.20.4` | 14/18 | the 4 failures are the checks that call `api.expo.dev` / `reactnative.directory`, both refused by the sandbox egress; no dependency was changed |
| pgTAP `supabase/tests/database/*.sql` | 179/179 (145 existing + 34 new), from a from-scratch rebuild of all 25 migrations | ran on Postgres 16 + PostGIS/pgTAP/pg_cron with a hand-built `auth`/roles shim, not the Supabase CLI 2.116.0 / PG17 image. Re-run `supabase db reset && supabase test db supabase/tests/database` locally before trusting it for release |
| `supabase/tests/concurrency.py` | 4/4 PASS | same stand-in DB (psql instead of `docker exec`), logic unchanged |
| Contrast | measured with the WCAG formula, values in the U05 commit and plan record | MapLibre attribution/marker labels over tiles not measured |

## Not done / needs you

- Device QA: TalkBack, large system text, 360/390/768 widths on hardware, reduced-motion on device, real compass (calibration states, background/foreground), airplane-mode and permission-revocation flows. None of this is claimed.
- Hosted: migration `20260907180000` is not applied; the security advisor will still show the three expected definer warnings (get_hunt_status was already definer).
- APK: no native dependency changed, but the direction UI and all UI cards need a new bundle/APK to reach phones.
- Push/CI: authorize a push (fine-grained PAT, Contents read/write) if you want GitHub CI to run the Node 24 / Supabase CLI gate on this branch.
- Deferred by decision: Q01/Q02 (QR), B01/B02 (bonuses, needs G1/G2/G3/G5).
