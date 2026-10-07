import { C } from './theme'

// Player-facing catalogue of game_events types. The events list, push
// notifications and the realtime "reload the hunt" rule all read from here;
// nothing else in the app branches on an event type.
//
// tag: label and colours for the event card. title: card heading.
// notification: push title. body: fallback card text when the event carries no
// payload message. affectsHunt: the hunt status must be reloaded. boundary:
// play-area edge event. notifies: false when the player caused the event.

const FIELD = { label: 'FIELD EVENT', color: C.muted }
const BOUNDARY = { label: 'BOUNDARY', color: C.amber, borderColor: C.amberBorder, titleColor: C.amber }
const MESSAGE = (label) => ({ label, color: C.cyan, borderColor: C.cyanBorder })
const HUNT_GOOD = { label: 'HUNT', color: C.green }
const HUNT_OPEN = { label: 'HUNT', color: C.amber }
const HUNT_BAD = { label: 'HUNT', color: C.red }
const PIRATE = { label: 'PIRATE', color: C.amber, borderColor: C.amberBorder }

const DEFAULTS = {
  tag: FIELD,
  title: 'Field state changed',
  notification: 'New passport event',
  body: '',
  affectsHunt: false,
  boundary: false,
  notifies: true,
}

const EVENTS = {
  zone_enter: {},
  zone_exit: {},
  zone_boundary_warning: {
    tag: BOUNDARY, boundary: true,
    title: 'Anomaly boundary ahead',
    notification: 'Time anomaly boundary warning',
    body: 'Move back toward the safe interior.',
  },
  zone_boundary_exit: {
    tag: BOUNDARY, boundary: true, affectsHunt: true,
    title: 'You left the time anomaly',
    notification: 'You left the time anomaly',
    body: 'Claims active at the recorded exit may have been forfeited. The GM was alerted.',
  },
  gm_note: { tag: MESSAGE('GM NOTE'), title: 'Message from your GM', notification: 'Message from your GM' },
  player_message: { tag: MESSAGE('PLAYER MESSAGE'), title: 'Message sent to your GM', notifies: false },
  consent_granted: { title: 'Location sharing on' },
  consent_revoked: { title: 'Location sharing off' },
  hunt_started: { tag: HUNT_GOOD, affectsHunt: true, title: 'The hunt has begun', notification: 'The hunt has begun' },
  hunt_finished: { tag: HUNT_GOOD, affectsHunt: true, title: 'The hunt is over', notification: 'The hunt is over' },
  hunt_player_restored: { tag: HUNT_GOOD, affectsHunt: true, title: 'The GM restored a traveller', notification: 'Traveller restored' },
  hunt_chain_changed: { tag: HUNT_GOOD, affectsHunt: true, title: 'The GM corrected the target chain', notification: 'Target chain corrected' },
  hunt_target_assigned: { tag: HUNT_GOOD, affectsHunt: true, title: 'New target assigned', notification: 'New target assigned' },
  elimination_requested: { tag: HUNT_OPEN, affectsHunt: true, title: 'Elimination confirmation requested', notification: 'Confirm an elimination' },
  elimination_claimed: { tag: HUNT_OPEN, affectsHunt: true, title: 'Waiting for target confirmation', notification: 'Elimination claim sent' },
  elimination_rejected: { tag: HUNT_BAD, affectsHunt: true, title: 'Elimination claim rejected', notification: 'Elimination rejected' },
  elimination_confirmed: {
    tag: HUNT_GOOD, affectsHunt: true,
    title: 'Timeline correction confirmed',
    notification: 'Target eliminated',
    body: 'Wait for the GM to assign your next target. A 10-minute temporal cloak is active.',
  },
  eliminated: { tag: HUNT_BAD, affectsHunt: true, title: 'You have been eliminated', notification: 'You have been eliminated' },
  pirate_phase: { tag: PIRATE, title: 'The tide has changed', notification: 'The tide has changed', body: 'Open your logbook for the current phase.' },
  pirate_claim: { tag: PIRATE, title: 'Your crew claimed a site', notification: 'Site claimed', body: 'A reward has been added to your crew logbook.' },
  pirate_reading: { tag: PIRATE, title: 'New lighthouse reading', notification: 'New bearing recorded', body: 'A new arc is in your compass logbook.' },
  pirate_parley: { tag: PIRATE, title: 'Parley changed', notification: 'Parley update', body: 'Open the Parley screen to review the result.' },
  pirate_ruling: { tag: PIRATE, title: 'Admiralty ruling', notification: 'Admiralty ruling', body: 'The GM has corrected a Pirate result.' },
  pirate_treasure: { tag: PIRATE, title: 'The hoard was claimed', notification: 'The hoard was claimed', body: 'A crew has claimed the treasure.' },
}

// Installed APKs lag the server, so a hunt or elimination type added later
// still reloads the hunt and gets a hunt tag.
function fallback(type) {
  if (type.startsWith('elimination_')) return { tag: HUNT_OPEN, affectsHunt: true }
  if (type.startsWith('hunt_')) return { tag: HUNT_GOOD, affectsHunt: true }
  if (type.startsWith('pirate_')) return { tag: PIRATE }
  return {}
}

export function eventInfo(type) {
  const key = String(type ?? '')
  const known = Object.prototype.hasOwnProperty.call(EVENTS, key)
  return { ...DEFAULTS, ...(known ? EVENTS[key] : fallback(key)) }
}
