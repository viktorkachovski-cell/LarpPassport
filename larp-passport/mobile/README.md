# LARP Passport — player app (Android)

Expo (React Native) app. Players sign in, join a game by code, create a character,
see live stat changes from the GMs, receive event notifications, and share
background GPS with explicit consent.

## Build the APK (one-time setup ~10 min, later builds one command)

1. Free Expo account: https://expo.dev/signup
2. In this folder:
   ```
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
- Background tracking uses a foreground service — players always see a
  persistent notification while sharing. "Allow all the time" location
  permission is required and requested in-app.
- Event alerts are local notifications driven by Supabase Realtime — no
  Firebase/FCM needed because the foreground service keeps the app alive.
- Offline: pings queue on-device (up to 500) and flush when signal returns.
