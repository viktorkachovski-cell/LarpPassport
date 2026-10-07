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
- [`docs/RELEASE.md`](docs/RELEASE.md): CI gate, tagged releases, feature freeze.
- [`larp-passport/mobile/README.md`](larp-passport/mobile/README.md): Android
  development and APK build instructions for both apps.

Production dashboard: <https://larp-passport.vercel.app>

## Verify

```powershell
cd larp-dashboard
npm ci
npm test
npm run build

cd ..
npx supabase test db supabase/tests/database

cd larp-passport\mobile
npx expo export --platform android --output-dir dist-test/pirate
$env:APP_VARIANT='hunt'; npx expo export --platform android --output-dir dist-test/hunt --clear; Remove-Item Env:APP_VARIANT
```

## Configure

Create local environment files from the committed examples. Browser and Expo
variables are public client configuration; never place a Supabase service-role
key in either client.

- Dashboard: `larp-dashboard/.env.local`
- Mobile: `larp-passport/mobile/.env.local`

The clients connect directly to hosted Supabase. A separately hosted Node
backend or VPS is not required.
