const R_LAT = 111320

export function haversine(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function circlePolygon(lng, lat, radiusM, steps = 64) {
  const coords = []
  const rLng = R_LAT * Math.cos((lat * Math.PI) / 180)
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI
    coords.push([lng + (radiusM * Math.sin(t)) / rLng, lat + (radiusM * Math.cos(t)) / R_LAT])
  }
  return { type: 'Polygon', coordinates: [coords] }
}

export function pointEwkt(lng, lat) {
  return `SRID=4326;POINT(${lng} ${lat})`
}

export function polygonEwkt(points) {
  const ring = [...points]
  const [f, l] = [ring[0], ring[ring.length - 1]]
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f)
  return `SRID=4326;POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(', ')}))`
}

// PostGIS EWKB hex for a point, as delivered in realtime payloads
export function parseWkbPoint(hex) {
  if (!hex || typeof hex !== 'string' || hex.length < 42) return null
  try {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
    const dv = new DataView(bytes.buffer)
    const le = bytes[0] === 1
    const type = dv.getUint32(1, le)
    let off = 5
    if (type & 0x20000000) off += 4
    if ((type & 0xff) !== 1) return null
    const lng = dv.getFloat64(off, le)
    const lat = dv.getFloat64(off + 8, le)
    return { lng, lat }
  } catch {
    return null
  }
}

export function centroidOf(geojson) {
  if (!geojson) return null
  if (geojson.type === 'Point') return { lng: geojson.coordinates[0], lat: geojson.coordinates[1] }
  if (geojson.type === 'Polygon') {
    const ring = geojson.coordinates[0]
    let x = 0, y = 0
    for (const [px, py] of ring) { x += px; y += py }
    return { lng: x / ring.length, lat: y / ring.length }
  }
  return null
}

export function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 10) return 'now'
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
