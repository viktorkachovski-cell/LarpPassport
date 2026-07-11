import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circlePolygon, haversine, pointEwkt, polygonEwkt, centroidOf, timeAgo } from '../lib/geo'

const MAP_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.55, 'raster-brightness-max': 0.8 } }],
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] }
const NEW_ZONE = {
  name: '', zone_type: 'event', warning_distance_m: 50, trigger_mode: 'gm_confirm',
  dwell_seconds: 0, exit_buffer_m: 15, one_shot: false, active: true, message: '',
}

export default function MapPanel({
  zones, positions, members, characters, factions, pendingEvents,
  usernameOf, zoneNameOf, saveZone, deleteZone, confirmEvent, dismissEvent,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [draw, setDraw] = useState(null) // {type:'circle',center,radiusM} | {type:'polygon',points,cursor}
  const [editing, setEditing] = useState(null) // zone editor form state
  const [saveError, setSaveError] = useState('')
  const [tick, setTick] = useState(0)
  const playerMarkers = useRef(new Map())
  const zoneMarkers = useRef([])
  const drawRef = useRef(null)
  const selectRef = useRef(() => {})
  const didFit = useRef(false)
  drawRef.current = draw

  // ---- map init (once) ----
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [24.75, 42.15],
      zoom: 12,
      attributionControl: { compact: true },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')

    map.on('load', () => {
      map.addSource('zones', { type: 'geojson', data: EMPTY_FC })
      map.addSource('draw', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': '#c9a227', 'fill-opacity': ['case', ['get', 'active'], 0.14, 0.05] },
      })
      map.addLayer({
        id: 'zones-line', type: 'line', source: 'zones',
        paint: {
          'line-color': ['case', ['get', 'selected'], '#e8e4d8', '#c9a227'],
          'line-width': ['case', ['get', 'selected'], 2.5, 1.5],
          'line-opacity': ['case', ['get', 'active'], 0.9, 0.4],
        },
      })
      map.addLayer({
        id: 'draw-fill', type: 'fill', source: 'draw',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#e8e4d8', 'fill-opacity': 0.1 },
      })
      map.addLayer({
        id: 'draw-line', type: 'line', source: 'draw',
        paint: { 'line-color': '#e8e4d8', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      })
      setReady(true)
    })

    map.on('click', (e) => {
      const d = drawRef.current
      const { lng, lat } = e.lngLat
      if (!d) return
      if (d.type === 'circle') {
        if (!d.center) setDraw({ ...d, center: { lng, lat }, radiusM: 0 })
        else finalizeCircle(d.center, Math.max(5, d.radiusM))
      } else if (d.type === 'polygon') {
        setDraw({ ...d, points: [...d.points, [lng, lat]] })
      }
    })

    map.on('mousemove', (e) => {
      const d = drawRef.current
      if (!d) return
      const { lng, lat } = e.lngLat
      if (d.type === 'circle' && d.center) {
        setDraw({ ...d, radiusM: haversine(d.center, { lng, lat }) })
      } else if (d.type === 'polygon') {
        setDraw({ ...d, cursor: [lng, lat] })
      }
    })

    map.on('dblclick', (e) => {
      const d = drawRef.current
      if (d?.type === 'polygon' && d.points.length >= 3) {
        e.preventDefault()
        finalizePolygon(d.points)
      }
    })

    map.on('click', 'zones-fill', (e) => {
      if (drawRef.current) return
      const id = e.features?.[0]?.properties?.id
      if (id) selectRef.current(id)
    })
    map.on('mouseenter', 'zones-fill', () => { if (!drawRef.current) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'zones-fill', () => { map.getCanvas().style.cursor = '' })

    const onKey = (e) => { if (e.key === 'Escape') cancelDraw() }
    window.addEventListener('keydown', onKey)
    const interval = setInterval(() => setTick((t) => t + 1), 30000)

    return () => {
      window.removeEventListener('keydown', onKey)
      clearInterval(interval)
      playerMarkers.current.forEach((m) => m.remove())
      playerMarkers.current.clear()
      zoneMarkers.current.forEach((m) => m.remove())
      map.remove()
      mapRef.current = null
    }
  }, [])

  selectRef.current = (id) => {
    setSelectedId(id)
    const z = zones.find((x) => x.id === id)
    if (z) openEditor(z)
  }

  function startDraw(type) {
    setSaveError('')
    setEditing(null)
    setSelectedId(null)
    setDraw(type === 'circle' ? { type: 'circle', center: null, radiusM: 0 } : { type: 'polygon', points: [], cursor: null })
    mapRef.current?.doubleClickZoom.disable()
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = 'crosshair'
  }

  function cancelDraw() {
    setDraw(null)
    mapRef.current?.doubleClickZoom.enable()
    if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''
  }

  function finalizeCircle(center, radiusM) {
    cancelDraw()
    setEditing({ ...NEW_ZONE, shape: 'circle', center, radius_m: Math.round(radiusM), name: 'New circle zone' })
  }

  function finalizePolygon(points) {
    cancelDraw()
    setEditing({ ...NEW_ZONE, shape: 'polygon', points, name: 'New polygon zone' })
  }

  function openEditor(z) {
    setSaveError('')
    setEditing({
      id: z.id, shape: z.shape, name: z.name, trigger_mode: z.trigger_mode,
      dwell_seconds: z.dwell_seconds, exit_buffer_m: z.exit_buffer_m,
      one_shot: z.one_shot, active: z.active, radius_m: z.radius_m ?? undefined,
      message: z.payload?.message ?? '', zone_type: z.zone_type ?? 'event',
      warning_distance_m: z.warning_distance_m ?? 50,
    })
  }

  async function submitEditor() {
    if (!editing) return
    setSaveError('')
    const base = {
      id: editing.id,
      name: editing.name.trim() || 'Unnamed zone',
      zone_type: editing.zone_type,
      warning_distance_m: Math.max(5, Number(editing.warning_distance_m) || 50),
      trigger_mode: editing.zone_type === 'play_area' ? 'silent' : editing.trigger_mode,
      dwell_seconds: editing.zone_type === 'play_area' ? 0 : Number(editing.dwell_seconds) || 0,
      exit_buffer_m: Number(editing.exit_buffer_m) || 0,
      one_shot: editing.zone_type === 'play_area' ? false : !!editing.one_shot,
      active: !!editing.active,
      radius_m: editing.shape === 'circle' ? Math.max(1, Number(editing.radius_m) || 1) : null,
      payload: editing.message?.trim() ? { message: editing.message.trim() } : {},
      shape: editing.shape,
    }
    if (!editing.id) {
      base.geog = editing.shape === 'circle'
        ? pointEwkt(editing.center.lng, editing.center.lat)
        : polygonEwkt(editing.points)
    }
    const err = await saveZone(base)
    if (err) { setSaveError(err.message); return }
    setEditing(null)
    setSelectedId(null)
  }

  async function removeZone() {
    if (!editing?.id) return
    if (!window.confirm(`Delete zone "${editing.name}"?`)) return
    const err = await deleteZone(editing.id)
    if (err) { setSaveError(err.message); return }
    setEditing(null)
    setSelectedId(null)
  }

  // ---- zones layer + labels ----
  const zonesFC = useMemo(() => ({
    type: 'FeatureCollection',
    features: zones
      .filter((z) => z.geojson)
      .map((z) => ({
        type: 'Feature',
        properties: { id: z.id, active: !!z.active, selected: z.id === selectedId },
        geometry: z.shape === 'circle'
          ? circlePolygon(z.geojson.coordinates[0], z.geojson.coordinates[1], z.radius_m ?? 10)
          : z.geojson,
      })),
  }), [zones, selectedId])

  useEffect(() => {
    if (!ready) return
    mapRef.current?.getSource('zones')?.setData(zonesFC)
    zoneMarkers.current.forEach((m) => m.remove())
    zoneMarkers.current = zones
      .filter((z) => z.geojson)
      .map((z) => {
        const c = centroidOf(z.geojson)
        const el = document.createElement('div')
        el.className = 'zone-tag'
        el.textContent = z.name
        return new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([c.lng, c.lat]).addTo(mapRef.current)
      })
  }, [ready, zonesFC, zones])

  // ---- draw preview ----
  useEffect(() => {
    if (!ready) return
    let fc = EMPTY_FC
    if (draw?.type === 'circle' && draw.center && draw.radiusM > 0) {
      fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: circlePolygon(draw.center.lng, draw.center.lat, draw.radiusM) }] }
    } else if (draw?.type === 'polygon' && draw.points.length > 0) {
      const pts = draw.cursor ? [...draw.points, draw.cursor] : draw.points
      const feats = [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }]
      if (pts.length >= 3) feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } })
      fc = { type: 'FeatureCollection', features: feats }
    }
    mapRef.current?.getSource('draw')?.setData(fc)
  }, [ready, draw])

  // ---- player markers ----
  const sharingActive = (pid) => {
    const m = members.find((x) => x.profile_id === pid)
    if (!m) return true
    if (m.role === 'gm') return true
    return !!(m.sharing_enabled && m.location_consent_at &&
      (!m.consent_revoked_at || new Date(m.consent_revoked_at) < new Date(m.location_consent_at)))
  }

  const factionColorOf = (profileId) => {
    const ch = characters.find((c) => c.user_id === profileId && !c.is_npc)
    const f = ch && factions.find((x) => x.id === ch.faction_id)
    return f?.color ?? '#9ba895'
  }

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    const seen = new Set()
    for (const [pid, p] of Object.entries(positions)) {
      if (p.lat == null || p.lng == null) continue
      seen.add(pid)
      let marker = playerMarkers.current.get(pid)
      if (!marker) {
        const el = document.createElement('div')
        el.className = 'player-marker'
        el.innerHTML = '<div class="pin"></div><div class="tag"></div>'
        marker = new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map)
        playerMarkers.current.set(pid, marker)
      }
      marker.setLngLat([p.lng, p.lat])
      const el = marker.getElement()
      const off = !sharingActive(pid)
      const batt = p.battery_pct != null ? Math.round(p.battery_pct) : null
      el.querySelector('.pin').style.background = off ? '#3a463c' : factionColorOf(pid)
      el.querySelector('.tag').textContent =
        usernameOf(pid) + (off ? ' · off' : batt != null && batt <= 30 ? ` · ${batt}%` : '')
      const stale = p.updated_at && Date.now() - new Date(p.updated_at).getTime() > 120000
      el.classList.toggle('stale', !!stale || off)
      el.title = `${usernameOf(pid)} · ${timeAgo(p.updated_at)} · ±${Math.round(p.accuracy_m ?? 0)}m` +
        (batt != null ? ` · battery ${batt}%` : '') + (off ? ' · sharing off' : '')
    }
    for (const [pid, marker] of playerMarkers.current.entries()) {
      if (!seen.has(pid)) { marker.remove(); playerMarkers.current.delete(pid) }
    }
  }, [ready, positions, members, characters, factions, tick])

  // ---- initial fit ----
  useEffect(() => {
    if (!ready || didFit.current) return
    const coords = []
    for (const z of zones) {
      if (!z.geojson) continue
      if (z.geojson.type === 'Point') coords.push(z.geojson.coordinates)
      else if (z.geojson.type === 'Polygon') coords.push(...z.geojson.coordinates[0])
    }
    for (const p of Object.values(positions)) if (p.lng != null) coords.push([p.lng, p.lat])
    if (coords.length > 0) {
      const b = coords.reduce((acc, c) => acc.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
      mapRef.current.fitBounds(b, { padding: 80, maxZoom: 16, duration: 0 })
      didFit.current = true
    } else if (navigator.geolocation) {
      didFit.current = true
      navigator.geolocation.getCurrentPosition(
        (pos) => mapRef.current?.setCenter([pos.coords.longitude, pos.coords.latitude]),
        () => {}, { timeout: 4000 }
      )
    }
  }, [ready, zones, positions])

  const selectAndFly = (z) => {
    setSelectedId(z.id)
    openEditor(z)
    const c = centroidOf(z.geojson)
    if (c) mapRef.current?.flyTo({ center: [c.lng, c.lat], zoom: Math.max(mapRef.current.getZoom(), 15) })
  }

  return (
    <div className="map-layout">
      <div className="map-container" ref={containerRef} />
      <div className="map-side">
        <div className="side-section">
          <h3>Zones</h3>
          <div className="row mb">
            <button className={draw?.type === 'circle' ? 'primary' : ''} onClick={() => (draw?.type === 'circle' ? cancelDraw() : startDraw('circle'))}>+ Circle</button>
            <button className={draw?.type === 'polygon' ? 'primary' : ''} onClick={() => (draw?.type === 'polygon' ? cancelDraw() : startDraw('polygon'))}>+ Polygon</button>
          </div>
          {draw && (
            <p className="hint">
              {draw.type === 'circle'
                ? draw.center ? `Radius ${Math.round(draw.radiusM)} m — click to set` : 'Click the map to set the center'
                : `${draw.points.length} points — double-click to finish`}
              {' · Esc cancels'}
            </p>
          )}
          {zones.map((z) => (
            <div key={z.id} className={`zone-row ${z.id === selectedId ? 'selected' : ''}`} onClick={() => selectAndFly(z)}>
              <span className={`dot ${z.active ? '' : 'inactive'}`} />
              <span>{z.name}</span>
              <span className="meta">{z.zone_type === 'play_area' ? 'time anomaly' : z.trigger_mode === 'gm_confirm' ? 'confirm' : z.trigger_mode}{z.shape === 'circle' ? ` · ${Math.round(z.radius_m)}m` : ''}</span>
            </div>
          ))}
          {zones.length === 0 && !draw && <p className="hint">No zones yet. Draw one to trigger events when players arrive.</p>}
        </div>

        {editing && (
          <div className="side-section">
            <h3>{editing.id ? 'Edit zone' : 'New zone'}</h3>
            <div className="field"><label>Name</label>
              <input style={{ width: '100%' }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
            <div className="field"><label>Purpose</label>
              <select style={{ width: '100%' }} value={editing.zone_type} onChange={(e) => setEditing({ ...editing, zone_type: e.target.value })}>
                <option value="event">Event trigger zone</option>
                <option value="play_area">Time anomaly play area</option>
              </select></div>
            {editing.zone_type === 'event' && (
              <div className="field"><label>When a player enters</label>
                <select style={{ width: '100%' }} value={editing.trigger_mode} onChange={(e) => setEditing({ ...editing, trigger_mode: e.target.value })}>
                  <option value="auto">Notify the player automatically</option>
                  <option value="gm_confirm">Ask a GM to confirm first</option>
                  <option value="silent">Log silently for GMs</option>
                </select></div>
            )}
            <div className="row">
              {editing.zone_type === 'event' && (
                <div className="field" style={{ flex: 1 }}><label>Dwell (s)</label>
                  <input type="number" min="0" style={{ width: '100%' }} value={editing.dwell_seconds} onChange={(e) => setEditing({ ...editing, dwell_seconds: e.target.value })} /></div>
              )}
              {editing.zone_type === 'play_area' && (
                <div className="field" style={{ flex: 1 }}><label>Edge warning (m)</label>
                  <input type="number" min="5" max="5000" style={{ width: '100%' }} value={editing.warning_distance_m} onChange={(e) => setEditing({ ...editing, warning_distance_m: e.target.value })} /></div>
              )}
              <div className="field" style={{ flex: 1 }}><label>Exit buffer (m)</label>
                <input type="number" min="0" style={{ width: '100%' }} value={editing.exit_buffer_m} onChange={(e) => setEditing({ ...editing, exit_buffer_m: e.target.value })} /></div>
              {editing.shape === 'circle' && (
                <div className="field" style={{ flex: 1 }}><label>Radius (m)</label>
                  <input type="number" min="1" style={{ width: '100%' }} value={editing.radius_m} onChange={(e) => setEditing({ ...editing, radius_m: e.target.value })} /></div>
              )}
            </div>
            <div className="row mb">
              {editing.zone_type === 'event' && <label style={{ margin: 0 }}><input type="checkbox" checked={editing.one_shot} onChange={(e) => setEditing({ ...editing, one_shot: e.target.checked })} /> One-shot per player</label>}
              <label style={{ margin: 0 }}><input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
            </div>
            {editing.zone_type === 'event' && <div className="field"><label>Message to the player (payload)</label>
              <textarea rows="2" style={{ width: '100%' }} value={editing.message} onChange={(e) => setEditing({ ...editing, message: e.target.value })} /></div>}
            <div className="row">
              <button className="primary" onClick={submitEditor}>{editing.id ? 'Save zone' : 'Create zone'}</button>
              <button className="ghost" onClick={() => { setEditing(null); setSelectedId(null) }}>Close</button>
              {editing.id && <button className="danger" onClick={removeZone}>Delete</button>}
            </div>
            {saveError && <p className="error">{saveError}</p>}
          </div>
        )}

        <div className="side-section">
          <h3>Pending triggers ({pendingEvents.length})</h3>
          {pendingEvents.map((ev) => (
            <div key={ev.id} className="pending-card">
              <div className="who">{usernameOf(ev.profile_id)}</div>
              <div className="what">{ev.type === 'zone_boundary_exit' ? 'left' : 'entered'} {zoneNameOf(ev.zone_id)} · {timeAgo(ev.created_at)}</div>
              <div className="actions">
                <button className="primary" onClick={() => confirmEvent(ev)}>Confirm</button>
                <button className="ghost" onClick={() => dismissEvent(ev)}>Dismiss</button>
              </div>
            </div>
          ))}
          {pendingEvents.length === 0 && <p className="hint">Nothing waiting on you.</p>}
        </div>
      </div>
    </div>
  )
}
