# The Black Tide: Halloween Pirate Treasure Hunt
Game guide for the PirateGame theme (test run), built on the LarpPassport engine.
Version 3.3, 2026-10-07. Game date: Saturday 2026-10-31, 16:30 to 23:00.

Numbers are starting values to validate in the test run. Implementation instructions live in [AGENT_PLAN.md](AGENT_PLAN.md). This guide describes intended rules, not implemented behaviour.

---

## 1. Decisions locked

| Topic | Decision |
| --- | --- |
| Event | Test run, friendly group, up to 20 players, no release freeze |
| Schedule | **16:30 to 23:00**, confirmed |
| Staff | **2 GMs**: the Admiralty (dashboard) and the Ghost Captain (street and treasure NPC) |
| Tavern Truce venue | To be booked; the `truce` phase pauses claims and Parley globally, with no Safe Harbour zones |
| Crews | 5 crews of up to 4 (confirm actual roster before setup). Each crew has one captain: the GM picks it in setup, a one-player crew's player is captain automatically, and captains lock when charting starts. |
| Currencies | Bearing shards, oath words, doubloons |
| Riddle sites | Five shard sites each give **one shard plus ranked doubloons**; four oath sites each give **one oath word plus ranked doubloons**, after the correct answer |
| Oath words | Shown in the app once earned; traded freely through roleplay; not plunderable |
| Doubloons | From all nine riddle sites after correct answers, plunder, treasure; lighthouses pay nothing |
| Parley | In app; rock-paper-scissors played physically; both sides enter the agreed result; Yield or Fight |
| Treasure | 40% of the highest crew doubloon score at the first `hoard` opening, rounded to the nearest whole doubloon; claimed by speaking the oath to an on-site NPC |
| GM dashboard | Full control layer: zones, messages, resources, positions, corrections (section 7) |

---

## 2. Schedule (16:30 to 23:00)

| Time | Phase | Notes |
| --- | --- | --- |
| 16:30 | **Muster** (at the Truce venue or another chosen meeting point) | Briefing, crews, armbands, app join, consent, battery check |
| 17:00 | **Act I: Charting** | Daylight. Shard and oath riddle sites open. PvP off. Compass needs shards and dark, so no readings yet. |
| ~17:20 | **The Curse Wakes** | Sunset (verify exact time for the location). GM triggers it from the dashboard: lighthouses and PvP turn on. |
| 19:45 to 20:30 | **Tavern Truce** | Supper break indoors. PvP and claims paused globally. Warm up, charge phones, trade oath words, form alliances. |
| 20:30 | **Act II: The Hunt** | Everything on |
| 22:00 | **The Hoard Surfaces** | GM opens `hoard`, freezing the treasure value from the current leading doubloon score; the NPC takes position. Before opening the compass works but the ground is sealed. |
| 22:00 to 22:50 | **Last Plunder** | After the treasure is found, the game continues. The finding crew is now the richest target in town. |
| 22:50 | Recall | GM ends PvP and claims |
| 23:00 | **Final Muster** | Scoring, awards |

### Why the treasure is gated to 22:00

With 6.5 hours, a strong crew could triangulate and dig by 20:00. That ends the story two hours early and leaves everyone else with nothing to aim for. Gating it to 22:00 gives you:

- a fixed climax for every crew;
- a reason to keep improving the compass rather than rushing;
- the NPC only needs to be on site for one hour.

The Last Plunder window is the payoff: the finding crew has to survive 50 minutes while carrying a fat purse. Davy's Mercy and the Parley cap still protect them from being farmed.

### The break is not optional

6.5 hours outdoors on a late-October night means cold, fatigue and flat phones. The truce gives a fixed point to recover all three, and a natural place for oath trading, which is the roleplay you want to see.

---

## 3. Site counts (rescaled for the longer game)

Play time is about 285 minutes: 390 minutes total, minus 30 muster, 45 truce and 30 final muster. The route and activity timing must be remeasured for this smaller layout.

| Site | Count | Zone setup | Per-crew rule |
| --- | --- | --- | --- |
| Shard riddle sites | **5** | circle 40-50 m, `silent`, dwell 20 s; private site kind `riddle`, reward `bearing` | Once per crew after correct answer, +1 shard and doubloons by successful-answer rank |
| Oath riddle sites | **4** (one per oath word) | same, reward `oath`, oath index 1..4 | Once per crew after correct answer, reveals that word and pays doubloons by successful-answer rank |
| Lighthouses | **3** | circle 40-60 m, `silent`, dwell 20 s; private site kind `lighthouse` | One reading per crew per lighthouse per shard level; no site reward |
| Treasure | **1** | Secret point set by the GM (not a map zone; the `treasure` site kind was removed 2026-10-07) | Separate staffed point; GM award in `hoard` phase |

Total: **12 activity sites plus 1 separate treasure point = 13 physical locations**. There are no caches or Safe Harbour zones.

**Mark shard and oath sites differently on the printed chart.** Crews then plan, for example: "we skip the far oath site and trade for that word at the Truce". That is the decision you want them making. Hidden reward types would make it a lottery.

One word per oath site means no crew collects all four on its own schedule without effort. They either walk far or trade. That is the roleplay hook working as intended.

### Time budget per crew

The former 29-point estimate no longer applies. In the field rehearsal, time a route that earns at least three shards, visits two distinct lighthouses, finds or trades the four oath words, and reaches the treasure after 22:00. If that finishes too early, improve story and interaction pacing before adding locations. If it overruns, shorten walking distances or puzzle time.

---

## 4. Bearing shards and compass

| Shards | Arc half-width | Player feel |
| --- | --- | --- |
| 0 | Needle spins | Useless: “the glass is broken” |
| 1 | ±90° | Somewhere that way-ish |
| 2 | ±45° | A quadrant |
| 3 | ±25° | A street direction |
| 4 | ±12° | A block |
| 5+ | ±5° | Near-certain |

- Only the crew captain's app shows the compass: readings, the reading logbook and distance bands. Shards, doubloons and oath words belong to the whole crew.
- Shards above 5 act as a theft buffer.
- Distance bands (≤100 m and ≤25 m only) unlock at 3+ shards.
- Arcs are computed server-side from the lighthouse centre, with a deterministic HMAC offset per crew, lighthouse and shard level.

---

## 5. Doubloons

Each of the **five shard sites** gives the claiming crew +1 shard and doubloons. Each of the **four oath sites** gives one oath word and doubloons. The crew must submit the correct on-site answer before either reward is granted. **Rank is set by the order of correct answers, not GPS arrival.** Doubloons pay **20 / 15 / 10 / 5 / 5** by rank. Each riddle site pays at most 55 across five crews, or **495 across all nine**. Rewards are one successful claim per crew per site: the first crewmate to answer correctly claims for the whole crew, and a later crewmate's correct answer earns nothing. Lighthouses pay no doubloons. This rule is approved but still needs implementation and balance testing.

**Treasure value = round(0.40 × the highest crew's doubloon balance when `hoard` first opens)**, normally at 22:00. Scores include riddle-site awards, Parley transfers and GM corrections recorded before that phase change, but no treasure award. For example, a leading balance of 103 makes the treasure worth 41 doubloons. Freeze and audit the leading balance and calculated value once; stepping back and reopening `hoard`, voiding an award, or awarding it later must not recalculate it. If every crew has zero, the value is zero. Recheck balance after the new route and payout are playtested.

Plunder and protections are unchanged:

| Outcome | Winner takes |
| --- | --- |
| Yield | 10% of doubloons (minimum 3), never a shard |
After the physical exchange, the two players in that Parley independently confirm the result in the app. Yield requires both to confirm the attacker as winner. Fight requires both to report the same winning crew. No currency or shard moves after only one report. A disagreement or timeout goes to the GM for a reasoned ruling or void.
| Lose a Fight | Winner's choice: 1 shard or 25% of doubloons (minimum 5) |

- Davy's Mercy: 15 minutes of immunity after being plundered.
- The same pair of crews cannot Parley again for 30 minutes.
- Maximum 3 Parleys initiated per crew per hour.
- No Parley during the Truce, or within 100 m of the treasure in the `hoard` phase. The GM can also disable Parley globally.

---

## 6. Data model (player side)

Proposed private tables (the agent plan gives their full schemas):
- `pirate_games`: mode marker, secret treasure point and value; `hoard` phase controls opening
- `pirate_sites`: answer hashes and oath words for registered zones
- `pirate_claims`: unique active `(faction_id, zone_id)` claims, with riddle-site successful-claim rank and void flag
- `pirate_ledger`: append-only bearing shard and doubloon entries, with source, reference, reason and actor
- `pirate_readings`: unique active `(faction_id, zone_id, shards)` compass readings
- `pirate_parleys`: state machine, both reports and resolution state

Oath words are not a ledger currency. A crew's words are derived from its non-voided oath `pirate_claims`, shown in the Hold screen and logbook.

Player RPCs: `claim_site`, `compass_reading`, `open_parley`, `join_parley`, `parley_choice`, `parley_report`. Every gameplay RPC checks `games.phase` and the Pirate pause flag, so GM phase and pause changes take effect server-side.

---

## 7. GM control layer (dashboard)

Principle: **the GM never edits history, only adds to it.** Every correction is a new ledger row or a void flag, carries a mandatory reason, records who did it, and emits a `game_events` row. You get a full audit trail at Final Muster, and any mistaken correction can itself be reversed.

### 7.1 Game phase control

A `games.phase` value drives everything:

```
setup → charting → cursed → truce → hunt → hoard → recall → finished
```

| Control | What it does |
| --- | --- |
| Phase buttons | Advance phase. Each change emits a broadcast event players see. |
| PvP kill switch | Disables Parley globally without changing phase (for disputes, safety or weather) |
| Pause all | Freezes claims, readings and Parley; the app shows "The tide has stopped" |
| Treasure opening | Advance to `hoard` at 22:00, or change the phase time as a GM decision |

### 7.2 Zones (largely existing)

- **Create, move, resize and deactivate zones on the map.** The existing `rearm_zone_on_change` handles state when geometry changes.
- **Pirate-specific fields:** kind, reward type and oath word index, edited through a GM form and stored in private Pirate site state. Answers are write-only from the dashboard: the GM can set or replace an answer but the UI never displays it back.
- **Typical uses:** deactivate an inaccessible shard site; enlarge a riddle zone in a GPS dead spot.
- **The treasure point can only be edited before `cursed`.** Moving it after readings exist would make every logbook bearing wrong. The dashboard blocks it with an explicit warning.

### 7.3 Messages (existing)

Broadcasts to all, to a crew, or to one player. Add canned in-fiction messages for phase changes, so a stressed GM taps a button instead of writing prose.

### 7.4 Resources view

Crew table, live via Realtime on `game_events`:

| Crew | Shards | Doubloons | Oath words (n/4) | Readings | Mercy until | Last claim | Members stale |
| --- | --- | --- | --- | --- | --- | --- | --- |

Opening a crew shows:
- the ledger history, with source and actor per row;
- its site claims and riddle-site successful-claim ranks;
- its compass readings (centre and width, so the GM can see who is close);
- its Parley history.

There is also a riddle-site board showing which crews solved each site and in what order.

### 7.5 Positions (existing, extended)

The existing map plus the mapless fallback table:
- players coloured by crew;
- staleness and accuracy flags;
- the treasure point shown to GM only.

Add a "crew spread" warning when members of a crew are more than ~300 m apart. That is a safety check: crews should move together at night.

### 7.6 Corrections

All corrections are `SECURITY DEFINER` RPCs with a GM role check (the same pattern as the existing `gm_set_hunt_chain` / `gm_restore_player`), a required `reason`, and an emitted event.

| RPC | Use case | Effect |
| --- | --- | --- |
| `gm_adjust(g, crew, currency, delta, reason)` | Anything deemed unfair; manual scoring | Compensating ledger row. Balance can't go below zero. |
| `gm_claim_for(g, crew, zone, reason)` | GPS failed but the crew was clearly there and phoned the GM with the answer | Creates the claim without the presence check. Riddle-site successful-claim rank is computed at that moment. |
| `gm_void_claim(g, claim_id, reason)` | Claim made by mistake or by cheating | Voids the claim, writes the reversing ledger row, removes the oath word, and allows a re-claim |
| `gm_void_parley(g, session_id, reason)` | Dispute, or a result entered wrongly | Reverses both ledger rows and clears the Mercy it granted |
| `gm_resolve_parley(g, session_id, winner, choice, reason)` | Reports disagree or a session timed out | Applies the outcome as if both had agreed |
| `gm_void_reading(g, reading_id, reason)` | Reading taken from a wrongly placed lighthouse | Voids the reading; the crew can read again there |
| `gm_set_mercy(g, crew, until, reason)` | Protect a crew that is being farmed, or lift a stuck immunity | Overrides the Mercy timer |
| `gm_award_treasure` | NPC confirms the spoken oath | Awards the frozen treasure value once in `hoard`; void/re-award uses the same value |

Players see corrections in their logbook as "The Admiralty has ruled: ..." with the reason. Transparency avoids "the GM is cheating" suspicion in a friendly group.

### 7.7 Who does what on the night (2 GMs)

| Role | Before 22:00 | 22:00 to 23:00 |
| --- | --- | --- |
| **Admiralty** (dashboard GM, laptop or tablet) | Phase changes, broadcasts, dispute queue, `gm_claim_for` when GPS fails, resource and position monitoring | Same, plus Last Plunder disputes and the recall at 22:50 |
| **Ghost Captain** (NPC, phone with the dashboard in a mobile browser) | Roams as a ghost for colour and safety spotting; can check crew balances on the phone | Stands at the treasure, hears the oath, awards the treasure from the phone (`gm_award_treasure`) |

Both are `gm` members of the game. If the Admiralty's connection fails, the Ghost Captain can perform every correction from the phone, so the responsive dashboard is part of the safety plan, not a nice-to-have.

---

## 8. Risks for a 23:00 finish

| Risk | Mitigation |
| --- | --- |
| **Battery** (~6.5 h of GPS) | Power bank mandatory per player; charging at the Truce; Near/Far GPS profile |
| **Cold** (late October nights) | Truce indoors; GMs identify optional warm-up stops outside gameplay |
| **Peak Halloween crowds and drinking after 21:00**, plus many civilian "pirates" | Crew armbands, no-contact Parley, no alcohol until Final Muster, crew-spread warning, PvP kill switch |
| **Mobile data congestion late evening** | Offline-tolerant queue; claims retryable; `gm_claim_for` as the manual fallback |
| **GM overload during the Last Plunder window** | Canned messages, a dispute queue rather than live phone calls, and the PvP kill switch |
| **Late finish and transport home** | Agree on the Final Muster venue near transport; confirm in the briefing |

---

## 9. Open questions

1. Separate treasure point and 3 lighthouse candidates for the triangulation simulation (task S01 in the agent plan).
2. The 4 oath words and the riddle texts and answers (content, owner).
3. Printed chart design.
