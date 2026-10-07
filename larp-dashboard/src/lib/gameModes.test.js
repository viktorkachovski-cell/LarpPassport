import { describe, expect, it } from 'vitest'
import { HUNT_MODE, modeOf, PIRATE_MODE, ruledInModeTab } from './gameModes'

describe('game modes', () => {
  it('a game with a phase is a Pirate game', () => {
    expect(modeOf({ phase: 'setup' })).toBe(PIRATE_MODE)
    expect(modeOf({ phase: null })).toBe(HUNT_MODE)
  })

  it('each mode reloads only on its own event types, including types added later', () => {
    for (const type of ['hunt_started', 'hunt_paused', 'elimination_voided', 'eliminated', 'zone_boundary_exit']) {
      expect(HUNT_MODE.reloadsOn(type)).toBe(true)
    }
    expect(HUNT_MODE.reloadsOn('zone_enter')).toBe(false)
    expect(HUNT_MODE.reloadsOn('pirate_claim')).toBe(false)
    expect(PIRATE_MODE.reloadsOn('pirate_claim')).toBe(true)
    expect(PIRATE_MODE.reloadsOn('hunt_started')).toBe(false)
  })

  it('lists mode decisions waiting for a GM', () => {
    expect(HUNT_MODE.decisions({
      phase: 'active',
      claims: [{ status: 'pending' }, { status: 'confirmed' }],
      players: [{ state: 'alive', target_profile_id: null }, { state: 'alive', target_profile_id: 'x' }],
    }).map((item) => item.text)).toEqual(['1 elimination claim to rule on', '1 player waiting for a target assignment'])
    expect(PIRATE_MODE.decisions({ parleys: [{ state: 'disputed' }, { state: 'open' }] }).map((item) => item.text))
      .toEqual(['1 Parley dispute to rule on'])
    expect(PIRATE_MODE.decisions(null)).toEqual([])
  })

  it('Parley disputes are ruled on in the Pirate tab, not the events queue', () => {
    expect(ruledInModeTab({ type: 'pirate_dispute' })).toBe(true)
    expect(ruledInModeTab({ type: 'zone_enter' })).toBe(false)
  })

  it('Time Hunt games keep a Pirate tab for enabling Pirate mode', () => {
    expect(HUNT_MODE.tabs.slice(0, 2)).toEqual(['hunt', 'pirate'])
    expect(PIRATE_MODE.tabs).not.toContain('hunt')
  })
})
