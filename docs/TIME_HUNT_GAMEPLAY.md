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
6. On the dashboard map, draw a circle or polygon, set **Purpose** to **Time
   anomaly play area**, and choose the edge-warning distance. Only one play area
   can exist per game; ordinary event zones remain available separately.
7. Ask players to open **Sharing**, grant foreground and background location
   permission, and enable sharing. Sharing works while the game is still in
   draft, so markers appear during setup.
8. Confirm recent player markers appear inside the play area on the GM map.
9. Open the dashboard's **Hunt** tab. Readiness must show at least two players
   and a character for every player.
10. Press **Start hunt** and confirm the prompt.
11. Ask players to open their **Hunt** tab and verify that each sees a target.

Starting the hunt automatically sets the game to `active`, forces location
visibility to `gm_only`, creates a random circular target chain, and locks the
active roster. No player can join, leave, or change role until the hunt is
reset or completed. Living participants also cannot rename or delete their
character while the round is active — hunters identify targets by character
name. GMs can still edit characters at any time.

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

### Message The GM

The **Events** tab contains a short message field. A player can send a message
of 1-100 characters to the GM event stream. Messages are visible to the sender
and GMs, but not to other players. A three-second server cooldown limits
accidental repeated sends.

### Time Anomaly Boundary

When a player enters the configured edge-warning band, the app warns that they
are nearing the anomaly boundary. Leaving the play area rejects any pending
elimination claim made by that player and creates a player-visible, pending GM
breach event. Remaining outside does not repeat the breach until the player
returns to safety and approaches the edge again.

The boundary is only evaluated while a hunt round is active. A breach requires
the player to have actually been inside the play area, and a fix must land
beyond the zone's exit buffer (15 m by default) past the edge before it counts
as leaving — a single GPS glitch on the line does not forfeit a claim, and a
player who is still travelling to the site is never flagged.

GPS can still drift, so a boundary exit does not automatically eliminate the
player. The GM confirms or dismisses the breach and can use **Eliminate** when
the live ruling is that the player forfeited the game.

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
- The winner waits without a target until the GM assigns the defeated player's
  former target. No further kill claim can start while assignment is pending.
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
- **Force confirm** and **Force reject** resolve a pending claim when the GM's
  live ruling must override or replace the player's response.
- **Eliminate** applies a GM-confirmed kill even when no usable player claim
  exists, then performs the normal privacy cleanup and waits for target assignment.
- **Assign target** releases the defeated player's former target to the winner
  after a non-final kill. The GM may instead use **Edit target chain** to make a
  different complete assignment.
- **Restore** brings an eliminated traveller back and safely reinserts them into
  the circular chain. Restoring the finished game's loser reopens the round.
- **Edit target chain** lets the GM order every living traveller. Each row
  targets the next and the last targets the first; saving rejects stale pending
  claims and replaces all assignments atomically.
- The GM cannot manually alter the roster, game status, or location visibility
  while a hunt is active. This prevents a partial or broken target chain.

Reset returns the game to draft; players who were still sharing keep sharing,
because draft games accept pings. Reset does not restore a previously
eliminated player's location consent — those players must enable sharing again
before the next round. Location visibility remains GM-only unless the GM
changes it after reset.

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
| Winner says awaiting GM assignment | The GM must use **Assign target** or save a complete chain before another claim can begin. |
| Boundary warning appears | Move back toward the safe interior before crossing the anomaly edge. |
| Boundary exit is pending | Review GPS and the live ruling; confirm/dismiss the event and eliminate through Hunt only when appropriate. |
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
- GM recovery actions are intentionally powerful and take effect immediately.
  The dashboard should remain restricted to adjudicating GMs, and the GM should
  announce corrections that materially change active targets.
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
rejection, GM target assignment, cloak behavior, location revocation, final
winner resolution, player messaging, play-area warnings, claim forfeiture, and
GM adjudication/recovery operations.

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
