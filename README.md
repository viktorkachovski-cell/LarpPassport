# LARP Passport

LARP Passport is a small, free-tier hobby stack for up to roughly 100 users:

- `larp-dashboard/`: Vite/React GM dashboard deployed on Vercel.
- `larp-passport/mobile/`: Expo/React Native player apps. One project builds
  two Android apps: **The Black Tide** (Pirate game, the default build) and
  **LARP Time Hunt**.
- `supabase/`: Auth, Postgres/PostGIS, RLS, RPCs, Realtime, and retention jobs.

Documentation:

- [`docs/pirate-game/GAME_GUIDE.md`](docs/pirate-game/GAME_GUIDE.md): Pirate
  game rules; [`AGENT_PLAN.md`](docs/pirate-game/AGENT_PLAN.md) and
  [`IMPLEMENTATION_STATUS.md`](docs/pirate-game/IMPLEMENTATION_STATUS.md)
  track the build and its release gates.
- [`docs/TIME_HUNT_GAMEPLAY.md`](docs/TIME_HUNT_GAMEPLAY.md): Time Hunt setup,
  gameplay rules, GM runbook, field testing, and recovery;
  [`docs/TIME_HUNT_BACKLOG.md`](docs/TIME_HUNT_BACKLOG.md) holds the
  invariants and deferred features.
- [`docs/SUPABASE_ARCHITECTURE.md`](docs/SUPABASE_ARCHITECTURE.md): database,
  RLS, PostGIS, deployment, and local-development architecture.
- [`docs/RELEASE.md`](docs/RELEASE.md): CI gate, tagged releases, event stabilisation.
- [`larp-passport/mobile/README.md`](larp-passport/mobile/README.md): Android
  development and APK build instructions for both apps.

Production dashboard: <https://larp-passport.vercel.app>

## Verify

Use Node 24.16.0 and Supabase CLI 2.116.0, matching `.github/workflows/ci.yml`.
Docker Desktop's Linux engine must be running. The commands below target local test data only.

```powershell
cd larp-dashboard
npm ci
npm test
npm run build

cd ..
npx supabase@2.116.0 start -x studio,imgproxy,inbucket,edge-runtime,logflare,vector
npx supabase@2.116.0 test db supabase/tests/database
python supabase/tests/concurrency.py
python supabase/tests/pirate_concurrency.py
python -m unittest discover -s tools/pirate -p 'test_*.py'

cd larp-passport/mobile
npm ci
npm test -- --runInBand
npx expo-doctor@1.20.4
# Supply public EXPO_PUBLIC_* configuration from .env.local or CI placeholders.
$env:APP_VARIANT='pirate'
npx expo export --platform android --output-dir dist-test/pirate
$env:APP_VARIANT='hunt'
npx expo export --platform android --output-dir dist-test/hunt --clear
Remove-Item Env:APP_VARIANT
```

Use `npx supabase@2.116.0 db reset --local` only for a disposable local database when a clean migration replay is needed.
See [RELEASE.md](docs/RELEASE.md) for exact-commit release gates and [Pirate status](docs/pirate-game/IMPLEMENTATION_STATUS.md) for live-versus-source limits.

## Configure

Create local environment files from the committed examples. Browser and Expo
variables are public client configuration; never place a Supabase service-role
key in either client.

- Dashboard: `larp-dashboard/.env.local`
- Mobile: `larp-passport/mobile/.env.local`

The clients connect directly to hosted Supabase. A separately hosted Node
backend or VPS is not required.
