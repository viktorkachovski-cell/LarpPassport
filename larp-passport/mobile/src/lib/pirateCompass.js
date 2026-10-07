import { formatBearing, normalizeDegrees, shortestAngleDelta } from './direction'

export function bearingRangeLabel(centre, halfWidth) {
  const c = normalizeDegrees(centre)
  if (c == null || !Number.isFinite(halfWidth) || halfWidth < 0 || halfWidth > 90) return null
  return `${formatBearing(c - halfWidth)}–${formatBearing(c + halfWidth)}`
}

// Bearing is clockwise from north; SVG's positive y axis points down.
export function arcPath(centre, halfWidth, radius, cx = radius, cy = radius) {
  const c = normalizeDegrees(centre)
  if (c == null || !Number.isFinite(halfWidth) || halfWidth <= 0 || halfWidth > 90
      || !Number.isFinite(radius) || radius <= 0) return null
  const point = (degrees) => {
    const angle = degrees * Math.PI / 180
    return [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)]
  }
  const start = point(c - halfWidth)
  const end = point(c + halfWidth)
  const number = (value) => Number(value.toFixed(3))
  return `M ${number(cx)} ${number(cy)} L ${number(start[0])} ${number(start[1])} A ${number(radius)} ${number(radius)} 0 0 1 ${number(end[0])} ${number(end[1])} Z`
}

// Keep a continuous heading across the north seam, then smooth only the dial.
export function smoothHeading(previous, next, alpha = 0.25) {
  const normalized = normalizeDegrees(next)
  if (normalized == null) return previous
  if (previous == null) return normalized
  const weight = Math.max(0, Math.min(1, alpha))
  return previous + shortestAngleDelta(previous, normalized) * weight
}
