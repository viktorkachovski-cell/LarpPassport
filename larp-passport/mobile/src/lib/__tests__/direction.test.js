import {
  arrowRotation, cardinalLabel, describeDirection, formatBearing, headingQuality, normalizeDegrees,
  shortestAngleDelta, showsMetres, usableTrueHeading,
} from '../direction'

const T0 = Date.parse('2026-09-07T12:00:00Z')
const iso = (offsetSeconds) => new Date(T0 + offsetSeconds * 1000).toISOString()

describe('bearing formatting', () => {
  it('labels the cardinal and intercardinal sectors', () => {
    expect(cardinalLabel(0)).toBe('N')
    expect(cardinalLabel(45)).toBe('NE')
    expect(cardinalLabel(90)).toBe('E')
    expect(cardinalLabel(135)).toBe('SE')
    expect(cardinalLabel(180)).toBe('S')
    expect(cardinalLabel(225)).toBe('SW')
    expect(cardinalLabel(270)).toBe('W')
    expect(cardinalLabel(315)).toBe('NW')
    expect(cardinalLabel(359)).toBe('N')
    expect(cardinalLabel('x')).toBeNull()
  })

  it('formats three-digit degrees and wraps 360 to 0', () => {
    expect(formatBearing(7)).toBe('007°')
    expect(formatBearing(359.6)).toBe('000°')
    expect(normalizeDegrees(-90)).toBe(270)
    expect(normalizeDegrees(720)).toBe(0)
  })
})

describe('arrow geometry', () => {
  it('rotates across the 359/0 seam by the shortest path', () => {
    expect(shortestAngleDelta(359, 1)).toBe(2)
    expect(shortestAngleDelta(1, 359)).toBe(-2)
    expect(shortestAngleDelta(0, 180)).toBe(180)
    expect(shortestAngleDelta(90, 270)).toBe(180)
    expect(shortestAngleDelta(270, 90)).toBe(180)
    expect(shortestAngleDelta(10, 350)).toBe(-20)
  })

  it('computes the phone-relative rotation from a true heading only', () => {
    expect(arrowRotation(45, 0)).toBe(45)
    expect(arrowRotation(45, 90)).toBe(315)
    expect(arrowRotation(0, 350)).toBe(10)
    expect(arrowRotation(45, null)).toBeNull()
  })

  it('rejects headings without a true-north value or calibration', () => {
    expect(usableTrueHeading({ trueHeading: -1, magHeading: 12, accuracy: 3 })).toBeNull()
    expect(usableTrueHeading({ trueHeading: 30, magHeading: 25, accuracy: 0 })).toBeNull()
    expect(usableTrueHeading({ trueHeading: 30, magHeading: 25, accuracy: 2 })).toBe(30)
    expect(usableTrueHeading(null)).toBeNull()
    expect(headingQuality({ trueHeading: 30, accuracy: 1 })).toBe('low')
    expect(headingQuality({ trueHeading: 30, accuracy: 3 })).toBe('ok')
    expect(headingQuality({ trueHeading: -1, accuracy: 3 })).toBe('none')
  })
})

describe('describeDirection', () => {
  const available = { state: 'available', band: 'nearby', distance_m: 300, distance_is_band_edge: true, direction_state: 'available', bearing_deg: 47, valid_until: iso(90) }

  it('reads an available bearing with its validity horizon', () => {
    expect(describeDirection(available, T0)).toEqual({ state: 'available', bearing: 47, cardinal: 'NE', label: '047° NE', validUntil: T0 + 90000 })
  })

  it('expires the cached signal locally after valid_until', () => {
    expect(describeDirection(available, T0 + 91000)).toEqual({ state: 'expired' })
  })

  it('distinguishes not enabled, unavailable, stale and cloaked', () => {
    expect(describeDirection({ state: 'available', band: 'close', distance_m: 60, direction_state: 'not_enabled' }, T0)).toEqual({ state: 'not_enabled' })
    expect(describeDirection({ ...available, direction_state: 'unavailable', bearing_deg: null }, T0)).toEqual({ state: 'unavailable' })
    expect(describeDirection({ state: 'stale', last_seen_at: iso(-200) }, T0)).toEqual({ state: 'none' })
    expect(describeDirection({ state: 'cloaked', available_at: iso(600) }, T0)).toEqual({ state: 'none' })
    expect(describeDirection(undefined, T0)).toEqual({ state: 'none' })
  })

  it('treats a legacy response without direction fields as not enabled', () => {
    expect(describeDirection({ state: 'available', band: 'far', distance_m: 1500 }, T0)).toEqual({ state: 'not_enabled' })
  })
})

describe('showsMetres', () => {
  it('hides rounded metres whenever direction is enabled for the game', () => {
    expect(showsMetres({ state: 'available', band: 'close', distance_m: 60, direction_state: 'not_enabled' })).toBe(true)
    expect(showsMetres({ state: 'available', band: 'close', distance_m: 60 })).toBe(true)
    expect(showsMetres({ state: 'available', band: 'close', distance_m: 100, distance_is_band_edge: true, direction_state: 'available', bearing_deg: 10 })).toBe(false)
    expect(showsMetres({ state: 'available', band: 'immediate', distance_m: 25, distance_is_band_edge: true, direction_state: 'unavailable', bearing_deg: null })).toBe(false)
    expect(showsMetres({ state: 'stale' })).toBe(false)
  })
})
