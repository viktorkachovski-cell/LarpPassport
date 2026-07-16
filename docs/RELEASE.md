# Release Process

## The gate

`.github/workflows/ci.yml` runs on every pull request and every push to
`main`. It fails the check when any of the following fails:

- dashboard: `npm ci`, `npm test` (vitest), `npm run build`
- mobile: `npm ci`, `npx expo-doctor@latest`, `npm test` (location queue
  suite), `npx expo export --platform android`
- database: `supabase start` + `supabase test db supabase/tests/database`
  (the full pgTAP suite against a clean local stack)

Rule: nothing merges to `main` while the gate is red. Enable branch
protection on `main` requiring the three CI jobs once this lands (Settings >
Branches > Add rule > require status checks).

The mobile export job uses placeholder `EXPO_PUBLIC_*` values on purpose: CI
proves the bundle compiles; real values are injected by the EAS
`production`/`preview` environments at build time. No secrets live in CI for
the gate.

## Cutting a release

1. Confirm the gate is green on `main`.
2. Tag the exact commit: `git tag game-2026-v1.0.0 && git push origin game-2026-v1.0.0`
3. `.github/workflows/release.yml` re-runs the full gate, then builds the
   production APK on EAS and publishes a GitHub Release containing:
   - Git commit SHA and tag
   - app version and Android build number
   - latest database migration filename
   - EAS build id and APK sha256 checksum
   - the APK itself as a release asset

Tags are immutable: never move or reuse one. A fix means a new tag.

### One-time setup for automated APK builds

Add a repository secret named `EXPO_TOKEN` (GitHub > Settings > Secrets and
variables > Actions) containing an Expo access token from
expo.dev > Account settings > Access tokens. Without it, the release still
publishes with all metadata and instructions for building the APK manually
from the tag.

Each tagged release consumes one EAS build from the free-tier monthly quota,
so tag deliberately, not for experiments.

## Feature freeze

- Feature changes stop at least four weeks before the game.
- After the freeze, only verified bug fixes merge: a fix must reproduce the
  bug, include or update a test where feasible, and pass the full gate.
- No Expo SDK upgrades inside the freeze window (see the `expo-upgrade`
  branch plan in the architecture notes).

## What "record" means for game day

Print or save the GitHub Release page for the tag used at the event. If a
phone at the game behaves oddly, the release page pins the exact commit, the
exact schema migration, and the exact APK checksum that phone should be
running — `sha256sum` the APK on the device (via a file manager or `adb
shell`) and compare.
