// Old servers omit settings; keep the shipped rules as their fallback.
export function riddleRewardText(settings) {
  const payouts = settings?.riddle_payouts ?? [20, 15, 10, 5]
  return `${payouts.join(' / ')}, then ${payouts[payouts.length - 1]} for every later crew`
}

export function parleyTerms(state) {
  const rules = state?.active_parley?.rules ?? state?.settings ?? {}
  return `Yield: ${rules.yield_percent ?? 10}% of the target’s doubloons, minimum ${rules.yield_min ?? 3}. Fight: one shard or ${rules.fight_percent ?? 25}% of the loser’s doubloons, minimum ${rules.fight_min ?? 5}. Transfers cannot exceed the loser’s balance. Automatic Mercy: ${rules.mercy_seconds ?? 900} seconds; pair cooldown: ${rules.pair_cooldown_seconds ?? 1800} seconds.`
}
