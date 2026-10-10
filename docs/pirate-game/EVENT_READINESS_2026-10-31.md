# The Black Tide — Plovdiv event readiness checklist

Internal readiness updated 9 October 2026; location/venue research remains dated 7 October. Event: Saturday 31 October, 13:30–18:30 (Plovdiv local time), uncapped players and crew sizes, aiming for five crews, two GMs. The [game guide](GAME_GUIDE.md) defines approved rules; [implementation status](IMPLEMENTATION_STATUS.md) records code evidence. A checkbox here means work still to do unless explicitly marked complete. No venue, outdoor point, permit, or APK is booked, surveyed, or approved by this document.

**Latest scope:** 5 shard riddles (each +1 shard and doubloons), 4 oath riddles (each one word and doubloons), 3 reading-only lighthouses, and a separate staffed treasure point: **12 activity sites, 13 physical locations**. Each riddle site's doubloons follow the order of correct answers, 20/15/10/5, then 5 for every later successful crew. No caches or Safe Harbour zones. This supersedes the earlier layouts.

## 1. Decisions and critical path

- [x] Fix city, date, flexible attendance, target crew structure, and ranked rewards: Plovdiv; 31 October; no player, crew-count or crew-size cap; aim for five crews; all nine riddle sites pay 20/15/10/5, then 5 for every later successful crew. With five crews solving all nine, they distribute 495 doubloons; each additional crew solving all nine adds 45. The riddle rewards and frozen treasure value are implemented; field balance remains unverified.
- [ ] Name the event owner, Admiralty GM, Ghost Captain GM, and a backup contact. Decide who can make a final safety call and who can change game rules on the night.
- [ ] Confirm player age range, accessibility needs, language, budget per person, and whether everyone can use an Android phone. Android is the supported distribution here; an iOS build and device flow have not been verified. Arrange loaner Android phones if needed.
- [ ] Choose and reserve one central, indoor Tavern Truce and Final Muster venue for the confirmed roster plus two GMs, 13:30 lunch/Muster, 16:00–16:15 Truce, and 18:30 awards. Confirm seating, food, toilets, charging, noise, costumes, payment and availability through awards. The `truce` phase pauses play globally; the venue has no Safe Harbour zone.
- [ ] Complete a daylight scouting walk, then a dusk/night walk, before locking any zone. Confirm accessibility at the exact intended hours; do not put an answer behind a ticket gate or inside a building that closes before the last crew arrives.
- [ ] Fix the separate treasure point and three lighthouse centres, run `tools/pirate/simulate_triangulation.py`, and validate on the ground. Keep the exact treasure point GM-only.
- [ ] Write and test all 9 riddles against the chosen physical features. Enter the content only after code, database, and route are ready.
- [ ] Complete the code and release gates in sections 5–6, then run a real-field rehearsal on 24 October. Fix blocking defects before printing final charts.

## 2. Plovdiv location research and selection

**Recommended search area:** a compact walking circuit around the Main Pedestrian Street, Roman Stadium, Kapana, the accessible approaches to Old Town, and Tsar Simeon Garden. The [official visitor guide](https://www.visitplovdiv.com/en/node/723) connects these areas on foot. The [Old Town reserve](https://www.visitplovdiv.com/en/node/676) contains Hisar Kapia, Nebet Tepe and the Ancient Theatre; its steep, uneven lanes need night inspection. Plovdiv sunset on 31 October is about **17:16 local time**, so the 17:30 hoard opening is around dusk; compass/PvP open earlier at 15:00; verify the forecast and light levels closer to the event ([sun table](https://www.timeanddate.com/sun/bulgaria/plovdiv?month=10&year=2026)).

These are **candidate clusters, not approved game pins**. Some contain several possible public-side positions; a specific zone must be picked after surveying GPS, crowding, sight lines and access.

| Candidate cluster | Good role to test | Inspection question |
| --- | --- | --- |
| Tsar Simeon Garden / Central Square edge | Muster, shard or oath riddle, possible lighthouse | Is the chosen path well lit and open through 18:20? Keep clear of fountains and traffic. |
| Roman Forum / Odeon exterior | Shard or oath riddle, lighthouse | Can the feature be read from a public path after dusk? |
| Main Street / Stefan Stambolov Square | Shard or oath riddle | Can a crew pause without blocking pedestrian traffic? |
| Roman Stadium Square | Landmark riddle or lighthouse | Keep the zone on the public square, outside ticketed archaeology. |
| Sahat Tepe lower approach / Clock Tower route | Lighthouse or early riddle | Verify slope, steps, lighting and safe turnaround; avoid an exposed summit late at night. The tower is about 5–6 minutes from Stadium Square ([visitor guide](https://www.visitplovdiv.com/en/node/828)). |
| Kapana pedestrian lanes | Shard or oath site, Truce candidate | Halloween crowd and restaurant queues may make GPS and dwell unreliable. The district is a compact pedestrian area ([visitor guide](https://www.visitplovdiv.com/en/node/2984)). |
| Hisar Kapia / Old Town lower streets | Riddle or lighthouse | Preserve access to homes, churches and protected fabric; check cobbles and steepness. |
| Ancient Theatre exterior approach | Riddle or lighthouse | Use only a public, unticketed viewpoint; the theatre is an active performance venue ([visitor guide](https://www.visitplovdiv.com/en/node/522)). |
| Nebet Tepe lower approach | Optional early site | Exclude if unlit, slippery, crowded or GPS-poor after dark. |
| Rayko Daskalov pedestrian corridor / covered Maritsa bridge | Optional northern lighthouse | Check the boulevard crossing and whether the bridge is crowded; never require riverbank access. The pedestrian corridor is described by the [visitor guide](https://www.visitplovdiv.com/en/node/723). |

- [ ] Survey about **18–22 candidate micro-sites** to select 13 physical points plus backups: 5 shard riddles, 4 oath riddles, 3 lighthouses, and 1 separate treasure. A cluster may hold several points only if geofences cannot overlap and crews can distinguish them.
- [ ] For each candidate record coordinates, exact public-side standing spot, photo, feature used by the clue, estimated safe capacity for the actual crew sizes, lighting, stairs, toilets/transport nearby, GPS accuracy on two Android models, mobile-data signal, expected crowd, opening hours, venue/authority contact, fallback spot, and GM approval.
- [ ] Choose one play-area boundary that encloses every active point and safe walking route. Mark prohibited shortcuts, road crossings and any dark/steep segments on the crew chart.
- [ ] Choose three lighthouse centres around the eventual treasure with varied bearings. Reject near-parallel crossings and points too close/far using the simulator, then test real readings; no public page can prove geometry or GPS quality.
- [ ] Select the treasure as a staffed, public-accessible, level location with room for several crews at 17:30–18:20. The Ghost Captain awards it digitally; no digging, hidden object or touching monuments.
- [ ] Ask Plovdiv Municipality/Old Town management what consent or permits are needed for an organized game, costumes, props, staff at a fixed point, or printed material. Obtain written venue permission for any restaurant or private property. The [tourist information centres](https://www.visitplovdiv.com/en/contact-en) can help identify site contacts; they do not grant permission.

**Truce venue calls to make now:** [Cavea at Roman Stadium Square](https://cavea.bg/) advertises private events; [Patriki on Rayko Daskalov](https://www.patriki-rest.com/en) advertises group bookings and a private room; [Restaurant TheateR](https://restauranttheater.bg/en/contact/) accepts event enquiries near Main Street. Ask each for a firm 31 October offer for the confirmed roster plus two GMs, 13:30 lunch and 16:00–16:15 Truce service, an indoor table or room, sockets, accessible toilet and 18:30 awards availability. These are leads, not reservations or verified capacity.

## 3. Riddles, story and physical production

- [ ] Write a one-page player premise: why the crews seek the Black Tide, what bearing shards do, how the four oath lines form the spoken oath, how doubloons determine the winner, and why the Ghost Captain waits until dusk at 17:30.
- [ ] Write the briefing, consent and safety script, in-fiction phase broadcasts, tavern trading prompt, Ghost Captain dialogue, emergency stop announcement, and final awards script. Keep all game instructions clear when read aloud over street noise.
- [ ] Make **9 unique site riddles**: five shard riddles and four oath riddles. Draft concepts below; final text and answer must be derived from what a player can actually see from the permitted public standing spot. The examples are prompts for writing, not approved answers or site assignments.

| Slot | Site-linked riddle concept | What to verify |
| --- | --- | --- |
| Shard 1 | Roman Stadium: a captain hears a crowd beneath the street; ask for a visible feature of the northern curve. | Feature is readable after dark from public side. |
| Shard 2 | Clock Tower: a sleepless lookout counts time, not ships; use one fixed detail visible from the chosen approach. | Do not require climbing an unlit hill. |
| Shard 3 | Roman Forum: the buried market becomes a port ledger; use a visible sign or architectural feature. | Text is legible and not behind glass after hours. |
| Shard 4 | Kapana: the “trap” of craft streets hides a trade; identify a street name or fixed craft motif. | Nameplate is present and readable. |
| Shard 5 | Main Street: the buried Roman route is the ship's keel; ask for a stable named landmark at the pin. | Not answerable from a distant photo alone if presence is important. |
| Oath 1 | “First watch”: a word earned at an early, accessible landmark. | One unambiguous answer; word displayed by app after claim. |
| Oath 2 | “The bargain”: a word from the market/Kapana side to encourage trading at Truce. | Site is not drowned by Halloween foot traffic. |
| Oath 3 | “The crossing”: a word from a safe public crossing/bridge motif. | No unsafe crossing or riverbank access. |
| Oath 4 | “The last light”: a word from the Old Town/theatre approach, reachable before and after dark. | No ticket or opening-hour dependency. |

- [ ] For each riddle record: pin ID, crew-facing title, exact prompt, normalized accepted answer(s), hint 1, hint 2, solution explanation, role in story, difficulty target (roughly 2–5 minutes), and fallback if a sign is removed. Have a writer and a fresh tester solve it independently on site.
- [x] Choose the oath: four numbered lines of verse (one per oath site, each at most 40 characters) with unambiguous order. Check pronunciation in the language used at the event; keep the text secret in GM notes and player rewards only, never in this repository.
- [ ] Set a replacement answer and GM manual claim procedure for every shard and oath riddle. Do not hide containers in public space or attach anything to monuments without permission.
- [ ] Print one chart per confirmed crew plus spare copies, each with a legend distinguishing shard and oath sites and lighthouses, safe routes, play boundary, emergency contact, Truce/Final Muster address, and no exact treasure point. Add armbands or crew markers, GM ID, pencils, weatherproof sleeves, power banks and chargers.
- [ ] Put the Ghost Captain’s costume and any prop through a public-safety check: clearly theatrical, no realistic weapons, no touching or chasing, no prop that looks abandoned or suspicious.

## 4. Players, staff and event operations

- [ ] Confirm the player roster and reserve list. Aim for five crews, with no fixed attendance or crew-size cap; recheck venue, route and staffing capacity against the actual roster; verify each player has a named crew, a working Android phone or loaner, data access, a power bank, warm clothing and a way home.
- [ ] Provide a clear rules/consent sheet before the event: no physical combat, Parley is verbal plus rock-paper-scissors, either person may stop, no pursuit across roads, no alcohol until Final Muster, no entering restricted or private property, no touching archaeological features, and a direct way to reach either GM.
- [ ] Assign the Admiralty to dashboard, phases, support, adjudication and attendance; the Ghost Captain to mobile GM backup, safety observation and staffed treasure. Rehearse handoff if one GM loses data or battery.
- [ ] Write a run-of-show with reminders: 13:30 lunch/Muster; 14:00 charting; 15:00 curse; 16:00–16:15 Truce; 16:15 hunt; 17:30 hoard; 18:20 recall; 18:30 muster/awards. Have one GM check every crew at Truce and Final Muster.
- [ ] Predefine bad-weather and incident triggers: pause all, disable PvP, shorten route, move a site by GM action, abandon a point, or stop the game. Record who decides and how players hear it. Identify accessible shelter and taxi/transit options.
- [ ] Prepare a one-page GM incident log and scoring sheet: timestamps, missing player, site outage, Parley dispute, correction, reason, outcome and crew notified. Keep emergency contact details outside the app as a backup.
- [ ] Budget venue/meal, printing, armbands, loaner phones/SIMs, power banks, prizes, staff transport and contingency. Confirm who pays and when.

## 5. Code and database verification

The implemented rules, source files and current checks are recorded in [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
The revised riddle layout, payouts, frozen hoard value, flexible setup, captains, claim voids and GM balance adjustments already exist.
Do not reimplement them. The owner promoted GM claims, Mercy, captain replacement, editable settings, history/alerts and phase reversal; they now exist in reviewed source. Remaining work is in [AGENT_PLAN.md](AGENT_PLAN.md). Hosted migrations, dashboard delivery and device rehearsal still need verification.

- [ ] Apply the reviewed Parley and uncapped-crew migrations to the hosted backend after verification; compare migration histories and record exact version.
- [ ] Verify both GM accounts, strict proximity at every Parley decision, location outage recovery, expiry/disputes and correction controls against the deployed dashboard and candidate APK.
- [ ] Rehearse the actual event layout. `pirate_validate` warnings about counts do not block games with fewer or more crews; structural issues still block charting.

## 6. Release and field rehearsal

- [ ] Produce an installable Pirate APK with the correct public Supabase configuration and an agreed signing/distribution plan. Its package ID replaces the ordinary LARP Passport app on the same phone; warn testers and plan rollback/reinstall.
- [ ] Boot the exact candidate APK on at least two Android models. Verify login, joining, location sharing and consent, foreground/background recovery, compass heading, all four player tabs, Parley, and battery drain over at least 60 minutes.
- [ ] Deploy a preview dashboard and verify mobile-width Ghost Captain actions. Confirm the dashboard and APK target the same reviewed backend. Record exact commit, CI run, migration list, deployment ID and APK hash in a release record.
- [ ] Before the real-game database is populated, enter the confirmed crews, zone geometry, 12 activity-site records and the separate treasure point, answers, oath lines, treasure and GM roles. Run `pirate_validate` and inspect every failure. Restrict the treasure point and answer list to GMs.
- [ ] Rehearse on **24 October** with two GMs and 4–6 testers at dusk. Walk every proposed point with two Android models. Solve every riddle in place; claim all site types; take and plot several lighthouse arcs; find the treasure from readings; run Yield, Fight, conflicting reports, GM ruling and void; test pause and PvP off; lose data for five minutes and recover; award/void treasure from the Ghost Captain’s phone.
- [ ] Time three realistic crew routes. The old 29-point timing estimate is invalid; confirm this shorter map sustains the 245 playable minutes without forcing every crew to visit every site. Adjust pacing, walking distances or puzzle time from rehearsal evidence.
- [ ] Fix rehearsal defects and freeze gameplay changes by **27 October**. Reprint charts and recheck all pins after any site move. Keep 28–31 October for content, enrolment and verified bug fixes.
- [ ] On 31 October, before Muster: confirm weather and public access, charge devices, test both GM logins, count crews, verify recent GPS from every phone, perform one private test claim/reading/Parley in a test game, confirm venue and Ghost Captain position, and send the emergency contact/rules to all players.
- [ ] At Final Muster: pause/finish server phase, account for every person, resolve pending disputes, capture the final crew scoreboard and GM correction notes, announce results and record incidents and improvements for the next run.

## 7. Go / no-go gates

Do **not** start the live hunt if any of these remain false: safe and permitted route; staffed indoor Truce and Final Muster; both GMs have working access; every player is accounted for and can contact a GM; the planned crew/site layout has been rehearsed; database migrations and concurrency suite pass in an isolated environment; production migration history is reconciled; exact APK works on real devices against the exact backend; treasure and answers stay private; pause/PvP off and GM corrections work; a field rehearsal finds no critical route or GPS failure. The owner and both GMs should sign this off together.

## Source status and references

- Internal rules: [GAME_GUIDE.md](GAME_GUIDE.md); implementation map: [AGENT_PLAN.md](AGENT_PLAN.md); verified-to-date limitations: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).
- Plovdiv visitor information and venue leads are linked beside the relevant proposals above. Public sources establish that these landmarks and businesses exist; they do **not** establish 31 October access, permission, booking, GPS performance or night safety.
