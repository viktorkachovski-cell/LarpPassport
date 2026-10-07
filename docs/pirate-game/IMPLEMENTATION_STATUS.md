# Pirate game implementation status

Updated 2026-10-07. This is source status for the `codex/pirate-game` branch, not a release record.

## Implemented in this branch

- Imported the game guide and agent plan. Reconciled phase storage, treasure edit lock, three Safe Harbours and the replacement APK decision with the owner; removed stale duplicate naming and conflicting treasure instructions.
- Added an additive Supabase foundation migration: nullable `games.phase`, a private Pirate mode marker, direct client denial, and a serialized guard that prevents Pirate and Time Hunt state from coexisting. Added 13 pgTAP assertions; database execution is pending a Docker-backed CI run. The migration file was created manually because the Supabase CLI is unavailable on this machine.
- Added the stdlib lighthouse placement simulator (`tools/pirate/simulate_triangulation.py`). It samples arc intersections at every shard level and flags weak crossing angles and distance outliers. Four unit tests pass. Its area figures depend on the grid, search radius and simulation seed; they are for site planning, not exact game readings.
- Added a bundle-time Pirate colour palette and a dedicated internal APK profile using the existing Android package ID. The ordinary build defaults to the existing palette. `pirate` reads the production EAS environment and sets `EXPO_PUBLIC_APP_THEME=pirate`.

## Remaining implementation

The foundation migration is only the first part of P-DB1. Pirate site, claim, ledger, compass, Parley, correction and award tables and all Pirate RPCs remain to be built. The dashboard and Pirate mobile screens are not yet implemented. `react-native-svg` is not installed and no APK has been built or tested on a device. No migration has been applied to a hosted project and no Vercel deployment has occurred.

Read-only inspection of the hosted `Passport` project found the latest migration version is `20260907185433_hunt_direction_bearing`. The repository file is named `20260907180000_hunt_direction_bearing.sql`; reconcile that history mismatch before any database push. Run the database pgTAP suite and concurrency checks on the exact commit, then verify Vercel and EAS environment identities before release. Preserve the existing Time Hunt, location queue and event delivery behaviour while adding Pirate paths.

## Verification in this checkout

- Simulator: 4 unit tests passed.
- Pirate colour contrast: key text colours exceed 4.5:1 and border colours exceed 3:1 against both main dark surfaces by calculated WCAG ratios.
- Mobile Jest: 41 passed, 22 failed because `better-sqlite3` had no native binding after an offline install with scripts disabled. Rebuild was blocked by local `spawn EPERM`.
- Android export: the Pirate bundle exported successfully with one Metro worker and `--no-bytecode`. The normal Hermes bytecode step hit local `spawn EPERM`. The debug export is not an APK or device result.
