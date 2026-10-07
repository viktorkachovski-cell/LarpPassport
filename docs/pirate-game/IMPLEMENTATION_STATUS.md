# Pirate game implementation status

Updated 2026-10-07. Source status for `codex/pirate-game`, based on `origin/main` commit `17a1d02`. This is not a release record.

## Decisions and source of truth

- `GAME_GUIDE.md` controls phase storage in `public.games.phase` and treasure editing through `charting`, with a lock from `cursed`.
- The Pirate Android profile uses the existing `com.larppassport.app` package ID, so its APK replaces the ordinary app on a phone.
- The two exact players in a Parley independently confirm the result after the physical exchange, for both Yield and Fight. The first report moves no currency. Conflicting reports go to the GM.

## Implemented in the branch

- Twelve additive Pirate migrations: private game/site/reward/reading/Parley tables, setup and phase controls, claims, deterministic compass readings, player state, GM overview, treasure award/correction, and Parley open/join/report/plunder/GM ruling/void. Private data is exposed through scoped RPCs. Ordinary Time Hunt remains routed through its existing RPCs.
- `009`–`018` pgTAP source suites cover foundation, setup, phase, claims, compass, state, treasure, Parley confirmations, GM dispute ruling, and transfer reversal. These have **not** executed against Postgres yet.
- Dashboard Pirate tab for setup, treasure, phases, pause/PvP, crews, sites, treasure award/void, and disputed Parley ruling/void. Pirate games no longer load Hunt admin state.
- Mobile Pirate theme, Landfall/hold/compass and Parley screens, shared true-heading sensor hook, React Native SVG compass, scoped state refresh, and a `pirate` EAS profile. The app keeps the same Android package ID.
- Lighthouse placement simulator and four Python unit tests.

## Verified locally

- Dashboard: 51 Vitest tests pass; Vite production build succeeds.
- Mobile: 78 Jest tests pass; Expo Doctor previously reported 18/18 checks. Android exports with the latest Parley UI pass both with and without Hermes bytecode. These exports are not APK or device tests.
- A standalone local arm64 release APK built successfully with the Pirate theme and public Supabase configuration. APK metadata confirms `com.larppassport.app`, min SDK 24, target SDK 35, an embedded JavaScript bundle and a valid v2 signature. It is signed with the generated local Android debug certificate, so it may require removing an EAS-signed installation before installing. It has not booted on a device.
- PostgreSQL syntax parser: 31 PL/pgSQL functions across the 12 new migrations parse. This does not validate catalog references, policies, extension behavior, or transactions.
- Simulator: four Python tests pass. Its area estimates are approximate planning inputs.

## Release gates and remaining work

- Run all pgTAP suites against an isolated Postgres/PostGIS/Supabase database, including concurrent joins and transfers. No local Docker, PostgreSQL, or Supabase CLI runtime is available in this checkout. Do not apply the migrations to production as a substitute for an isolated test.
- Reconcile the hosted migration history: the hosted latest version is `20260907185433_hunt_direction_bearing`, while the repository file is `20260907180000_hunt_direction_bearing.sql`. No Pirate migration has been applied to the hosted project.
- The earlier SVG probe EAS build `cb7b5e30-94c3-45b5-b4c7-9be4e1d2cbf1` was still queued at the last check. The owner declined uploading the reviewed Pirate source to EAS, so no final EAS build was submitted. The local APK is a QA artifact; real-device boot/gameplay QA and a distribution signing plan remain.
- Complete GM correction tools for claims, balances and readings, richer ledger/claim/reading drill-down, and remaining documented edge-case and concurrency tests. Review site placement with the simulator before live setup.
- Deploy only after database tests and migration-history reconciliation, then verify the exact Vercel deployment and APK against the same backend. No Vercel deployment or production Supabase write has occurred.
