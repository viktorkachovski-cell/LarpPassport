import { parleyTerms, riddleRewardText } from '../pirateRules'

test('riddle copy follows custom ranks and repeats the tail, including zero', () => {
  expect(riddleRewardText({ riddle_payouts: [50, 0] })).toBe('50 / 0, then 0 for every later crew')
  expect(riddleRewardText({ riddle_payouts: [7] })).toBe('7, then 7 for every later crew')
  expect(riddleRewardText()).toContain('20 / 15 / 10 / 5')
})
test('an active Parley shows its saved terms after settings change', () => {
  const state = { settings: { yield_percent: 80, mercy_seconds: 0 }, active_parley: { rules: { yield_percent: 20, mercy_seconds: 120 } } }
  expect(parleyTerms(state)).toContain('Yield: 20%')
  expect(parleyTerms(state)).toContain('Mercy: 120 seconds')
  expect(parleyTerms({ settings: state.settings })).toContain('Yield: 80%')
  expect(parleyTerms({ settings: state.settings })).toContain('Mercy: 0 seconds')
})
test('legacy servers retain the original Parley copy', () => {
  expect(parleyTerms({})).toContain('Yield: 10%')
  expect(parleyTerms({})).toContain('Fight: one shard or 25%')
})
