// GM-facing catalogue of game_events types. The event log, the pending
// decision counts, the map's trigger list and the realtime "reload the
// snapshot" rule all read from here. Which types reload a mode's state is
// decided by that mode in gameModes.js.
//
// describe(event, zoneNameOf): what the actor did, shown after their name.
// kind: log label, defaults to the type in capitals. tone: label colour class.
// breach: a play-area exit the GM rules on. quotesMessage: the log shows the
// player's own words. echoesPayload: the zone's message is shown underneath.

const inZone = (verb) => (event, zoneNameOf) => `${verb} ${zoneNameOf(event.zone_id)}`
const quoting = (prefix) => (event) => `${prefix}"${event.payload?.message ?? ''}"`
const says = (text) => () => text

const EVENTS = {
  zone_enter: { describe: inZone('entered'), echoesPayload: true },
  zone_exit: { describe: inZone('left') },
  zone_boundary_warning: { describe: inZone('neared the boundary of'), kind: 'BOUNDARY', tone: 'warning' },
  zone_boundary_exit: { describe: inZone('left'), kind: 'BREACH', tone: 'critical', breach: true },
  gm_note: { describe: quoting('received GM message: ') },
  player_message: { describe: quoting('sent the GM: '), kind: 'PLAYER MESSAGE', tone: 'cyan', quotesMessage: true },
  consent_granted: { describe: says('started sharing location') },
  consent_revoked: { describe: says('stopped sharing location') },
  hunt_started: { describe: says('received a secret target') },
  hunt_finished: { describe: (event) => `was notified that ${event.payload?.winner ?? 'a traveller'} won the hunt` },
  hunt_player_restored: { describe: says('was notified that the GM restored a traveller') },
  hunt_chain_changed: { describe: says('received a corrected target assignment from the GM') },
  hunt_target_assigned: { describe: says('received their next target from the GM') },
  elimination_requested: { describe: says('was asked to confirm an elimination') },
  elimination_claimed: { describe: says('submitted an elimination claim') },
  elimination_rejected: { describe: says('received an elimination rejection') },
  elimination_confirmed: { describe: says('confirmed an elimination and is awaiting the next GM assignment') },
  eliminated: { describe: says('was eliminated from the hunt') },
}

const DEFAULTS = {
  describe: (event) => event.type,
  tone: '',
  breach: false,
  quotesMessage: false,
  echoesPayload: false,
}

export function eventInfo(type) {
  const key = String(type ?? '')
  const known = Object.prototype.hasOwnProperty.call(EVENTS, key)
  return { ...DEFAULTS, kind: key.replaceAll('_', ' ').toUpperCase(), ...(known ? EVENTS[key] : {}) }
}

export function eventKind(event) {
  const { kind, breach } = eventInfo(event.type)
  return breach && event.status === 'pending' ? `${kind} // PENDING` : kind
}
