# Reliability release — 7 September 2026

The owner approved implementing the outstanding review findings and publishing to GitHub main, Supabase and Vercel. UI polish, new features and the Android APK rebuild are deferred.

## Implemented

| Review item | Result |
| --- | --- |
| F01 | Existing GM-controlled fields cannot be reset or removed by players. Creation defaults and newly introduced fields still work. |
| F02 | Native tracking has an account, game and session owner. Queue keys include that owner; outgoing requests retain the correct account token. Stale responses cannot stop a replacement session. Account changes stop tracking; unowned legacy points are never uploaded as the current user. |
| F03 | Notification delivery has a per-account/game cursor and one serialized delivery path. Realtime wakes the ordered feed instead of skipping gaps. Late visibility receives a new delivery number while the original timeline sequence stays unchanged. Loading a screen no longer marks events read. |
| F04 | Both clients recover authoritative snapshots after reconnect and foreground return, with periodic recovery and stale-response guards. GM refresh also loads game status, roster and characters. |
| F05 | Pending GM actions load independently, including additional pages. Recent history no longer limits the pending queue. Older history can be loaded explicitly. |
| F06 | The newest 50 eligible, nonduplicate GPS fixes are evaluated chronologically. Per-zone watermarks prevent backward state changes; future and pre-round fixes do not adjudicate the current round. Reset clears play-area state but preserves ordinary event-zone one-shot behavior. A delayed exit preserves claims created after the sampled exit; the GM still receives evidence. |
| F07 | Consent failures and native startup failures are reported. Startup failure attempts consent rollback; stopping GPS precedes server revocation and failures can be retried. Retention wording matches actual behavior. |
| F08 | Position age uses GPS sample time, including delayed uploads. |
| F09 | Four migrations missing from Git were recovered from hosted history without changing them. Only the two new migrations are deployment candidates. |
| F10 | Map code loads at first use and remains mounted between tabs. Showing the map resizes it, and map errors leave other controls usable. Initial compressed JavaScript is about 121 KB versus 339 KB before review. |
| F11 | Failed reads remain errors with retry/back controls. A failed character query cannot launch character creation. Account changes clear selected games, and network failures clear action busy states. |
| F12 | Compatible transitive security patches applied. PostCSS is pinned to a patched compatible version in mobile tooling. CI uses Node 24.16.0, Expo Doctor 1.20.4 and Supabase CLI 2.116.0. |

Consent and GPS ingestion share the existing per-game hunt lock. Eliminated participants cannot re-enable sharing until restored. Roster and character writes racing a hunt operation fail with a retryable error instead of risking inconsistent state or deadlock. Existing target assignment holds, victim confirmation, GM overrides, cloak duration and both gameplay workflows remain in place.

## Validation

- Dashboard: 15 regression tests and production build pass locally.
- Mobile: 38 regression tests, Expo Doctor 18/18 and Android bundle export pass locally. Final changes are also checked by CI.
- Database: 145 assertions pass on a clean disposable Supabase stack with the complete migration history.
- Multi-connection checks cover consent revocation/ingestion, elimination/ingestion, roster writes while a hunt lock is held, and delayed boundary evidence arriving alongside a new claim. The final CI result is required before deployment.
- No APK build or game release tag is created by this deployment.

## Remaining limits

Mobile audit still reports inherited build-tool advisories (18 affected package entries: 6 high, 12 moderate). The underlying remaining findings are `image-size` parser loops and `uuid` buffer bounds. Metro processes checked-in assets; the application does not pass player-uploaded images to this parser. Xcode tooling uses UUID v4, whereas the reported buffer issue concerns v3/v5/v6. These are not a claim that npm audit is clean. `image-size` has no published patched version in the reviewed advisory; a forced Expo/React Native upgrade is not an appropriate repair for this release. Reassess these when updating the native toolchain, and do not build untrusted assets. Sources: [image-size advisory](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [UUID advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

An Android export does not test screen-off GPS, operating-system permission changes, battery restrictions, or two-device gameplay. Those physical-device checks remain required with the later APK rebuild. Installed APKs do not receive these mobile changes through a Vercel deployment.

Notification delivery retries on failure. A process crash between operating-system notification scheduling and cursor persistence can replay a notification; stable notification identifiers reduce duplicates. This is not a transactional exactly-once guarantee across the OS and local storage.

The hosted dataset is test data and too small to establish live-game capacity. No broad index removal, database reset, visual redesign or new mechanic is included.
