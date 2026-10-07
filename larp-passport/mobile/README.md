# LARP Passport - Player Apps (Android)

One Expo (React Native) project builds two separate Android apps. Players sign
in, join a game by code, create a character, receive event notifications, and
share background GPS with explicit consent in both.

| App | `APP_VARIANT` | Android package | Plays |
| --- | --- | --- | --- |
| **The Black Tide** | `pirate` (default) | `com.larppassport.app` | Pirate games: chart, compass, Parley ([rules](../../docs/pirate-game/GAME_GUIDE.md)) |
| **LARP Time Hunt** | `hunt` | `com.larppassport.timehunt` | Ordinary and Time Hunt games ([guide](../../docs/TIME_HUNT_GAMEPLAY.md)) |

The Pirate app keeps the original package ID, so installing it replaces an
existing LARP Passport install. Time Hunt installs beside it.

## How the split works

- `variant.js` reads `APP_VARIANT` (unset means `pirate`) and fails fast on an
  unknown value.
- `app.config.js` sets the app name and Android package from it.
- `metro.config.js` resolves `<name>.<variant>.js` before `<name>.js`. The
  variant files are `src/screens/GameScreen.{pirate,hunt}.js` and
  `src/lib/brand.{pirate,hunt}.js` (palette, copy, which games the app lists).
  Neither bundle contains the other game's screens.
- Shared game-screen code lives in `src/screens/game/GameFrame.js` (layout and
  the character, logbook and sharing tabs) and `src/screens/game/session.js`
  (snapshot, Realtime, recovery polling, location sharing).
- Jest resolves the Pirate variant (`moduleFileExtensions` in `package.json`).

`APP_VARIANT` is read at config and bundle time. After switching it, run
`npx expo prebuild --clean` before a local native build and pass `--clear` to
Metro, so the previous app's package and bundle are not reused.

## Run Locally

For complete location testing, use an Android emulator or USB-connected phone:

```powershell
npm install
npm run android                                  # Pirate app
$env:APP_VARIANT='hunt'; npx expo prebuild --clean; npm run android   # Time Hunt app
```

Expo Go on Android cannot run the foreground/background location services these
apps require. `npx expo start --tunnel` is suitable only with a compatible
development client or for UI/authentication smoke testing. It is not a complete
game-day location test. See the
[Expo Location limitations](https://docs.expo.dev/versions/latest/sdk/location/#background-location).

Both apps connect to hosted Supabase; no VPS or local backend is needed.
Local builds read `EXPO_PUBLIC_*` values from the ignored `.env.local`.

## Build The APK

With EAS (environment variables come from the EAS `preview`/`production`
environments):

```powershell
npm install
npx eas-cli login
npx eas-cli build -p android --profile preview         # The Black Tide
npx eas-cli build -p android --profile preview-hunt    # LARP Time Hunt
```

`production` and `production-hunt` are the release equivalents; tagged
releases build `production` (see [RELEASE.md](../../docs/RELEASE.md)).

For a local release APK, generate the native project for the app you want and
build it with Gradle:

```powershell
npx expo prebuild --clean --platform android     # Pirate (APP_VARIANT unset)
cd android
.\gradlew assembleRelease
```

The APK is written to `android/app/build/outputs/apk/release/`. It is signed
with the debug keystore unless you configure a release keystore; a phone that
has an EAS-signed install of the same package must uninstall it first.

## Notes

- Background tracking uses a foreground service, so players always see a
  persistent notification while sharing. "Allow all the time" location
  permission is required and requested in-app.
- Event alerts use Supabase Realtime while the app is active and are also
  piggybacked on background location flushes. No Firebase/FCM setup is needed.
- Offline: pings queue on-device (up to 500) and flush when signal returns.
  Game actions (site claims, Parley, elimination claims) are direct calls and
  are not queued offline.
- Time Hunt: eliminated players have sharing revoked automatically and must
  enable it again before a later reset round.
