# LARP Passport - Player App (Android)

Expo (React Native) app. Players sign in, join a game by code, create a character,
see live stat changes from the GMs, receive event notifications, and share
background GPS with explicit consent.

The Time Hunt mode adds secret target proximity, victim-confirmed elimination,
target inheritance, ten-minute cloaking, and final-winner state. See the
[gameplay and operations guide](../../docs/TIME_HUNT_GAMEPLAY.md) before running
a live game.

## Run Locally

For complete location testing, use an Android emulator or USB-connected phone:

```powershell
npm install
npm run android
```

Expo Go on Android cannot run the foreground/background location services this
app requires. `npx expo start --tunnel` is suitable only with a compatible
development client or for UI/authentication smoke testing. It is not a complete
game-day location test. See the
[Expo Location limitations](https://docs.expo.dev/versions/latest/sdk/location/#background-location).

A VPS or locally exposed backend port is not needed because the app connects to
hosted Supabase.

## Build The APK

1. Create an [Expo account](https://expo.dev/signup).
2. In this folder:
   ```powershell
   npm install
   npx expo install --fix        # aligns native package versions if the SDK moved
   npx eas-cli login
   npx eas-cli build -p android --profile preview
   ```
   Accept the prompts (create EAS project, generate Android keystore). The build
   runs on Expo's free tier and ends with a download link to the **.apk**.
3. Open the link on each Android phone, download, and install
   (allow "install unknown apps" when prompted).

## Notes

- Background tracking uses a foreground service, so players always see a
  persistent notification while sharing. "Allow all the time" location
  permission is required and requested in-app.
- Event alerts use Supabase Realtime while the app is active and are also
  piggybacked on background location flushes. No Firebase/FCM setup is needed
  for the current game flow.
- Offline: pings queue on-device (up to 500) and flush when signal returns.
- Elimination claims and confirmations require internet access and are not
  queued offline.
- Eliminated players have sharing revoked automatically. They must enable it
  again before participating in a later reset round.
