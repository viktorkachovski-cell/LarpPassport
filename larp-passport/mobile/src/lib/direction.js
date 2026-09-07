// Direction-to-target helpers (D01). Pure functions; the screen decides when
// to subscribe to the compass and when to redraw. The server is the only
// source of the bearing: nothing here derives direction from coordinates.

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

export function normalizeDegrees(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return ((n % 360) + 360) % 360
}

export function cardinalLabel(bearing) {
  const deg = normalizeDegrees(bearing)
  if (deg == null) return null
  return CARDINALS[Math.round(deg / 45) % 8]
}

export function formatBearing(bearing) {
  const deg = normalizeDegrees(bearing)
  if (deg == null) return null
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°`
}

// Signed shortest rotation from `from` to `to`, in (-180, 180]. Used only to
// animate the arrow across the 359°/0° seam; it never changes the bearing.
export function shortestAngleDelta(from, to) {
  const a = normalizeDegrees(from)
  const b = normalizeDegrees(to)
  if (a == null || b == null) return 0
  let delta = (b - a) % 360
  if (delta > 180) delta -= 360
  if (delta <= -180) delta += 360
  return delta
}

// expo-location heading object -> usable true heading or null. trueHeading is
// -1 without location permission; accuracy 0 means the compass reports no
// calibration at all. Magnetic heading is never substituted for true north.
export function usableTrueHeading(heading) {
  if (!heading) return null
  const value = Number(heading.trueHeading)
  if (!Number.isFinite(value) || value < 0) return null
  if (Number(heading.accuracy) === 0) return null
  return normalizeDegrees(value)
}

export function headingQuality(heading) {
  if (!heading) return 'none'
  if (usableTrueHeading(heading) == null) return 'none'
  return Number(heading.accuracy) <= 1 ? 'low' : 'ok'
}

// Screen rotation for a phone-relative arrow: bearing minus true heading.
export function arrowRotation(bearingDeg, trueHeading) {
  const bearing = normalizeDegrees(bearingDeg)
  const heading = normalizeDegrees(trueHeading)
  if (bearing == null || heading == null) return null
  return (bearing - heading + 360) % 360
}

// Interprets the server proximity block. Freshness is server-decided; the
// client only expires the cached signal at valid_until so a stale arrow is
// never shown between refreshes.
export function describeDirection(proximity, now = Date.now()) {
  if (!proximity || proximity.state !== 'available') return { state: 'none' }
  const directionState = proximity.direction_state
  if (!directionState || directionState === 'not_enabled') return { state: 'not_enabled' }
  const validUntil = proximity.valid_until ? new Date(proximity.valid_until).getTime() : null
  if (validUntil != null && Number.isFinite(validUntil) && now > validUntil) return { state: 'expired' }
  if (directionState !== 'available') return { state: 'unavailable' }
  const bearing = normalizeDegrees(proximity.bearing_deg)
  if (bearing == null) return { state: 'unavailable' }
  return {
    state: 'available',
    bearing: Math.round(bearing) % 360,
    cardinal: cardinalLabel(bearing),
    label: `${formatBearing(bearing)} ${cardinalLabel(bearing)}`,
    validUntil,
  }
}

// Whether the rounded-metre readout may be shown. The server omits precise
// metres (sends the band edge) whenever direction is enabled.
export function showsMetres(proximity) {
  return !!proximity && proximity.state === 'available' && !proximity.distance_is_band_edge
    && (!proximity.direction_state || proximity.direction_state === 'not_enabled')
}
