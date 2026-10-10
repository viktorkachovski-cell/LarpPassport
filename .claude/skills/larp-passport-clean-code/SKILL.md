---
name: larp-passport-clean-code
description: >-
  Anti-bloat rules for LarpPassport code, distilled from the October 2026
  cleanup review (PR 11, net -626 lines): the complexity, nesting and
  file-size limits, the duplication and dead-code patterns that review
  removed, how to keep tests and comments lean, and a script that measures all
  of it. Use this WHENEVER writing or refactoring code in larp-dashboard
  (React/Vite) or larp-passport/mobile (Expo), or editing their JS or pgTAP
  tests, and always for clean up, refactor, split this file, simplify, remove
  dead code, trim the tests, find duplicates or code review requests. Trigger
  even when the request only says "tidy this", "make it shorter" or "this
  component is getting big", or asks for a new panel, tab, GM control, RPC
  call or test without mentioning cleanliness. The user treats net line growth
  from a cleanup as a regression.
---

# LarpPassport — Lean Code

The user reviews every change for maintainability. A cleanup that leaves more
lines than it found is a regression, and new features shouldn't create the
next cleanup. This skill records what bloat looked like in this repo and the
fixes that worked, so new code starts lean.

## Limits

These apply to app and shared source: `larp-dashboard/src`,
`larp-passport/mobile/src`, and the root `.js` files of both apps.

- Cyclomatic complexity ≤ 15 per function, nesting ≤ 4.
- ≤ 400 non-blank, non-comment lines per file.
- No debug `console.*`. Sanitize warn/error output, because Sentry records
  console output as breadcrumbs and has no scrubber (both apps only set
  `sendDefaultPii: false`). Lint can't see PII such as names, emails,
  positions, join codes or tokens.
- Split by responsibility, not to hit a number. A 380-line file with one job
  is fine. A 200-line component that loads data, renders and writes is not.

The repo deliberately has no ESLint config. Measure from a scratch directory
with the bundled script, and never add lint tooling or config to the repo
unless asked:

    sh <this-skill>/scripts/measure.sh <repo-root> <scratch-dir>

It installs pinned eslint and jscpd into the scratch directory on first run.
It then prints every limit violation as `file:line: [rule] message`, and
every copy-pasted block of 40+ tokens within each app, outside tests. Run it
before you start and again at the end. The duplicate list must not grow.

## Patterns that bloated this codebase

Each of these showed up several times before the review. Look for the shared
version before writing a new one.

- **Copy-pasted form fields.** The Pirate GM forms had about ten hand-rolled
  reason inputs and crew pickers. Use `Reason`, `CrewSelect` and
  `validReason` from `larp-dashboard/src/components/pirateCommon.jsx`. On
  mobile, check `src/pirate/ui.js` and `src/ui/primitives.js` first. Take
  `TouchableOpacity` and `MotionScrollView` from `src/ui/presentation.js`
  instead of `react-native`, and use its `screenStyles` where neighboring
  files do. Metro swaps in the motion-aware `presentation.pirate.js` for the
  Black Tide build, while Time Hunt keeps the native controls.
- **One handler per field.** The zone editor had ten near-identical
  `onChange` handlers. One factory replaced them:
  `const set = (key) => (e) => setEditing({ ...editing, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })`.
- **If-chains that map a status to text or UI.** Use a lookup table, such as
  `CLAIM_MESSAGES`, `STATUS_TEXT`, `STEP_TEXT`, `PHASE_CHIPS`, or a
  kind-to-component map like `DETAILS` in `PirateHistory.jsx`. Make the value
  a function when the text needs data. Tables are also what keep complexity
  under 15.
- **Repeated screen scaffolding.** The GM-only notice, error banner and scroll
  container were copied into each Pirate tab. `TabPage` in `pirate/ui.js`
  owns them now.
- **God components.** Split them into three parts: a data hook, small
  presentational pieces, and a parent that owns state and writes. The data
  hook is like `useGameData`, which keeps the loading, Realtime,
  stale-request guards and invalidate-on-write together. Keep the state
  owner where it is: Sites and Compass stay one `PiratePanel` instance so a
  half-typed answer survives a tab switch.
- **Two names for one fact.** `canOpen` and `canJoin` were identical, and a
  Parley phase list was a hand copy of `COMPASS_PHASES`. Derive from the
  single source, because copies drift.
- **Dead options.** These included a `scrollTabs` mode no caller passed, an
  `active` prop that was always true, and a `members` prop nobody read.
  Delete them, and grep the callers before adding an option "for later".
- **Truthy strings in React Native.** `{code && <View/>}` renders `''` as
  bare text and crashes the screen. Write `{!!code && …}` or use a ternary.

## Comments

- State the current *why* in a line or two, at the file's existing density.
- Leave out history ("used to", "older server versions", "proposal allows
  500–1000"). Leave out brief or ticket tags like `(U01)` unless the document
  they point to is live. Git holds the history.
- When behavior changes, fix every comment that described the old behavior.
  The worst stale comment found still said the server rejects whole batches,
  months after `ingest_pings` started skipping bad points one at a time.

## Tests

- Build tiny factories so each test reads as its difference from a default:
  `player()`, `claim()` and `mount()` in `HuntPanel.test.jsx`, and
  `queryBuilder` in `GameView.test.jsx`.
- Merge tests that assert the same behavior. Restore spies in
  `afterEach(() => vi.restoreAllMocks())` instead of try/finally.
- pgTAP: put repeated setup in `pg_temp` functions. Drive repeated refusal
  checks from a plpgsql function that `returns setof text` and calls
  `return next extensions.is(...)` once per case. The reference
  implementation is `supabase/tests/database/022_pirate_parley_lifecycle.sql`,
  which went from 533 to 186 lines with the same 73 checks in the same order.
  Keep `plan(N)` exact and the file transactional.
- Never cut the ping-queue invariant tests (see larp-passport-mobile), grant
  and security checks, or "X no longer exists" checks that actually guard a
  constraint or an overload.
- pgTAP and the Python race scripts need Docker, and the Python scripts also
  need Python. Neither is on the user's Windows machine. When you can't run
  them, say that CI is their only verification.

## Leave alone unless the user approves

- **Lookalike code across the two apps** (`time.js`, `syncStatus.js`,
  `config.js`, `useNow`). They are separate npm packages, so don't add
  cross-imports.
- **Merges that move pixels.** Mobile `AuthScreen`'s own `Field` differs from
  the shared one by 1px, so merging them is a theme change.
- **Game logic, RPC contracts, applied migrations, and the ping-queue error
  classification.** Propose the change with code and implement it only after
  a yes.

## Don't trade clarity for lines

Fewer lines is the goal only while the code stays obvious. The review
reverted an ASI-guarded destructuring swap back to a temp variable, and kept
a named function instead of inlining it. One clear name beats a clever
expression.

## Before you finish

1. `measure.sh` reports no violations, and its duplicate list is no longer
   than when you started.
2. Dashboard: run `npm test` and `npm run build`. Mobile: run `npm test`,
   then `APP_VARIANT=pirate npx expo export --platform android --output-dir dist-test/pirate`,
   then the same with `APP_VARIANT=hunt`, output `dist-test/hunt`, and
   `--clear`. That is CI's order.
3. Report the net line delta, split into app source and tests. New component
   boundaries cost source lines, so pay for them with test and boilerplate
   cuts.

       git diff --shortstat main -- larp-dashboard larp-passport ':!*.test.*' ':!**/__tests__/**'
       git diff --shortstat main -- '*.test.*' '**/__tests__/**' supabase/tests
4. Check that the diff holds only your changes. Other agents, such as Codex,
   sometimes write into this checkout.
