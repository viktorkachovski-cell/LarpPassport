import { COMPASS_PHASES } from '../pirate/phases'

export const REPORT_STATES = ['yielded', 'fighting']

export const mercyActive = (state, now) => !!state?.mercy_until && new Date(state.mercy_until).getTime() > now

// Parley is open in the compass phases to crewed players, unless paused or switched off by the GM.
function parleyOpen(state) {
  return !!state?.is_pirate && state.role === 'player' && !!state.crew?.id && !state.paused
    && !!state.pvp_enabled && COMPASS_PHASES.includes(state.phase)
}

export function parleyActions(state, now = Date.now()) {
  const active = state?.active_parley
  const open = parleyOpen(state)
  const acting = open && !!active?.can_act
  return {
    canStart: open && !active && !mercyActive(state, now),
    canChoose: acting && active.role === 'target' && active.state === 'joined',
    canReport: acting && !active.self_reported && REPORT_STATES.includes(active.state),
    canPlunder: acting && active.state === 'awaiting_choice' && active.winner_faction === state.crew.id,
  }
}
