import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseWkbPoint } from '../lib/geo'
import MapPanel from './MapPanel'
import CharactersPanel from './CharactersPanel'
import TemplatePanel from './TemplatePanel'
import EventsPanel from './EventsPanel'
import PlayersPanel from './PlayersPanel'

export default function GameView({ gameId, session, onBack }) {
  const uid = session.user.id
  const [game, setGame] = useState(null)
  const [zones, setZones] = useState([])
  const [positions, setPositions] = useState({})
  const [characters, setCharacters] = useState([])
  const [members, setMembers] = useState([])
  const [factions, setFactions] = useState([])
  const [events, setEvents] = useState([])
  const [tab, setTab] = useState('map')
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState('')

  const refetchZones = useCallback(async () => {
    const { data } = await supabase.from('zones_view').select('*').eq('game_id', gameId)
    setZones(data ?? [])
  }, [gameId])

  const refetchMembers = useCallback(async () => {
    const { data } = await supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId)
    setMembers(data ?? [])
  }, [gameId])

  useEffect(() => {
    let alive = true
    async function load() {
      const [g, z, pos, chars, mem, fac, ev] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('zones_view').select('*').eq('game_id', gameId),
        supabase.from('player_positions_view').select('*').eq('game_id', gameId),
        supabase.from('characters').select('*').eq('game_id', gameId),
        supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId),
        supabase.from('factions').select('*').eq('game_id', gameId),
        supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(200),
      ])
      if (!alive) return
      if (g.error) { setLoadError(g.error.message); return }
      setGame(g.data)
      setZones(z.data ?? [])
      const posMap = {}
      for (const p of pos.data ?? []) posMap[p.profile_id] = p
      setPositions(posMap)
      setCharacters(chars.data ?? [])
      setMembers(mem.data ?? [])
      setFactions(fac.data ?? [])
      setEvents(ev.data ?? [])
    }
    load()

    const ch = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_positions', filter: `game_id=eq.${gameId}` }, (payload) => {
        const row = payload.new
        if (!row?.profile_id) return
        const pt = parseWkbPoint(row.geog)
        if (!pt) return
        setPositions((prev) => ({
          ...prev,
          [row.profile_id]: {
            ...(prev[row.profile_id] ?? {}),
            profile_id: row.profile_id,
            lat: pt.lat, lng: pt.lng,
            accuracy_m: row.accuracy_m,
            battery_pct: row.battery_pct,
            recorded_at: row.recorded_at,
            updated_at: row.updated_at,
          },
        }))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setEvents((prev) => (prev.some((e) => e.id === payload.new.id) ? prev : [payload.new, ...prev].slice(0, 300)))
        } else if (payload.eventType === 'UPDATE') {
          setEvents((prev) => prev.map((e) => (e.id === payload.new.id ? payload.new : e)))
        } else if (payload.eventType === 'DELETE') {
          setEvents((prev) => prev.filter((e) => e.id !== payload.old?.id))
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `game_id=eq.${gameId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          setCharacters((prev) => prev.filter((c) => c.id !== payload.old?.id))
        } else {
          setCharacters((prev) => {
            const i = prev.findIndex((c) => c.id === payload.new.id)
            if (i === -1) return [...prev, payload.new]
            const next = [...prev]; next[i] = payload.new; return next
          })
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones', filter: `game_id=eq.${gameId}` }, refetchZones)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, refetchMembers)
      .subscribe()

    return () => { alive = false; supabase.removeChannel(ch) }
  }, [gameId, refetchZones, refetchMembers])

  const usernameOf = useCallback((profileId) => {
    const m = members.find((x) => x.profile_id === profileId)
    return m?.profile?.username ?? positions[profileId]?.username ?? 'unknown'
  }, [members, positions])

  const zoneNameOf = useCallback((zoneId) => zones.find((z) => z.id === zoneId)?.name ?? 'a zone', [zones])

  const pendingEvents = useMemo(() => events.filter((e) => e.status === 'pending'), [events])

  async function updateGame(patch) {
    const { data, error } = await supabase.from('games').update(patch).eq('id', gameId).select().single()
    if (!error && data) setGame(data)
    return error
  }

  async function confirmEvent(ev) {
    const patch = { status: 'confirmed', player_visible: true, resolved_at: new Date().toISOString(), resolved_by: uid }
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)))
    await supabase.from('game_events').update(patch).eq('id', ev.id)
  }

  async function dismissEvent(ev) {
    const patch = { status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: uid }
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? { ...e, ...patch } : e)))
    await supabase.from('game_events').update(patch).eq('id', ev.id)
  }

  async function saveZone(draft) {
    if (draft.id) {
      const { error } = await supabase.from('zones').update({
        name: draft.name, trigger_mode: draft.trigger_mode, dwell_seconds: draft.dwell_seconds,
        exit_buffer_m: draft.exit_buffer_m, one_shot: draft.one_shot, active: draft.active,
        radius_m: draft.radius_m, payload: draft.payload,
      }).eq('id', draft.id)
      if (error) return error
    } else {
      const { error } = await supabase.from('zones').insert({
        game_id: gameId, name: draft.name, shape: draft.shape, geog: draft.geog,
        radius_m: draft.radius_m, trigger_mode: draft.trigger_mode, dwell_seconds: draft.dwell_seconds,
        exit_buffer_m: draft.exit_buffer_m, one_shot: draft.one_shot, active: draft.active, payload: draft.payload,
      })
      if (error) return error
    }
    await refetchZones()
    return null
  }

  async function deleteZone(id) {
    await supabase.from('zones').delete().eq('id', id)
    await refetchZones()
  }

  async function saveCharacter(id, patch) {
    const { error } = await supabase.from('characters').update(patch).eq('id', id)
    return error
  }

  async function addNpc(name) {
    const { error } = await supabase.from('characters').insert({ game_id: gameId, user_id: uid, name, is_npc: true })
    return error
  }

  async function deleteCharacter(id) {
    await supabase.from('characters').delete().eq('id', id)
  }

  async function addFaction(name, color) {
    const { data, error } = await supabase.from('factions').insert({ game_id: gameId, name, color }).select().single()
    if (!error && data) setFactions((prev) => [...prev, data])
    return error
  }

  async function broadcast(targetProfileIds, message) {
    const rows = targetProfileIds.map((pid) => ({
      game_id: gameId, profile_id: pid, type: 'gm_note', status: 'confirmed', player_visible: true,
      payload: { message },
    }))
    const { error } = await supabase.from('game_events').insert(rows)
    return error
  }

  async function setMemberRole(profileId, role) {
    await supabase.from('game_players').update({ role }).eq('game_id', gameId).eq('profile_id', profileId)
    await refetchMembers()
  }

  async function removeMember(profileId) {
    await supabase.from('game_players').delete().eq('game_id', gameId).eq('profile_id', profileId)
    await refetchMembers()
  }

  function copyCode() {
    navigator.clipboard?.writeText(game.join_code)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }

  if (loadError) return <div className="center-screen"><p className="error">{loadError}</p><button onClick={onBack}>Back</button></div>
  if (!game) return <div className="center-screen"><p className="hint">Loading game…</p></div>

  const isGm = members.some((m) => m.profile_id === uid && m.role === 'gm') || game.gm_id === uid

  return (
    <div className="game-shell">
      <div className="topbar">
        <button className="ghost" onClick={onBack}>←</button>
        <span className="title display">{game.name}</span>
        <button className="code-chip" onClick={copyCode} title="Copy join code">{copied ? 'COPIED' : game.join_code}</button>
        <span className="spacer" />
        <label style={{ margin: 0 }}>Status</label>
        <select value={game.status} onChange={(e) => updateGame({ status: e.target.value })}>
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="finished">finished</option>
        </select>
        <label style={{ margin: 0 }}>Positions visible to</label>
        <select value={game.location_visibility} onChange={(e) => updateGame({ location_visibility: e.target.value })}>
          <option value="gm_only">GMs only</option>
          <option value="faction">same faction</option>
          <option value="all">everyone</option>
        </select>
      </div>
      <div className="tabs">
        {['map', 'characters', 'template', 'events', 'players'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
            {t === 'events' && pendingEvents.length > 0 && <span className="badge">{pendingEvents.length}</span>}
          </button>
        ))}
      </div>
      <div className={`tab-body ${tab === 'map' ? 'no-scroll' : ''}`}>
        <div style={{ display: tab === 'map' ? 'block' : 'none', height: '100%' }}>
          <MapPanel
            zones={zones} positions={positions} members={members} characters={characters} factions={factions}
            pendingEvents={pendingEvents} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
            saveZone={saveZone} deleteZone={deleteZone} confirmEvent={confirmEvent} dismissEvent={dismissEvent}
          />
        </div>
        {tab === 'characters' && (
          <CharactersPanel game={game} characters={characters} members={members} factions={factions}
            usernameOf={usernameOf} saveCharacter={saveCharacter} addNpc={addNpc} deleteCharacter={deleteCharacter}
            addFaction={addFaction} />
        )}
        {tab === 'template' && <TemplatePanel game={game} hasCharacters={characters.length > 0} updateGame={updateGame} />}
        {tab === 'events' && (
          <EventsPanel events={events} members={members} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
            confirmEvent={confirmEvent} dismissEvent={dismissEvent} broadcast={broadcast} />
        )}
        {tab === 'players' && (
          <PlayersPanel members={members} positions={positions} uid={uid} game={game}
            setMemberRole={setMemberRole} removeMember={removeMember} updateGame={updateGame} />
        )}
      </div>
      {!isGm && <div style={{ padding: 8, textAlign: 'center' }} className="hint">You are not a GM of this game — the console is read-only for you.</div>}
    </div>
  )
}
