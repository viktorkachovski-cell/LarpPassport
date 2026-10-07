// The two kinds of game the GM dashboard runs. A game with a phase is a
// Pirate game; every other game is an ordinary/Time Hunt game. GameView reads
// everything mode-specific from here instead of branching on the game.
//
// stateRpc: the GM state loaded with each snapshot. tabs: the section tabs,
// mode tab first. reloadsOn(type): a game_events type after which the mode
// state must be reloaded. decisions(state): mode decisions waiting for a GM,
// each { key, text } (shown with a link to the mode tab).

const SHARED_TABS = ['map', 'characters', 'template', 'events', 'players']
const plural = (count, word, suffix = 's') => `${count} ${word}${count === 1 ? '' : suffix}`

export const HUNT_MODE = {
  key: 'hunt',
  stateRpc: 'get_hunt_admin',
  // The Pirate tab stays available here: it is where a GM enables Pirate mode.
  tabs: ['hunt', 'pirate', ...SHARED_TABS],
  directionControl: true,
  statusFollowsPhase: false,
  reloadsOn: (type) => type === 'eliminated' || type === 'zone_boundary_exit'
    || type.startsWith('hunt_') || type.startsWith('elimination_'),
  decisions(hunt) {
    const claims = (hunt?.claims ?? []).filter((claim) => claim.status === 'pending').length
    const awaiting = hunt?.phase === 'active'
      ? (hunt.players ?? []).filter((player) => player.state === 'alive' && !player.target_profile_id).length
      : 0
    return [
      claims && { key: 'claims', text: `${plural(claims, 'elimination claim')} to rule on` },
      awaiting && { key: 'assign', text: `${plural(awaiting, 'player')} waiting for a target assignment` },
    ].filter(Boolean)
  },
}

export const PIRATE_MODE = {
  key: 'pirate',
  stateRpc: 'gm_pirate_overview',
  tabs: ['pirate', ...SHARED_TABS],
  directionControl: false,
  statusFollowsPhase: true,
  reloadsOn: (type) => type.startsWith('pirate_'),
  decisions(pirate) {
    const disputes = (pirate?.parleys ?? []).filter((parley) => parley.state === 'disputed').length
    return disputes ? [{ key: 'disputes', text: `${plural(disputes, 'Parley dispute')} to rule on` }] : []
  },
}

export const modeOf = (game) => (game.phase ? PIRATE_MODE : HUNT_MODE)

// Pending events the mode tab rules on rather than the Events tab.
export const ruledInModeTab = (event) => event.type === 'pirate_dispute'
