// Pure helpers for polygon drawing (U06). Points are [longitude, latitude].

const samePoint = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1]

// Drops consecutive duplicate vertices (a double-click/tap lands twice) and a
// trailing vertex equal to the first, so the ring is closed exactly once by
// polygonEwkt and never by the drawing layer.
export function dedupeVertices(points) {
  const out = []
  for (const point of points ?? []) {
    if (!samePoint(out[out.length - 1], point)) out.push(point)
  }
  if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop()
  return out
}

export function distinctVertexCount(points) {
  return new Set((points ?? []).map(([lng, lat]) => `${lng},${lat}`)).size
}

export function canFinishPolygon(points) {
  return distinctVertexCount(points) >= 3
}
