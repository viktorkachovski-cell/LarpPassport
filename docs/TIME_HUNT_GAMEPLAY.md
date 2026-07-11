# Time Hunt Gameplay And Operations

## Game Concept

Time travellers have returned to repair a paradox, but each wants a different
version of the timeline. Every living player hunts one secret target while
being hunted by another unknown player. A live mock battle decides the result;
the app records it only after the defeated player confirms. The final living
player wins.

This document describes the implemented behavior. Theme, narrative text, and
live-combat safety rules remain the responsibility of the game team.

## Requirements

- One GM account with access to the web dashboard.
- At least two game members with the `player` role.
- Exactly one non-NPC character for every participating player.
- The Android player app connected to the production Supabase project.
- Location permission and location sharing enabled on each participating phone.
- Mobile data or Wi-Fi for claims and confirmations. Location pings can queue
  temporarily offline, but elimination actions require a live connection.

The GM is an observer and never receives a target.

## First-Game Setup

1. Open <https://larp-passport.vercel.app> and sign in as the GM.
2. Create or select the game and distribute its join code.
3. Ask every player to register, verify their email if required, sign in, and
   join with the code.
4. Confirm every participant is listed as a player rather than a GM.
5. Ask every player to create their non-NPC character.
6. Ask players to open **Sharing**, grant foreground and background location
   permission, and enable sharing.
7. Confirm recent player markers appear on the GM map.
8. Open the dashboard's **Hunt** tab. Readiness must show at least two players
   and a character for every player.
9. Press **Start hunt** and confirm the prompt.
10. Ask players to open their **Hunt** tab and verify that each sees a target.

Starting the hunt automatically sets the game to `active`, forces location
visibility to `gm_only`, creates a random circular target chain, and locks the
active roster. No player can join, leave, or change role until the hunt is reset
or completed.

## Player Flow

### Find The Target

The **Hunt** tab displays only:

- The target character's name.
- The number of travellers still alive.
- A proximity signal based on recent location pings.
- Any active cloak or pending elimination state relevant to that player.

The API does not reveal the target's profile ID, coordinates, or the identity
of the player hunting the current user.

Proximity is calculated only when both positions are less than two minutes old:

| Band | Distance |
| --- | --- |
| `immediate` | 25 m or less |
| `close` | More than 25 m and up to 100 m |
| `nearby` | More than 100 m and up to 300 m |
| `distant` | More than 300 m and up to 1 km |
| `far` | More than 1 km |

The displayed approximate distance is rounded to 10 metres. A missing location
shows **waiting for location**; a position older than two minutes shows
**stale**.

### Resolve An Elimination

1. Resolve the live mock battle according to the game's safety rules.
2. The winning player presses **Claim elimination** and confirms the warning.
3. The defeated player receives an anonymous confirmation request.
4. The defeated player presses **Review confirmation**.
5. They choose **Confirm elimination** if the battle was valid, or **Not
   confirmed** to reject the claim.

The app intentionally does not tell the defeated player who submitted the
claim. Rejected claims change no target assignment and the hunter may submit a
new claim later.

### After Confirmation

For a non-final elimination, the server completes all changes atomically:

- The defeated player is marked eliminated.
- Their current location is deleted and location sharing is revoked.
- The winner inherits the defeated player's target.
- The winner receives a ten-minute temporal cloak.
- The player hunting the cloaked winner sees a masked signal until it expires.

When only one player remains, that player is recorded as the winner and the
game status becomes `finished`. The final elimination ends the round directly;
there is no meaningful cloak after the game has ended.

## GM Controls

The dashboard **Hunt** tab is privileged and displays the complete target chain,
player state, cloak status, claim history, and winner. This information should
not be shown to active players.

- **Refresh** reloads the authoritative hunt state.
- **Reset hunt** clears assignments, claims, eliminations, cloaks, and winner,
  then returns the game to `draft`.
- The GM cannot manually alter the roster, game status, or location visibility
  while a hunt is active. This prevents a partial or broken target chain.

Reset does not automatically restore a previously eliminated player's location
consent. Before starting another round, those players must enable sharing again.
Location visibility remains GM-only unless the GM changes it after reset.

## Game-Day Checklist

- Charge every phone and bring power banks.
- Disable battery optimization for the app where Android permits it.
- Confirm **Allow all the time** location permission on every phone.
- Verify every player can see the same game and has a character.
- Verify markers have updated within the last two minutes.
- Run one complete claim, rejection, and confirmation rehearsal with a test
  game before the live event.
- Keep the GM dashboard open on a charged laptop or tablet.
- Keep the join code private once the final roster is assembled.
- Agree on a GM ruling process for accidental or disputed claims.

## Recovery Guide

| Symptom | Action |
| --- | --- |
| Start button is disabled | Add at least two players and create a non-NPC character for each. |
| Start returns a roster error | Refresh Players and Hunt; correct missing characters or roles before retrying. |
| Target says waiting for location | Both hunter and target must enable sharing and grant background location permission. |
| Target signal is stale | Open the app on both phones, confirm GPS/mobile data, and wait for a new ping. |
| Claim remains pending | The target should open Hunt and press Refresh; claims require internet access. |
| Player rejects by mistake | The hunter submits another claim after the live result is reconfirmed. |
| Player app stops sharing | Re-enable Sharing unless that player was eliminated. |
| Chain cannot continue | The GM should record the current state, reset the hunt, verify the roster, and restart. |
| Dashboard appears behind | Press Refresh; Realtime events also trigger an automatic hunt reload. |

The server serializes simultaneous actions per game. Repeated claim requests are
idempotent while one is pending, and only the claimed target can confirm or
reject that claim.

## Current Limitations

- There is no pause/resume state. A round is either not started, active, or
  finished; use reset only when the current round should be discarded.
- There is no GM force-confirm action. The claimed target must confirm or reject
  while the round is active. A permanently unavailable target requires a GM
  ruling and round reset.
- The app does not use FCM remote push. Hunt events arrive through Realtime while
  connected or through the next background location flush. Players should check
  the Hunt tab when resolving a battle rather than relying only on a notification.
- Android may stop background tracking when the user force-closes the app or
  when vendor battery management kills it. Reopen the app, confirm Sharing is
  active, and wait for a fresh marker before continuing.
- The GM can see the full target chain and exact map markers. Operational access
  to the dashboard must therefore be kept away from active players.

## Pre-Release Verification

Run before distributing a new APK or changing the live database:

```powershell
cd larp-dashboard
npm ci
npm test
npm run build

cd ..
npx supabase test db supabase/tests/database

cd larp-passport\mobile
npm ci
npx expo export --platform android --output-dir dist-test
```

The database tests are transactional and roll their fixtures back. The hunt
suite covers assignment secrecy, roster locks, anonymous confirmation,
rejection, target inheritance, cloak behavior, location revocation, and final
winner resolution.

## Native Testing And Distribution

Full location behavior must be tested in a native build. Expo Go on Android does
not support the foreground and background services used by this app. See the
[Expo Location limitations](https://docs.expo.dev/versions/latest/sdk/location/#background-location).

For a local native build on an Android emulator or USB-connected phone:

```powershell
cd larp-passport\mobile
npm install
npm run android
```

`npx expo start --tunnel` can still help with a compatible development client
or a UI/authentication smoke test, but it must not be treated as proof that
background sharing works.

Build an installable Android preview APK with:

```powershell
npx eas-cli login
npx eas-cli build -p android --profile preview
```

The hosted Supabase backend is already internet-accessible. Do not expose a
development laptop port or add a VPS for mobile testing.
