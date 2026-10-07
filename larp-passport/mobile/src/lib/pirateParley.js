export function parleyActions(state, now = Date.now()) {
  const active = state?.active_parley
  const allowed = state?.is_pirate && state.role === 'player' && !state.paused
    && state.pvp_enabled && ['cursed', 'hunt', 'hoard'].includes(state.phase)
  const mercy = state?.mercy_until && new Date(state.mercy_until).getTime() > now
  return {
    canOpen: !!allowed && !active && !mercy,
    canJoin: !!allowed && !active && !mercy,
    canChoose: !!allowed && !!active?.can_act && active.role === 'target' && active.state === 'joined',
    canReport: !!allowed && !!active?.can_act && !active.self_reported
      && ['yielded', 'fighting'].includes(active.state),
    canPlunder: !!allowed && !!active?.can_act && active.state === 'awaiting_choice'
      && active.winner_faction === state.crew?.id,
  }
}
