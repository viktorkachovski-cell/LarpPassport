# The Black Tide: Halloween Pirate Treasure Hunt
Game guide for the PirateGame theme (test run), built on the LarpPassport engine.
Updated 2026-10-09 from reviewed application code. Game date: Saturday 2026-10-31, 13:30 to 18:30.

This guide describes reviewed source behavior. [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) distinguishes it from the hosted backend and installed APKs; the Parley checks, uncapped payouts and GM controls require the new migrations to be applied. The event schedule and planned site counts remain field-test inputs. Deferred features live in [AGENT_PLAN.md](AGENT_PLAN.md).

---

## 1. Event plan and implemented rules

| Topic | Decision |
| --- | --- |
| Event | Test run, friendly group, uncapped attendance, no release freeze |
| Schedule | **13:30 to 18:30**, confirmed |
| Staff | **2 GMs**: the Admiralty (dashboard) and the Ghost Captain (street and treasure NPC) |
| Tavern Truce venue | To be booked; the `truce` phase pauses claims and Parley globally, with no Safe Harbour zones |
| Crews | Aim for 5 crews, with no crew-count, crew-size or total-player cap (confirm actual roster before setup). Each crew has one captain: the GM picks it in setup, a one-player crew's player is captain automatically, and initial selection locks at charting. A GM can replace the captain with a reason in any unfinished phase; readings stay with the crew and the former captain loses app access. |
| Currencies | Bearing shards, oath lines, doubloons |
| Riddle sites | Five shard sites each give **one shard plus ranked doubloons**; four oath sites each give **one line of the oath plus ranked doubloons**, after the correct answer |
| Oath lines | Four lines of verse that form the oath; each shown whole in the app once earned; traded freely through roleplay; not plunderable |
| Doubloons | From all nine riddle sites after correct answers, plunder, treasure; lighthouses pay nothing |
| Parley | In app; rock-paper-scissors played physically; both sides enter the agreed result; Yield or Fight |
| Treasure | By default 40% of the highest crew doubloon score at the first `hoard` opening, rounded to the nearest whole doubloon and capped at 1000; claimed by speaking the oath to an on-site NPC |
| GM dashboard | Full control layer: zones, messages, resources, positions, corrections (section 7) |

---

Five crews remains the planning target. The app permits any positive crew count and any crew size; a different crew count produces a planning warning, while larger crews produce no attendance warning. Charting requires at least one crew, a captain for each multi-player crew, a secret treasure point, answers for active riddles, non-overlapping sites, circle lighthouses, and no lighthouse centred on the treasure. Unassigned players are warned about and cannot play crew actions until assigned.

## 2. Schedule (13:30 to 18:30, Plovdiv local time)

Approved by the owner on 2026-10-09 to avoid late-night Halloween overcrowding.

| Time | Phase | Notes |
| --- | --- | --- |
| 13:30 | **Lunch and Muster** | Briefing, crews, armbands, app join, consent and battery check at the chosen meeting venue |
| 14:00 | **Act I: Charting** | Shard and oath riddle sites open. PvP and lighthouse readings remain off. |
| 15:00 | **The Curse Wakes** | GM opens lighthouses and PvP in daylight, giving crews time to triangulate before dusk. |
| 16:00 to 16:15 | **Tavern Truce** | Short indoor break. PvP and claims pause globally; warm up, charge phones and trade oath lines. |
| 16:15 | **Act II: The Hunt** | Play resumes |
| 17:30 | **The Hoard Surfaces** | GM opens `hoard`, freezing the treasure value from the leading doubloon score; the NPC takes position. |
| 17:30 to 18:20 | **Last Plunder** | After the treasure is found, play continues; the finding crew can become a plunder target. |
| 18:20 | Recall | GM ends PvP and claims |
| 18:30 | **Final Muster** | Scoring and awards |

Phases change when a GM presses the phase control; no clock automatically advances them.
The app gates compass readings by phase and shards, not actual sunlight.
For 31 October 2026, Plovdiv sunset is about **17:16**, with civil twilight ending around
**17:45** ([sun table](https://www.timeanddate.com/sun/bulgaria/plovdiv?month=10&year=2026)).
The 17:30 hoard opening is therefore around dusk, and Last Plunder continues into darkness.
Check weather and actual lighting during the field rehearsal.

### Treasure gate and break

The fixed 17:30 hoard opening keeps the climax around dusk while allowing daylight
triangulation from 15:00. The NPC needs to cover the 50-minute Last Plunder window.
Davy's Mercy and the Parley cap remain in force. Lunch at the start and the short
indoor Truce give players time to recover, charge and trade without extending play
into the late-night crowds.

---

## 3. Site counts and afternoon route

Playable time is about 245 minutes: charting at 14:00 through recall at 18:20, minus the 15-minute Truce. The 13:30–18:30 run-of-show spans five hours through the start of awards. Remeasure the route and puzzle timing against this shorter window.

| Site | Count | Zone setup | Per-crew rule |
| --- | --- | --- | --- |
| Shard riddle sites | **5** | circle 40-50 m, `silent` (or `auto` + one-shot to push site lore on arrival), dwell 20 s; private site kind `riddle`, reward `bearing` | Once per crew after correct answer, +1 shard and doubloons by successful-answer rank |
| Oath riddle sites | **4** (one per oath line) | same, reward `oath`, oath index 1..4 | Once per crew after correct answer, reveals that whole line and pays doubloons by successful-answer rank |
| Lighthouses | **3** | circle 40-60 m, `silent` or `auto` + one-shot, dwell 20 s; private site kind `lighthouse` | One reading per crew per lighthouse per shard level; no site reward |
| Treasure | **1** | Secret point set by the GM (not a map zone; the `treasure` site kind was removed 2026-10-07) | Separate staffed point; GM award in `hoard` phase |

Total: **12 activity sites plus 1 separate treasure point = 13 physical locations**. There are no caches or Safe Harbour zones.

**Mark shard and oath sites differently on the printed chart.** Crews then plan, for example: "we skip the far oath site and trade for that word at the Truce". That is the decision you want them making. Hidden reward types would make it a lottery.

One line per oath site means no crew collects all four on its own schedule without effort. They either walk far or trade. That is the roleplay hook working as intended.

### Time budget per crew

The former 29-point estimate no longer applies. In the field rehearsal, time a route that earns at least three shards, visits two distinct lighthouses, finds or trades the four oath lines, and reaches the treasure after 17:30. If that finishes too early, improve story and interaction pacing before adding locations. If it overruns, shorten walking distances or puzzle time.

---

## 4. Bearing shards and compass

| Shards | Arc half-width | Player feel |
| --- | --- | --- |
| 0 | No reading | Useless: “the glass is broken” |
| 1 | ±90° | Somewhere that way-ish |
| 2 | ±45° | A quadrant |
| 3 | ±25° | A street direction |
| 4 | ±12° | A block |
| 5+ | ±5° | Near-certain |

- Only the crew captain's app shows the compass: readings, the reading logbook and distance bands. Shards, doubloons and oath lines belong to the whole crew.
- Shards above 5 act as a theft buffer.
- Distance bands (≤100 m and ≤25 m only) unlock at 3+ shards.
- Arcs are computed server-side from the lighthouse centre, with a deterministic HMAC offset per crew, lighthouse and shard level.

---

## 5. Doubloons

Each of the **five shard sites** gives the claiming crew +1 shard and doubloons. Each of the **four oath sites** gives one oath line and doubloons. The crew must submit the correct on-site answer before either reward is granted. **Rank is set by the order of correct answers, not GPS arrival.** Doubloons pay **20 / 15 / 10 / 5**, then **5 for every later successful crew**, with no paid-rank cap. With five crews a site distributes 55 doubloons, or **495 across all nine** if all five solve every riddle. Each additional crew that solves all nine adds 45; attendance is uncapped, so 495 is a five-crew planning total rather than a global maximum. Rewards are one successful claim per crew per site: the first crewmate to answer correctly claims for the whole crew, and a later crewmate's correct answer earns nothing. Lighthouses pay no doubloons. This rule is implemented; event balance still needs field testing.

**Treasure value = round(0.40 × the highest crew's doubloon balance when `hoard` first opens)**, normally at 17:30. Scores include riddle-site awards, Parley transfers and GM corrections recorded before that phase change, but no treasure award. For example, a leading balance of 103 makes the treasure worth 41 doubloons. Freeze and audit the leading balance and calculated value once; stepping back and reopening `hoard`, voiding an award, or awarding it later must not recalculate it. If every crew has zero, the value is zero. Recheck balance after the new route and payout are playtested.

Plunder and protections are unchanged:

| Outcome | Winner takes |
| --- | --- |
| Yield | Attacker takes 10% of target doubloons, rounded up; minimum 3, capped at the available balance. Never a shard. |
| Lose a Fight | Winning participant chooses 1 shard or 25% of loser doubloons, rounded up; minimum 5, capped at balance. |

### Parley in the app

1. Any player assigned to a crew may act; captain status is irrelevant. The target opens a four-digit code valid for 90 seconds. The attacker joins it. One live session per crew prevents parallel encounters.
2. Opening requires the target's fresh location. Joining and every new choice, report or plunder action require both players' locations to be no more than 120 seconds old, within 75 m of each other, and outside the 100 m treasure exclusion in `hoard`. A failed check moves no currency or session decision. Coordinate/location proof is GPS-based, not proof that people met physically.
3. Only the exact target player chooses Yield or Fight. Rock-paper-scissors is physical; the app does not play or judge it.
4. Only those two participants report. Yield requires both to confirm the attacker. Fight requires agreement on the winning crew. A report is immutable; the first report moves no resources. Matching Yield reports transfer immediately. Matching Fight reports wait for the winning participant's plunder choice; other crewmates cannot choose.
5. Conflicting reports become a GM dispute. An unjoined code expires; a joined encounter with no new action for five minutes becomes disputed. Player/GM refreshes sweep expiry, as well as player mutations. An identical report retry does not restart the timer. Pause or Truce does not stop elapsed time.
6. The GM can resolve a disputed exchange with a winner, currency and reason, or void it. A timed-out session where Yield/Fight was never chosen can only be voided. Void reverses recorded transfers and removes Mercy from that session, but is refused if the credited crew has spent the amount that must be reversed.

- Davy's Mercy: the losing crew gets 15 minutes of immunity, including when its doubloon balance was zero. This blocks that crew from opening or joining another encounter.
- The same crew pair waits 30 minutes after resolution by default; its saved deadline survives later rule changes. Disputed sessions remain live and occupy their crews until the GM rules or voids them.
- Maximum three attacking sessions per crew in the rolling hour, counted using session creation time; voided sessions do not count. Showing a target code alone does not consume an attack.
- Parley opens only in `cursed`, `hunt` and `hoard`, when pause is off and PvP is enabled. The GM can still adjudicate disputes during pause or other phases.
- Oath lines never move through Parley. Zero doubloons allow a zero-value doubloon resolution; a shard choice fails if no shard is available.
- Uncertain network outcomes retry the same request. A committed join/report/plunder retry acknowledges the saved outcome without applying another transfer.

---

## 6. Data model and API

Implemented tables live in the private schema; [SUPABASE_ARCHITECTURE.md](../SUPABASE_ARCHITECTURE.md) describes their access boundaries:
- `pirate_games`: mode marker, secret treasure point and value; `hoard` phase controls opening
- `pirate_sites`: answer hashes and oath lines (up to 40 characters each) for registered zones
- `pirate_claims`: unique active `(faction_id, zone_id)` claims, with riddle-site successful-claim rank and void flag
- `pirate_ledger`: append-only bearing shard and doubloon entries, with source, reference, reason and actor
- `pirate_readings`: unique active `(faction_id, zone_id, shards)` compass readings
- `pirate_parleys`: state machine, both reports and resolution state
- `pirate_captains`, `pirate_mercy`, `pirate_attempts`, `pirate_treasure_awards`: captain identity, immunity, answer lockout and audited hoard awards
- `pirate_gm_audit`, `pirate_gm_claim_requests`: private before/after correction history and safe GM claim retries; these do not enter the Realtime publication

Oath lines are not a ledger currency. A crew's lines are derived from its non-voided oath `pirate_claims`, shown in the Hold tab and the Oath lines cell of the status strip.

Player API: `get_pirate_state`, `site_here`, `claim_site`, `compass_reading`, `treasure_band`, `open_parley`, `join_parley`, `parley_choice`, `parley_report`, `parley_plunder`. Mutating gameplay calls enforce phase/pause server-side; Parley also enforces the PvP switch. State reads expose only the caller's scoped data. Riddle answers are normalized (lowercase, trimmed, punctuation removed, whitespace collapsed) and hashed; by default, three wrong answers lock the crew's site attempts for two minutes. Configured attempts and durations apply to future attempts; an active lockout keeps its saved expiry.

---

## 7. GM control layer (dashboard)

Principle: **the GM never edits history, only adds to it.** Every correction is a new ledger row or a void flag, carries a mandatory reason, records who did it, and emits a `game_events` row. You get a full audit trail at Final Muster, and balance corrections can be compensated by another reasoned adjustment.

### 7.1 Game phase control

A `games.phase` value drives everything:

```
setup → charting → cursed → truce → hunt → hoard → recall → finished
```

| Control | What it does |
| --- | --- |
| Phase buttons | Advance or return one phase, including `finished` back to `recall`. Every change is audited and broadcast. Recorded rewards/readings and frozen hoard value stay fixed. Reversing finish restores active game status; players must re-enable location sharing if finishing stopped it. |
| PvP kill switch | Disables Parley globally without changing phase (for disputes, safety or weather) |
| Pause all | Freezes claims, readings and Parley; the app shows "The tide has stopped" |
| Treasure opening | Advance to `hoard` at 17:30, or change the phase time as a GM decision |

### 7.2 Zones (largely existing)

- **Create, move, resize and deactivate zones on the map.** The existing `rearm_zone_on_change` handles state when geometry changes.
- **Pirate-specific fields:** kind, reward type and oath line index, edited through a GM form and stored in private Pirate site state. Answers are write-only from the dashboard: the GM can set or replace an answer but the UI never displays it back.
- **Typical uses:** deactivate an inaccessible shard site; enlarge a riddle zone in a GPS dead spot.
- **The treasure point can only be edited before `cursed`.** Moving it after readings exist would make every logbook bearing wrong. The dashboard blocks it with an explicit warning.

### 7.3 Messages (existing)

Broadcasts to all, to a crew, or to one player. Phase controls have default in-fiction announcements that the GM can replace.

### 7.4 Resources view

The dashboard shows each crew's captain, members, shards, doubloons, oath count and reading count, with captain and balance controls. The site board lists active claims and their solvers, allows claim voids, and removes unused registered sites during setup. The RPC also returns last-claim and Mercy timestamps. GM history loads ledger, claims, readings, resolved/disputed Parleys and reasoned GM changes in pages of 50, with a crew filter and older-entry cursor. Historical resolved or disputed Parleys can be voided with a reason and the usual overdraw check. Reading history contains no reading-void control.

### 7.5 Positions

The map and its mapless player-position fallback show permitted player locations with staleness/accuracy information. The Pirate treasure marker is GM-only. The dashboard warns about GPS older than 120 seconds, missing fixes or sharing being off. It warns when fresh shared positions within one crew are over 150 m apart; stale positions do not inflate spread. Alerts are informational and update with the dashboard refresh. Time Hunt boundary enforcement only runs during a Hunt round; a printed Pirate route boundary is an operational rule, not an automatic Pirate elimination rule.

### 7.6 Corrections

All corrections are `SECURITY DEFINER` RPCs with a GM role check (the same pattern as the existing `gm_set_hunt_chain` / `gm_restore_player`), a required `reason`, and an emitted event.

| Implemented RPC | Effect |
| --- | --- |
| `gm_claim_for(g, crew, zone_id, reason, idem)` | Grants the next-rank riddle reward once without GPS, answer, pause or phase gates, including after finish. Requires a same-game crew/riddle and a 3–300 character reason; saves the request response for safe retry and rejects changed arguments under the same request ID. Marks the GM claim and its author; oath disclosure stays crew-scoped. |
| `gm_set_mercy(g, crew, minutes, reason)` | Replaces immunity with 0–120 minutes; zero clears it. Recorded manually, so voiding an older Parley cannot erase it. |
| `gm_replace_captain(g, crew, captain, reason, expected_captain)` | Chooses a current player in the same crew in any unfinished phase. Preserves the crew’s readings, removes the former captain’s app access and rejects a stale captain selection. Notes already copied outside the app cannot be withdrawn. |
| `gm_set_pirate_settings(g, settings, reason, expected_settings)` | Validates a partial settings object, applies future rules in unfinished phases and rejects a stale settings snapshot. See section 7.7. |
| `gm_adjust(g, crew, currency, delta, reason)` | Adds/removes 1–1000 bearing shards or doubloons with a 3–300 character reason; rejects a negative resulting balance. Available in every phase. |
| `gm_void_claim(g, claim_id, reason)` | Voids a riddle claim, reverses shard/doubloon rewards, withdraws its current oath line and permits re-claim; refuses an overdraw. It does not re-rank other crews. |
| `gm_void_parley(g, parley_id, reason)` | Voids a session and compensates its transfers; clears only Mercy sourced from that session. Dashboard history also supports voiding resolved sessions. Manual Mercy overrides are preserved. |
| `gm_resolve_parley(g, parley_id, winner_faction, currency, reason)` | Resolves a disputed exchange; Yield must award attacker doubloons. GM adjudication bypasses player location/phase gates. |
| `gm_award_treasure(g, faction_id, reason)` | Awards frozen value once in `hoard` after the GM hears the oath. No digital oath verification. |
| `gm_void_treasure(g, reason)` | Reverses the active award if the balance permits; re-award uses the same frozen value. |

Reading voids (`gm_void_reading`) and pause-aware timeouts remain deferred in [AGENT_PLAN.md](AGENT_PLAN.md). The other correction tools above exist in reviewed source; hosted availability requires the GM-control migration.

Players see corrections in their logbook as "The Admiralty has ruled: ..." with the reason. Transparency avoids "the GM is cheating" suspicion in a friendly group.

### 7.7 Editable payouts and timers

These values are defaults, including the earlier Parley rules in section 5. Settings changes need a 3–300 character reason and a GM role. Existing rewards, saved responses, Mercy/lockout/pair-cooldown deadlines and the first frozen hoard value are preserved. A code snapshots the encounter’s rules when opened; joining, reports, plunder, expiry and GM rulings use that snapshot. Mid-game edits affect future claims and newly opened codes. GPS freshness (120 s), proximity (75 m) and hoard exclusion (100 m) are fixed safety checks.

| Setting | Default | Allowed whole numbers |
| --- | --- | --- |
| Riddle payouts by rank | 20, 15, 10, 5; tail repeats | 1–20 ranks, each 0–1000 doubloons |
| Treasure percentage | 40 | 0–100%; rounded, hard cap 1000 doubloons |
| Yield percentage / minimum | 10% / 3 | 0–100% / 0–1000 doubloons |
| Fight percentage / minimum | 25% / 5 | 0–100% / 0–1000 doubloons |
| Automatic Mercy / pair cooldown | 900 / 1800 seconds | 0–7200 seconds each |
| Attacking window / limit | 3600 seconds / 3 | 60–86400 seconds / 1–100 sessions |
| Code validity / encounter inactivity | 90 / 300 seconds | 30–600 / 60–3600 seconds |
| Wrong-answer lockout / attempts | 120 seconds / 3 | 30–600 seconds / 1–10 attempts |

Yield/Fight doubloons still round upward and cannot overdraw the losing crew. A zero payout produces no zero-value ledger row. The last riddle amount repeats for every later crew.

### 7.8 Who does what during the event (2 GMs)

| Role | Before 17:30 | 17:30 to 18:30 |
| --- | --- | --- |
| **Admiralty** (dashboard GM, laptop or tablet) | Phase changes, broadcasts, dispute queue, recorded GPS failures and audited balance corrections, resource and position monitoring | Same, plus Last Plunder disputes and the recall at 18:20 |
| **Ghost Captain** (NPC, phone with the dashboard in a mobile browser) | Roams as a ghost for colour and safety spotting; can check crew balances on the phone | Stands at the treasure, hears the oath, awards the treasure from the phone (`gm_award_treasure`) |

Both are `gm` members of the game. If the Admiralty's connection fails, the Ghost Captain can perform every correction from the phone, so the responsive dashboard is part of the safety plan, not a nice-to-have.

---

## 8. Risks for the afternoon/dusk event

| Risk | Mitigation |
| --- | --- |
| **Battery** (~5 h event window) | Power bank mandatory per player; charging at the Truce; Near/Far GPS profile |
| **Cold** (late October, including dusk) | Truce indoors; GMs identify optional warm-up stops outside gameplay |
| **Halloween crowds**, plus many civilian "pirates" | Crew armbands, no-contact Parley, no alcohol until Final Muster, manual headcounts and crew check-ins, PvP kill switch |
| **Mobile data congestion** | GPS queue tolerates outages; gameplay actions need a live connection. Record offline results for later audited GM balance correction; use the reasoned `gm_claim_for` recovery once the hosted migration is applied |
| **GM overload during the Last Plunder window** | Canned messages, a dispute queue rather than live phone calls, and the PvP kill switch |
| **Transport home** | Agree on the Final Muster venue near transport; confirm in the briefing |

---

## 9. Open questions

1. Separate treasure point and 3 lighthouse candidates for the triangulation simulation (use the placement simulator, then survey in person).
2. The riddle texts and answers (content, owner).
3. Printed chart design.
