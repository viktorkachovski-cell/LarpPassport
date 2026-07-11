# LARP Passport

LARP Passport is a small, free-tier hobby stack for up to roughly 100 users:

- `larp-dashboard/`: Vite/React GM dashboard deployed on Vercel.
- `larp-passport/mobile/`: Expo/React Native player app.
- `supabase/`: Auth, Postgres/PostGIS, RLS, RPCs, Realtime, and retention jobs.

Documentation:

- [`docs/TIME_HUNT_GAMEPLAY.md`](docs/TIME_HUNT_GAMEPLAY.md): first-game setup,
  gameplay rules, GM runbook, field testing, and recovery.
- [`docs/SUPABASE_ARCHITECTURE.md`](docs/SUPABASE_ARCHITECTURE.md): database,
  RLS, PostGIS, deployment, and local-development architecture.
- [`larp-passport/mobile/README.md`](larp-passport/mobile/README.md): Android
  development and APK build instructions.

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
npx expo export --platform android --output-dir dist-test
```

## Configure

Create local environment files from the committed examples. Browser and Expo
variables are public client configuration; never place a Supabase service-role
key in either client.

- Dashboard: `larp-dashboard/.env.local`
- Mobile: `larp-passport/mobile/.env.local`

The clients connect directly to hosted Supabase. A separately hosted Node
backend or VPS is not required.
