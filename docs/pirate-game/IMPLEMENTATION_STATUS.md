# Pirate game implementation status

Updated 2026-10-07. Source status for `codex/pirate-game`, based on `origin/main` commit `17a1d02`. This is not a release record.

## Decisions and source of truth

- `GAME_GUIDE.md` controls phase storage in `public.games.phase` and treasure editing through `charting`, with a lock from `cursed`.
- The mobile project builds two apps. The Pirate app (`APP_VARIANT=pirate`, the default) keeps `com.larppassport.app`, so its APK replaces the ordinary app on a phone. Time Hunt is a separate app (`APP_VARIANT=hunt`, `com.larppassport.timehunt`).
- The two exact players in a Parley independently confirm the result after the physical exchange, for both Yield and Fight. The first report moves no currency. Conflicting reports go to the GM.

## Implemented in the branch

- One additive Pirate migration (`20261007181043_pirate_game.sql`, squashed from twelve before its first hosted apply): private game/site/reward/reading/Parley tables, setup and phase controls, claims, deterministic compass readings, player state, GM overview, treasure award/correction, and Parley open/join/report/plunder/GM ruling/void. Private data is exposed through scoped RPCs. Ordinary Time Hunt remains routed through its existing RPCs.
- `009`–`019` pgTAP suites cover foundation, setup, phase, claims, compass, state, treasure, Parley confirmations, GM dispute ruling, transfer reversal, captains and claim voids. They pass in CI against a local Supabase stack.
- Captains and claim voids (`20261007190522_pirate_captains_and_claim_void.sql`): one captain per crew in `private.pirate_captains`, set by the GM with `pirate_set_captain` during setup, automatic for a one-player crew, locked at charting. Only the captain can take readings or see the distance band and reading logbook. `gm_void_claim` voids a riddle claim and reverses its shard and doubloons (refused if that would take a balance below zero).
- `supabase/tests/pirate_concurrency.py` (CI) races real connections: five crews solving one riddle, three crewmates solving one riddle, double voids, a void against a re-claim, a captain change against charting, two crews joining one Parley code and simultaneous yield confirmations.
- Dashboard Pirate tab for setup, treasure, phases, pause/PvP, crews, sites, treasure award/void, and disputed Parley ruling/void. Pirate games no longer load Hunt admin state.
- Mobile Pirate theme, chart/compass and Parley screens, shared true-heading sensor hook and React Native SVG compass. The Pirate and Time Hunt apps are separate builds: neither bundle contains the other game's screens, and each lists only its own games. EAS profiles: `preview`/`production` (Pirate), `preview-hunt`/`production-hunt` (Time Hunt).
- Lighthouse placement simulator and four Python unit tests.

- Flexible setup (`20261008120000_pirate_flexible_setup.sql`, owner decision 2026-10-08): the 5 crews / 5 bearing riddles / 4 oath riddles / 3 lighthouses layout is the event plan, not a gate. `pirate_validate` now blocks charting only for no crew, a multi-player crew without a captain, no treasure point, a riddle without an answer, overlapping sites or a non-circle lighthouse; other differences (crew and site counts, players without a crew, lighthouse distance from the treasure) come back as `warnings`. A two-player, one-lighthouse test run can start. `gm_pirate_overview` also returns each site's prompt (not its answer or oath word). pgTAP `020`.
- Dashboard: riddle prompt and answer are plain visible fields (no password field, so browsers stop autofilling credentials); choosing a registered zone loads its kind, reward and prompt for editing; readiness lists warnings separately; the saved treasure point is shown in the Pirate tab and as a GM-only marker on the map. Mobile CHART tab explains how a riddle appears, warns when location sharing is off, and has a "Check this spot" button that sends queued positions and reloads the site.

## Verified locally

- Dashboard: 58 Vitest tests pass; Vite production build succeeds. Mode-specific behaviour lives in `src/lib/gameModes.js`.
- Mobile: 78 Jest tests pass. Android exports of both apps pass after the split; the Pirate bundle contains no Time Hunt RPCs and the Time Hunt bundle contains no Pirate code or SVG. These exports are not APK or device tests.
- Before the split, a standalone local arm64 release APK built successfully with the Pirate theme and public Supabase configuration. APK metadata confirms `com.larppassport.app`, min SDK 24, target SDK 35, an embedded JavaScript bundle and a valid v2 signature. It is signed with the generated local Android debug certificate, so it may require removing an EAS-signed installation before installing. It has not booted on a device.
- Simulator: four Python tests pass. Its area estimates are approximate planning inputs.

## Fixed after review

- `get_pirate_state` omitted the `yielded` Parley state, so after the target chose Yield neither player could confirm the result and the session could only time out to a GM dispute. The state is now returned; `018` asserts it. All three "Parley still in play" checks now share `private.pirate_parley_live`.
- The first CI run of the Pirate suites found runtime SQL errors (`pg_catalog.coalesce`/`least` calls and PL/pgSQL names clashing with columns). Fixed; all suites pass.
- Dashboard: Parley disputes counted as "zone triggers to confirm" in the Events queue. They are now listed as Parley disputes and ruled on in the Pirate tab.

## Hosted database (2026-10-07)

- Applied to the hosted `Passport` project: `20261007180447_shared_hunt_helpers_and_ping_cleanup`, `20261007180536_inline_hunt_claim_resolution` and `20261007181043_pirate_game`. Repository file names match the hosted versions, including `20260907185433_hunt_direction_bearing`.
- `20261007184255_pirate_riddle_sites` applied to hosted `Passport` the same day (v3.3 site layout, riddle doubloons, frozen treasure value). The existing "Pirate Test" game's template no longer has Hit points.
- `20261007190522_pirate_captains_and_claim_void` applied to hosted `Passport` the same day; `pirate_captains` has RLS with client denial and `anon` cannot execute the two new RPCs.
- Security advisor: callable `SECURITY DEFINER` warnings went from 17 to 40, exactly the 23 new Pirate RPCs. All nine Pirate tables have RLS with client denial; `anon` cannot execute Pirate RPCs; Realtime still publishes five tables.

## Release gates and remaining work

- The owner changed the event scope on 2026-10-07 to five crews of up to four, 5 shard riddles, 4 oath riddles, 3 reading-only lighthouses, no caches or Safe Harbour zones, and a separate treasure point (13 physical locations). All nine riddles pay doubloons 20 / 15 / 10 / 5 / 5 by order of correct answers; shard and oath rewards remain distinct. The treasure value is 40% of the highest pre-treasure crew balance, rounded to a whole doubloon and frozen at the first `hoard` opening. Implemented in `20261007184255_pirate_riddle_sites` (riddle and lighthouse kinds only; the treasure is the GM-set secret point, per the owner's instruction to drop the `treasure` site kind), with dashboard and mobile updates and pgTAP `013`/`017`. New games no longer get a Hit points stat.
- The earlier SVG probe EAS build `cb7b5e30-94c3-45b5-b4c7-9be4e1d2cbf1` was still queued at the last check. The owner declined uploading the reviewed Pirate source to EAS, so no final EAS build was submitted. The local APK is a QA artifact; real-device boot/gameplay QA and a distribution signing plan remain.
- Remaining GM correction tools from guide 7.6 (`gm_adjust`, `gm_claim_for`, `gm_void_reading`, `gm_set_mercy`) and a way to replace a captain after charting (for example a dead phone), richer ledger/claim/reading drill-down, and remaining documented edge-case and concurrency tests. Review site placement with the simulator before live setup.
- Verify the Vercel deployment from `main` and the rebuilt Pirate APK against the hosted backend, then run the field rehearsal (AGENT_PLAN section 11).
