import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { circlePolygon, haversine, centroidOf } from '../lib/geo'
import { formatAge } from '../lib/time'
import { canFinishPolygon, dedupeVertices } from '../lib/draw'
import { eventInfo } from '../lib/events'
import { useAction } from '../lib/useAction'
import { useNow } from '../lib/useNow'
import Outcome from './Outcome'
import { editorFor, NEW_ZONE, ZoneEditor, zoneFromEditor } from './ZoneEditor'

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

// Pin colour, tag and tooltip of one player marker.
function styleMarker(el, position, { name, off, color, now }) {
  const batt = position.battery_pct != null ? Math.round(position.battery_pct) : null
  el.querySelector('.pin').style.background = off ? '#3a463c' : color
  el.querySelector('.tag').textContent = name + (off ? ' · off' : batt != null && batt <= 30 ? ` · ${batt}%` : '')
  const stale = !position.recorded_at || now - new Date(position.recorded_at).getTime() > 120000
  el.classList.toggle('stale', stale || off)
  el.title = `${name} · ${formatAge(position.recorded_at) ?? '—'} · ±${Math.round(position.accuracy_m ?? 0)}m` +
    (batt != null ? ` · battery ${batt}%` : '') + (off ? ' · sharing off' : '')
}

function drawHint(draw) {
  if (draw.type !== 'circle') return `${draw.points.length} point${draw.points.length === 1 ? '' : 's'} — tap or click the map to add corners`
  return draw.center ? `Radius ${Math.round(draw.radiusM)} m — tap or click the edge to set it` : 'Tap or click the map to set the center'
}

function DrawControls({ draw, onToggle, onFinish, onUndo, onCancel }) {
  const drawing = (type) => draw?.type === type
  return <>
    <div className="row mb">
      <button className={drawing('circle') ? 'primary' : ''} aria-pressed={drawing('circle')} onClick={() => onToggle('circle')}>+ Circle</button>
      <button className={drawing('polygon') ? 'primary' : ''} aria-pressed={drawing('polygon')} onClick={() => onToggle('polygon')}>+ Polygon</button>
    </div>
    {draw && <p className="hint" role="status">{drawHint(draw)}{' · Esc cancels'}</p>}
    {drawing('polygon') && (
      <div className="row mb draw-controls" role="group" aria-label="Polygon drawing controls">
        <button type="button" className="primary" disabled={!canFinishPolygon(draw.points)} onClick={() => onFinish(draw.points)}>Finish polygon</button>
        <button type="button" disabled={draw.points.length === 0} onClick={onUndo}>Undo last point</button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    )}
    {drawing('circle') && (
      <div className="row mb draw-controls" role="group" aria-label="Circle drawing controls">
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
    )}
  </>
}

export default function MapPanel({
  active = true,
  zones, positions, members, characters, factions, pendingEvents,
  usernameOf, zoneNameOf, saveZone, deleteZone, confirmEvent, dismissEvent,
  treasure = null, treasureFocus = 0,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [draw, setDraw] = useState(null) // {type:'circle',center,radiusM} | {type:'polygon',points,cursor}
  const [editing, setEditing] = useState(null) // zone editor form state
  // Errors show beside the open editor; a success shows under the zone list
  // once the editor has closed.
  const { busy: saving, outcome, clear, run } = useAction()
  const now = useNow(30000) // marker staleness and ages
  const playerMarkers = useRef(new Map())
  const zoneMarkers = useRef([])
  const treasureMarker = useRef(null)
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
        // Touch devices never send mousemove, so measure from the second tap
        // itself; on desktop this equals the hovered radius.
        else finalizeCircle(d.center, Math.max(5, haversine(d.center, { lng, lat })))
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
      if (d?.type === 'polygon' && canFinishPolygon(d.points)) {
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

    return () => {
      window.removeEventListener('keydown', onKey)
      playerMarkers.current.forEach((m) => m.remove())
      playerMarkers.current.clear()
      zoneMarkers.current.forEach((m) => m.remove())
      treasureMarker.current?.remove()
      treasureMarker.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Tab visibility changes do not trigger MapLibre's window resize handler.
  useEffect(() => {
    if (active && ready) mapRef.current?.resize()
  }, [active, ready])

  // The visible container also changes size when the side panel wraps below
  // the map on narrow screens; resize the existing map instead of recreating
  // it. One observer, removed on unmount.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => { if (ready) mapRef.current?.resize() })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ready])

  selectRef.current = (id) => {
    setSelectedId(id)
    const z = zones.find((x) => x.id === id)
    if (z) openEditor(z)
  }

  function startDraw(type) {
    clear()
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
    const ring = dedupeVertices(points)
    if (!canFinishPolygon(ring)) return
    cancelDraw()
    // Opens the editor only; saving still goes through submitEditor -> saveZone.
    setEditing({ ...NEW_ZONE, shape: 'polygon', points: ring, name: 'New polygon zone' })
  }

  function undoVertex() {
    setDraw((d) => (d?.type === 'polygon' && d.points.length > 0 ? { ...d, points: d.points.slice(0, -1) } : d))
  }

  function openEditor(z) {
    clear()
    setEditing(editorFor(z))
  }

  function submitEditor() {
    if (!editing || saving) return
    const zone = zoneFromEditor(editing)
    run(() => saveZone(zone), { success: `Zone "${zone.name}" ${editing.id ? 'saved' : 'created'}.`, onSuccess: closeEditor })
  }

  function removeZone() {
    if (!editing?.id || saving) return
    if (!window.confirm(`Delete zone "${editing.name}"?`)) return
    run(() => deleteZone(editing.id), { success: `Zone "${editing.name}" deleted.`, onSuccess: closeEditor })
  }

  function closeEditor() {
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
  // sharing_enabled implies live consent (game_players CHECK constraint).
  const sharingActive = (pid) => {
    const m = members.find((x) => x.profile_id === pid)
    return !m || m.role === 'gm' || m.sharing_enabled
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
      styleMarker(marker.getElement(), p, { name: usernameOf(pid), off: !sharingActive(pid), color: factionColorOf(pid), now })
    }
    for (const [pid, marker] of playerMarkers.current.entries()) {
      if (!seen.has(pid)) { marker.remove(); playerMarkers.current.delete(pid) }
    }
  }, [ready, positions, members, characters, factions, now])

  // ---- Pirate treasure point (GM only; never sent to players) ----
  useEffect(() => {
    if (!ready) return
    treasureMarker.current?.remove()
    treasureMarker.current = null
    if (treasure?.lat == null || treasure?.lng == null) return
    const el = document.createElement('div')
    el.className = 'treasure-marker'
    el.innerHTML = '<div class="cross" aria-hidden="true">X</div><div class="tag">Treasure · GM only</div>'
    treasureMarker.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([treasure.lng, treasure.lat]).addTo(mapRef.current)
  }, [ready, treasure?.lat, treasure?.lng])

  const flyToTreasure = () => {
    if (treasure?.lat == null) return
    mapRef.current?.flyTo({ center: [treasure.lng, treasure.lat], zoom: Math.max(mapRef.current.getZoom(), 16) })
  }

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
    if (treasure?.lng != null) coords.push([treasure.lng, treasure.lat])
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
  }, [ready, zones, positions, treasure])

  // Another tab asked to show the treasure (a new treasureFocus value). Runs
  // after the initial fit so the fit does not cancel the flight.
  useEffect(() => {
    if (ready && treasureFocus) flyToTreasure()
  }, [ready, treasureFocus])

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
          <DrawControls draw={draw} onToggle={(type) => (draw?.type === type ? cancelDraw() : startDraw(type))}
            onFinish={finalizePolygon} onUndo={undoVertex} onCancel={cancelDraw} />
          {zones.map((z) => (
            <button type="button" key={z.id} className={`zone-row ${z.id === selectedId ? 'selected' : ''}`} aria-pressed={z.id === selectedId} onClick={() => selectAndFly(z)}>
              <span className={`dot ${z.active ? '' : 'inactive'}`} aria-hidden="true" />
              <span>{z.name}{z.active ? '' : ' (inactive)'}</span>
              <span className="meta">{z.zone_type === 'play_area' ? 'time anomaly' : z.trigger_mode === 'gm_confirm' ? 'confirm' : z.trigger_mode}{z.shape === 'circle' ? ` · ${Math.round(z.radius_m)}m` : ''}</span>
            </button>
          ))}
          {zones.length === 0 && !draw && <p className="hint">No zones yet. Draw one to trigger events when players arrive.</p>}
          {treasure?.lat != null && (
            <button type="button" className="zone-row" onClick={flyToTreasure}>
              <span className="dot treasure" aria-hidden="true" />
              <span>Treasure point</span>
              <span className="meta">GM only · {treasure.lat.toFixed(5)}, {treasure.lng.toFixed(5)}</span>
            </button>
          )}
          {outcome?.tone === 'ok' && <Outcome outcome={outcome} onDismiss={clear} />}
        </div>

        {editing && <ZoneEditor editing={editing} setEditing={setEditing} saving={saving} outcome={outcome} clear={clear}
          onSave={submitEditor} onClose={closeEditor} onDelete={removeZone} />}

        <div className="side-section">
          <h3>Pending triggers ({pendingEvents.length})</h3>
          {pendingEvents.map((ev) => (
            <div key={ev.id} className="pending-card">
              <div className="who">{usernameOf(ev.profile_id)}</div>
              <div className="what">{eventInfo(ev.type).describe(ev, zoneNameOf)} · {formatAge(ev.created_at)}</div>
              <div className="actions">
                <button className="primary" aria-label={`Confirm event for ${usernameOf(ev.profile_id)}`} onClick={() => confirmEvent(ev)}>Confirm</button>
                <button className="ghost" aria-label={`Dismiss event for ${usernameOf(ev.profile_id)}`} onClick={() => dismissEvent(ev)}>Dismiss</button>
              </div>
            </div>
          ))}
          {pendingEvents.length === 0 && <p className="hint">Nothing waiting on you.</p>}
        </div>
      </div>
    </div>
  )
}
