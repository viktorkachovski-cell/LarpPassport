import { parleyActions } from '../pirateParley'

const base = { is_pirate: true, role: 'player', phase: 'cursed', paused: false,
  pvp_enabled: true, crew: { id: 'ours' }, active_parley: null }

test('both session players report independently after Yield and Fight', () => {
  for (const state of ['yielded', 'fighting']) {
    expect(parleyActions({ ...base, active_parley: { state, role: 'target', can_act: true,
      self_reported: false } }).canReport).toBe(true)
    expect(parleyActions({ ...base, active_parley: { state, role: 'attacker', can_act: true,
      self_reported: true } }).canReport).toBe(false)
  }
})

test('only the target chooses the encounter and only its winning participant chooses plunder', () => {
  expect(parleyActions({ ...base, active_parley: { state: 'joined', role: 'target', can_act: true } }).canChoose).toBe(true)
  expect(parleyActions({ ...base, active_parley: { state: 'joined', role: 'attacker', can_act: true } }).canChoose).toBe(false)
  expect(parleyActions({ ...base, active_parley: { state: 'awaiting_choice', can_act: true,
    winner_faction: 'ours' } }).canPlunder).toBe(true)
  expect(parleyActions({ ...base, active_parley: { state: 'awaiting_choice', can_act: false,
    winner_faction: 'ours' } }).canPlunder).toBe(false)
})

test('pause, truce, PvP kill switch and mercy block new Parleys', () => {
  for (const state of [
    { paused: true }, { phase: 'truce' }, { pvp_enabled: false },
    { mercy_until: '2026-10-07T16:15:00Z' },
  ]) expect(parleyActions({ ...base, ...state }, Date.parse('2026-10-07T16:00:00Z')).canStart).toBe(false)
})

test('players without a crew cannot open or join a Parley', () => {
  for (const crew of [null, {}, undefined]) expect(parleyActions({ ...base, crew }).canStart).toBe(false)
  expect(parleyActions(base).canStart).toBe(true)
})
