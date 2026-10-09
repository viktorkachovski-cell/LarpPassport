# Release Process

## The gate

`.github/workflows/ci.yml` runs on every pull request and every push to
`main` and `codex/**` branches. It fails the check when any of the following fails:

- dashboard: `npm ci`, `npm test` (vitest), `npm run build`
- mobile: `npm ci`, `npx expo-doctor@1.20.4`, `npm test`, and
  `npx expo export --platform android` for both apps (`APP_VARIANT=pirate`
  and `APP_VARIANT=hunt`)
- database: `supabase start` + `supabase test db supabase/tests/database`
  (the full pgTAP suite against a clean local stack), then
  `python supabase/tests/concurrency.py` and `python supabase/tests/pirate_concurrency.py`

Rule: nothing merges to `main` while the gate is red. Repository administrators should require all three CI jobs in branch protection; this document does not establish the current GitHub protection settings.

The mobile export job uses placeholder `EXPO_PUBLIC_*` values on purpose: CI
proves the bundle compiles; real values are injected by the EAS
`production`/`preview` environments at build time. No secrets live in CI for
the gate.

## Cutting a release

1. Confirm the gate is green on `main`.
2. Tag the exact commit: `git tag game-2026-v1.0.0 && git push origin game-2026-v1.0.0`
3. `.github/workflows/release.yml` re-runs the full gate, then builds the
   production **Pirate** APK on EAS (`production` profile; Time Hunt uses
   `production-hunt` and is built manually) and publishes a GitHub Release containing:
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

## Stabilisation

For the 2026-10-31 Pirate test run, the owner waived the original four-week feature freeze.
The readiness plan targets a field rehearsal on 24 October and gameplay stabilisation by 27 October.
After that, merge only reproduced and verified bug fixes; avoid Expo SDK changes during event stabilisation.
Other events should set their own freeze date rather than inherit this one-time waiver.

Pushing `main` is a source publication. Supabase migrations, a Vercel deployment and a new signed APK are distinct release steps.
Record their exact identities, and do not call a JavaScript export a device test.

## What "record" means for game day

Print or save the GitHub Release page for the tag used at the event. If a
phone at the game behaves oddly, the release page pins the exact commit, the
exact schema migration, and the exact APK checksum that phone should be
running — `sha256sum` the APK on the device (via a file manager or `adb
shell`) and compare.
