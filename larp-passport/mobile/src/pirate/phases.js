// Player-facing names and "what's open" lines for The Black Tide phases.
// Plain JS (no react-native) so the brand file and Jest can import it.
// The server decides what is open; these lists mirror its phase checks.

export const CLAIM_PHASES = ['charting', 'cursed', 'hunt', 'hoard']
export const COMPASS_PHASES = ['cursed', 'hunt', 'hoard']

const NAMES = {
  setup: ['Muster', 'Muster'],
  charting: ['Charting', 'Act I: Charting'],
  cursed: ['Cursed', 'The Curse Wakes'],
  truce: ['Truce', 'Tavern Truce'],
  hunt: ['Hunt', 'Act II: The Hunt'],
  hoard: ['Hoard', 'The Hoard Surfaces'],
  recall: ['Recall', 'Recall'],
  finished: ['Over', 'Final Muster'],
}

// short: the header chip. long: the start of the phase line.
export function phaseName(phase) {
  const [short, long] = NAMES[phase] ?? ['Waiting', 'Waiting for the GM']
  return { short, long }
}

export function claimsOpen(state) {
  return !!state && !state.paused && CLAIM_PHASES.includes(state.phase)
}

export function compassOpen(state) {
  return !!state && !state.paused && COMPASS_PHASES.includes(state.phase)
}

// One line that answers "what can I do right now?".
export function phaseHint(state) {
  if (!state?.phase) return ''
  if (state.paused) return 'The tide has stopped. Everything is paused until the GM resumes play.'
  if (state.phase === 'setup') return 'Crews are gathering. Play starts at Charting.'
  if (state.phase === 'truce') return 'Everything is paused. Warm up, charge your phone, trade oath lines.'
  if (state.phase === 'recall') return 'Play is over. Head to the Final Muster.'
  if (state.phase === 'finished') return 'The game is over.'
  const open = []
  if (CLAIM_PHASES.includes(state.phase)) open.push('riddle sites')
  if (COMPASS_PHASES.includes(state.phase)) {
    open.push('lighthouses')
    if (state.pvp_enabled) open.push('Parley')
  }
  if (state.phase === 'hoard') open.push('the hoard')
  const closedParley = COMPASS_PHASES.includes(state.phase) && !state.pvp_enabled ? ' · Parley closed by the GM' : ''
  const noParleyYet = state.phase === 'charting' ? ' · No Parley yet' : ''
  return `Open: ${open.join(', ')}${noParleyYet}${closedParley}`
}

// Why a site claim is not possible right now, or '' when it is.
export function claimClosedReason(state) {
  if (!state || claimsOpen(state)) return ''
  if (state.paused) return 'Paused. Answers reopen when the GM resumes play.'
  if (state.phase === 'setup') return 'Riddle sites open at Charting.'
  if (state.phase === 'truce') return 'Riddle sites reopen after the Truce.'
  return 'Riddle sites are closed now.'
}

// Why a lighthouse reading is not possible right now, or '' when it is.
export function readingClosedReason(state) {
  if (!state || compassOpen(state)) return ''
  if (state.paused) return 'Paused. Readings reopen when the GM resumes play.'
  if (state.phase === 'setup' || state.phase === 'charting') return 'Lighthouses wake with the Curse.'
  if (state.phase === 'truce') return 'Lighthouses reopen after the Truce.'
  return 'Lighthouses are closed now.'
}
