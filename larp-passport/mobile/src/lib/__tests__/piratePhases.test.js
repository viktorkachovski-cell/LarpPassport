import { claimClosedReason, phaseHint, phaseName, readingClosedReason } from '../../pirate/phases'
import { compassProgress } from '../pirateCompass'

test('phases have player names', () => {
  expect(phaseName('cursed')).toEqual({ short: 'Cursed', long: 'The Curse Wakes' })
  expect(phaseName('nonsense').short).toBe('Waiting')
})

test('the phase line lists what is open', () => {
  expect(phaseHint({ phase: 'charting', pvp_enabled: true })).toBe('Open: riddle sites · No Parley yet')
  expect(phaseHint({ phase: 'hunt', pvp_enabled: true })).toBe('Open: riddle sites, lighthouses, Parley')
  expect(phaseHint({ phase: 'hoard', pvp_enabled: false })).toBe('Open: riddle sites, lighthouses, the hoard · Parley closed by the GM')
  expect(phaseHint({ phase: 'hunt', paused: true })).toMatch(/paused/)
  expect(phaseHint(null)).toBe('')
})

test('closed actions say why', () => {
  expect(claimClosedReason({ phase: 'truce' })).toBe('Riddle sites reopen after the Truce.')
  expect(claimClosedReason({ phase: 'hunt' })).toBe('')
  expect(readingClosedReason({ phase: 'charting' })).toBe('Lighthouses wake with the Curse.')
  expect(readingClosedReason({ phase: 'cursed', paused: true })).toMatch(/Paused/)
})

test('compass progress follows the shard table', () => {
  expect(compassProgress(0)).toEqual({ shards: 0, now: null, next: 90 })
  expect(compassProgress(3)).toEqual({ shards: 3, now: 25, next: 12 })
  expect(compassProgress(7)).toEqual({ shards: 7, now: 5, next: null })
})
