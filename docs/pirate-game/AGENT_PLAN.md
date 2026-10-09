# Pirate game: remaining work

Updated 2026-10-09 after the code review, uncapped crews, battery lifecycle fixes and audited GM controls.

[GAME_GUIDE.md](GAME_GUIDE.md) describes the implemented rules and event schedule.
[IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) records verification and deployment limits.
This file is the deferred backlog. It does not instruct an agent to rebuild completed features or authorize deployment.

## Completed scope

Private Pirate schema and RPCs, flexible setup, ranked riddle rewards, frozen treasure value,
captains and captain-only compass, claims and claim voids, independent Parley confirmations,
GM Parley rulings/voids, treasure awards/voids, GM balance adjustments, reasoned GM claims/Mercy/captain replacement, editable future payouts/timers, paginated GM history, location alerts, reversible phase control, and separate Pirate/Time Hunt builds exist.
The review adds strict Parley proximity, location rechecks, refresh-driven expiry, and idempotent report/plunder fixes. Attendance is uncapped; new riddle rewards pay five doubloons from fourth place onward. UI clocks pause while inactive and async heading startup cannot orphan a sensor subscription.
Use the latest definition of each function across ordered migrations; older applied definitions are history, not unused code to delete.

## Deferred features

These are retained at the owner's request on 2026-10-09. They are proposals, not current app requirements.

| Work | Decision and acceptance criteria before implementation |
| --- | --- |
| `gm_void_reading` | Reasoned void, audit event, and repeat-read policy. Preserve deterministic bearings and the treasure-point lock. |
| Pause-aware Parley timeout | Currently the encounter’s configured timeout since the last new action (default five minutes); pause/truce does not stop the clock. Decide whether paused time should be excluded before changing this rule. |

## Release and field work

- Apply the verified Parley, uncapped-crew and GM-control migrations to the hosted backend before treating the new Parley behavior as live; record the hosted version and compare it with the repository.
- Build a signed Pirate APK from the reviewed commit and test it on real Android devices. An Expo export proves bundling, not installation, sensors or background GPS.
- Verify both GM accounts, including phone-width dashboard controls, and the exact dashboard deployment against the hosted backend.
- Survey the treasure/lighthouse geometry with `tools/pirate/simulate_triangulation.py`; retain its estimates as planning inputs, then test real readings.
- Write nine riddles and four oath words, arrange the printed chart, and complete [EVENT_READINESS_2026-10-31.md](EVENT_READINESS_2026-10-31.md). Event layout counts are a plan, not validation gates.

## Implementation constraints

- Preserve Time Hunt privacy, consent, queue ownership and recovery; see [TIME_HUNT_BACKLOG.md](../TIME_HUNT_BACKLOG.md) section 1.
- Preserve private answers, HMAC secret and player zone geometry denial. Treasure coordinates may be disclosed to GMs only.
- Every Pirate mutation uses the per-game `pirate:` advisory transaction lock. Never introduce a row-lock-first path that reverses existing lock order.
- Ledger history is append-only. Corrections compensate and mark the source void; balances cannot become negative.
- Create additive migrations. Keep RLS, explicit RPC grants, empty search paths, authorization and cross-game checks. No private Pirate table joins the Realtime publication.
- Player actions stay direct RPCs; they do not belong in the GPS queue. Retry an uncertain action with its original idempotency key.
- Run the full gate in [RELEASE.md](../RELEASE.md), including real-connection concurrency checks. No device or live-deployment claim follows from a mocked test or JavaScript export.
