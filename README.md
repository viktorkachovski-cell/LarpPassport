# LARP Passport

LARP Passport is a small, free-tier hobby stack for up to roughly 100 users:

- `larp-dashboard/`: Vite/React GM dashboard deployed on Vercel.
- `larp-passport/mobile/`: Expo/React Native player app.
- `supabase/`: Auth, Postgres/PostGIS, RLS, RPCs, Realtime, and retention jobs.

The database architecture and operating procedures are documented in
[`docs/SUPABASE_ARCHITECTURE.md`](docs/SUPABASE_ARCHITECTURE.md).

## Verify

```powershell
cd larp-dashboard
npm ci
npm test
npm run build

cd ..
npx supabase test db supabase/tests/database
```

## Configure

Create local environment files from the committed examples. Browser and Expo
variables are public client configuration; never place a Supabase service-role
key in either client.

- Dashboard: `larp-dashboard/.env.local`
- Mobile: `larp-passport/mobile/.env.local`
