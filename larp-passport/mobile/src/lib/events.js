import { COPY } from './brand'
import { C } from './theme'

// Player-facing catalogue of game_events types. The events list and push
// notifications read from here; nothing else in the app branches on an event
// type.
//
// tag: label and colours for the event card. title: card heading.
// notification: push title. body: fallback card text when the event carries no
// payload message. boundary: play-area edge event. notifies: false when the player caused the event.

const FIELD = { label: 'FIELD EVENT', color: C.muted }
const BOUNDARY = { label: 'BOUNDARY', color: C.amber, borderColor: C.amberBorder, titleColor: C.amber }
const MESSAGE = (label) => ({ label, color: C.cyan, borderColor: C.cyanBorder })
const HUNT_GOOD = { label: 'HUNT', color: C.green }
const HUNT_OPEN = { label: 'HUNT', color: C.amber }
const HUNT_BAD = { label: 'HUNT', color: C.red }
// The Black Tide sorts its events by who or what caused them.
const PIRATE = (label) => ({ label, color: C.amber, borderColor: C.amberBorder })
const TIDE = PIRATE('TIDE')
const CREW = PIRATE('CREW')

const DEFAULTS = {
  tag: FIELD,
  title: 'Field state changed',
  notification: 'New passport event',
  body: '',
  boundary: false,
  notifies: true,
}

const EVENTS = {
  // A notify zone carries the GM's message; a brand may restyle it.
  zone_enter: COPY.log.zoneEnter ?? {},
  zone_exit: {},
  zone_boundary_warning: {
    tag: BOUNDARY, boundary: true,
    title: 'Anomaly boundary ahead',
    notification: 'Time anomaly boundary warning',
    body: 'Move back toward the safe interior.',
  },
  zone_boundary_exit: {
    tag: BOUNDARY, boundary: true,
    title: 'You left the time anomaly',
    notification: 'You left the time anomaly',
    body: 'Claims active at the recorded exit may have been forfeited. The GM was alerted.',
  },
  gm_note: { tag: MESSAGE('GM NOTE'), title: 'Message from your GM', notification: 'Message from your GM' },
  player_message: { tag: MESSAGE('PLAYER MESSAGE'), title: 'Message sent to your GM', notifies: false },
  consent_granted: { title: 'Location sharing on' },
  consent_revoked: { title: 'Location sharing off' },
  hunt_started: { tag: HUNT_GOOD, title: 'The hunt has begun', notification: 'The hunt has begun' },
  hunt_finished: { tag: HUNT_GOOD, title: 'The hunt is over', notification: 'The hunt is over' },
  hunt_player_restored: { tag: HUNT_GOOD, title: 'The GM restored a traveller', notification: 'Traveller restored' },
  hunt_chain_changed: { tag: HUNT_GOOD, title: 'The GM corrected the target chain', notification: 'Target chain corrected' },
  hunt_target_assigned: { tag: HUNT_GOOD, title: 'New target assigned', notification: 'New target assigned' },
  elimination_requested: { tag: HUNT_OPEN, title: 'Elimination confirmation requested', notification: 'Confirm an elimination' },
  elimination_claimed: { tag: HUNT_OPEN, title: 'Waiting for target confirmation', notification: 'Elimination claim sent' },
  elimination_rejected: { tag: HUNT_BAD, title: 'Elimination claim rejected', notification: 'Elimination rejected' },
  elimination_confirmed: {
    tag: HUNT_GOOD,
    title: 'Timeline correction confirmed',
    notification: 'Target eliminated',
    body: 'Wait for the GM to assign your next target. A 10-minute temporal cloak is active.',
  },
  eliminated: { tag: HUNT_BAD, title: 'You have been eliminated', notification: 'You have been eliminated' },
  pirate_phase: { tag: TIDE, title: 'The tide has changed', notification: 'The tide has changed', body: 'The phase line at the top says what is open now.' },
  pirate_captain: { tag: CREW, title: 'Your crew has a captain', notification: 'Captain chosen', body: 'The captain carries the compass.' },
  pirate_claim: { tag: CREW, title: 'Your crew claimed a site', notification: 'Site claimed', body: 'The reward is in your Hold.' },
  pirate_reading: { tag: CREW, title: 'New lighthouse reading', notification: 'New lighthouse reading', body: "A new arc is on the captain's compass." },
  pirate_parley: { tag: PIRATE('PARLEY'), title: 'Parley update', notification: 'Parley update', body: 'Open Parley to see what happens next.' },
  pirate_ruling: { tag: PIRATE('ADMIRALTY'), title: 'The Admiralty has ruled', notification: 'The Admiralty has ruled', body: 'The GM has corrected a result.' },
  pirate_treasure: { tag: TIDE, title: 'The hoard was claimed', notification: 'The hoard was claimed', body: 'A crew has claimed the treasure.' },
}

// Installed APKs lag the server, so a type added later still gets its game's tag.
function fallback(type) {
  if (type.startsWith('elimination_')) return { tag: HUNT_OPEN }
  if (type.startsWith('hunt_')) return { tag: HUNT_GOOD }
  if (type.startsWith('pirate_')) return { tag: TIDE }
  return {}
}

export function eventInfo(type) {
  const key = String(type ?? '')
  const known = Object.prototype.hasOwnProperty.call(EVENTS, key)
  return { ...DEFAULTS, ...(known ? EVENTS[key] : fallback(key)) }
}
