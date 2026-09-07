import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '@sentry/react'
import { GAME_COLUMNS, supabase } from '../lib/supabase'
import { parseWkbPoint } from '../lib/geo'
import CharactersPanel from './CharactersPanel'
import TemplatePanel from './TemplatePanel'
import EventsPanel from './EventsPanel'
import PlayersPanel from './PlayersPanel'
import HuntPanel from './HuntPanel'

const MapPanel = lazy(() => import('./MapPanel'))

export default function GameView({ gameId, session, onBack }) {
  const uid = session.user.id
  const [game, setGame] = useState(null)
  const [zones, setZones] = useState([])
  const [positions, setPositions] = useState({})
  const [characters, setCharacters] = useState([])
  const [members, setMembers] = useState([])
  const [factions, setFactions] = useState([])
  const [events, setEvents] = useState([])
  const [pendingEvents, setPendingEvents] = useState([])
  const [olderEvents, setOlderEvents] = useState([])
  const [hasMore, setHasMore] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const refreshRef = useRef(() => {})
  const refreshTimer = useRef(null)
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refreshRef.current(), 250)
  }, [])
  const [hunt, setHunt] = useState(null)
  const [tab, setTab] = useState('hunt')
  const [mapOpened, setMapOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')

  const isGm = !!game && (
    game.gm_id === uid || members.some((m) => m.profile_id === uid && m.role === 'gm')
  )

  const reportAction = useCallback((error) => {
    setActionError(error?.message ?? '')
    return error ?? null
  }, [])

  function requireGm() {
    if (isGm) return null
    return reportAction(new Error('Only a GM can change this game.'))
  }

  const refetchZones = useCallback(async () => {
    const { data, error } = await supabase.from('zones_view').select('*').eq('game_id', gameId)
    if (error) return reportAction(error)
    setZones(data ?? [])
    return null
  }, [gameId, reportAction])

  const refetchMembers = useCallback(async () => {
    const { data, error } = await supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId)
    if (error) return reportAction(error)
    setMembers(data ?? [])
    return null
  }, [gameId, reportAction])

  const refetchHunt = useCallback(() => refreshRef.current(), [])

  useEffect(() => {
    let alive = true
    let version = 0
    async function loadPending() {
      const rows = []
      let before
      while (alive) {
        let query = supabase.from('game_events').select('*').eq('game_id', gameId).eq('status', 'pending').order('seq', { ascending: false }).limit(500)
        if (before != null) query = query.lt('seq', before)
        const result = await query
        if (result.error) return result
        rows.push(...(result.data ?? []))
        if ((result.data?.length ?? 0) < 500) break
        before = result.data.at(-1).seq
      }
      return { data: rows, error: null }
    }
    async function load() {
      const request = ++version
      try {
      const [g, mem] = await Promise.all([
        supabase.from('games').select(GAME_COLUMNS).eq('id', gameId).single(),
        supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId),
      ])
      if (!alive || request !== version) return
      const accessFailure = [g, mem].find((result) => result.error)
      if (accessFailure) { setLoadError(accessFailure.error.message); return }

      setGame(g.data)
      setMembers(mem.data ?? [])
      const canManage = g.data.gm_id === uid
        || (mem.data ?? []).some((member) => member.profile_id === uid && member.role === 'gm')
      if (!canManage) return

      const [z, pos, chars, fac, ev, huntState, joinCode, pending] = await Promise.all([
        supabase.from('zones_view').select('*').eq('game_id', gameId),
        supabase.from('player_positions_view').select('*').eq('game_id', gameId),
        supabase.from('characters').select('*').eq('game_id', gameId),
        supabase.from('factions').select('*').eq('game_id', gameId),
        supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(200),
        supabase.rpc('get_hunt_admin', { g: gameId }),
        supabase.rpc('gm_get_join_code', { g: gameId }),
        loadPending(),
      ])
      if (!alive || request !== version) return
      const failed = [z, pos, chars, fac, ev, huntState, pending, joinCode].find((result) => result.error)
      if (failed) { setLoadError(failed.error.message); return }
      if (typeof joinCode.data === 'string') {
        setGame((current) => ({ ...(current ?? g.data), join_code: joinCode.data }))
      }
      setZones(z.data ?? [])
      const posMap = {}
      for (const p of pos.data ?? []) posMap[p.profile_id] = p
      setPositions(posMap)
      setCharacters(chars.data ?? [])
      setFactions(fac.data ?? [])
      setEvents(ev.data ?? [])
      setPendingEvents(pending.data ?? [])
      setLoadError('')
      setHunt(huntState.data)
      } catch (error) { if (alive && request === version) setLoadError(error.message) }
    }
    refreshRef.current = load
    const focus = () => { if (document.visibilityState !== 'hidden') load() }
    window.addEventListener('online', focus)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const timer = setInterval(focus, 60000)
    load()

    return () => {
      alive = false; ++version; clearInterval(timer); clearTimeout(refreshTimer.current)
      refreshRef.current = () => {}
      window.removeEventListener('online', focus); window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [gameId, uid, refetchZones, refetchMembers])

  useEffect(() => {
    if (!isGm) return undefined

    const channel = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_positions', filter: `game_id=eq.${gameId}` }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const gone = payload.old?.profile_id
          if (gone) {
            setPositions((prev) => {
              const next = { ...prev }
              delete next[gone]
              return next
            })
          }
          return
        }
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
        setPendingEvents((prev) => {
          const rest = prev.filter((e) => e.id !== (payload.new?.id ?? payload.old?.id))
          return payload.new?.status === 'pending' ? [payload.new, ...rest] : rest
        })
        if (payload.eventType === 'INSERT') {
          setEvents((prev) => (prev.some((e) => e.id === payload.new.id) ? prev : [payload.new, ...prev].slice(0, 300)))
        } else if (payload.eventType === 'UPDATE') {
          setEvents((prev) => prev.map((e) => (e.id === payload.new.id ? payload.new : e)))
        } else if (payload.eventType === 'DELETE') {
          setEvents((prev) => prev.filter((e) => e.id !== payload.old?.id))
        }
        if (payload.new?.type?.startsWith('hunt_')
            || payload.new?.type?.startsWith('elimination_')
            || payload.new?.type === 'eliminated'
            || payload.new?.type === 'zone_boundary_exit') scheduleRefresh()
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
      .subscribe((status) => { if (status === 'SUBSCRIBED') scheduleRefresh() })

    return () => { supabase.removeChannel(channel) }
  }, [gameId, isGm, refetchZones, refetchMembers, refetchHunt, scheduleRefresh])

  const usernameOf = useCallback((profileId) => {
    const m = members.find((x) => x.profile_id === profileId)
    return m?.profile?.username ?? positions[profileId]?.username ?? 'unknown'
  }, [members, positions])

  const zoneNameOf = useCallback((zoneId) => zones.find((z) => z.id === zoneId)?.name ?? 'a zone', [zones])

  const history = useMemo(() => [...new Map([...olderEvents, ...events].map((e) => [e.id, e])).values()].sort((a, b) => b.seq - a.seq), [events, olderEvents])
  async function loadOlder() {
    if (historyBusy || !history.length) return
    setHistoryBusy(true)
    try {
      const { data, error } = await supabase.from('game_events').select('*').eq('game_id', gameId)
        .lt('seq', history.at(-1).seq).order('seq', { ascending: false }).limit(200)
      if (error) throw error
      setOlderEvents((prev) => [...prev, ...(data ?? [])])
      setHasMore(data?.length === 200)
    } catch (error) { reportAction(error) } finally { setHistoryBusy(false) }
  }

  async function updateGame(patch) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.from('games').update(patch).eq('id', gameId).select(GAME_COLUMNS).single()
    if (error) return reportAction(error)
    setGame((current) => ({ ...data, join_code: current?.join_code }))
    return reportAction(null)
  }

  async function confirmEvent(ev) {
    const denied = requireGm()
    if (denied) return denied
    const patch = { status: 'confirmed', player_visible: true, resolved_at: new Date().toISOString(), resolved_by: uid }
    const { data, error } = await supabase.from('game_events').update(patch).eq('id', ev.id).select().single()
    if (error) return reportAction(error)
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? data : e)))
    setOlderEvents((prev) => prev.map((e) => e.id === ev.id ? data : e))
    setPendingEvents((prev) => prev.filter((e) => e.id !== ev.id))
    return reportAction(null)
  }

  async function dismissEvent(ev) {
    const denied = requireGm()
    if (denied) return denied
    const patch = { status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: uid }
    const { data, error } = await supabase.from('game_events').update(patch).eq('id', ev.id).select().single()
    if (error) return reportAction(error)
    setEvents((prev) => prev.map((e) => (e.id === ev.id ? data : e)))
    setOlderEvents((prev) => prev.map((e) => e.id === ev.id ? data : e))
    setPendingEvents((prev) => prev.filter((e) => e.id !== ev.id))
    return reportAction(null)
  }

  async function saveZone(draft) {
    const denied = requireGm()
    if (denied) return denied
    if (draft.id) {
      const { error } = await supabase.from('zones').update({
        name: draft.name, trigger_mode: draft.trigger_mode, dwell_seconds: draft.dwell_seconds,
        exit_buffer_m: draft.exit_buffer_m, one_shot: draft.one_shot, active: draft.active,
        radius_m: draft.radius_m, payload: draft.payload, zone_type: draft.zone_type,
        warning_distance_m: draft.warning_distance_m,
      }).eq('id', draft.id)
      if (error) return reportAction(error)
    } else {
      const { error } = await supabase.from('zones').insert({
        game_id: gameId, name: draft.name, shape: draft.shape, geog: draft.geog,
        radius_m: draft.radius_m, trigger_mode: draft.trigger_mode, dwell_seconds: draft.dwell_seconds,
        exit_buffer_m: draft.exit_buffer_m, one_shot: draft.one_shot, active: draft.active, payload: draft.payload,
        zone_type: draft.zone_type, warning_distance_m: draft.warning_distance_m,
      })
      if (error) return reportAction(error)
    }
    const error = await refetchZones()
    return reportAction(error)
  }

  async function deleteZone(id) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('zones').delete().eq('id', id)
    if (error) return reportAction(error)
    const refreshError = await refetchZones()
    return reportAction(refreshError)
  }

  async function saveCharacter(id, patch) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('characters').update(patch).eq('id', id)
    return reportAction(error)
  }

  async function addNpc(name) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('characters').insert({ game_id: gameId, user_id: uid, name, is_npc: true })
    return reportAction(error)
  }

  async function deleteCharacter(id) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('characters').delete().eq('id', id)
    return reportAction(error)
  }

  async function addFaction(name, color) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.from('factions').insert({ game_id: gameId, name, color }).select().single()
    if (error) return reportAction(error)
    setFactions((prev) => [...prev, data])
    return reportAction(null)
  }

  async function broadcast(targetProfileIds, message) {
    const denied = requireGm()
    if (denied) return denied
    const rows = targetProfileIds.map((pid) => ({
      game_id: gameId, profile_id: pid, type: 'gm_note', status: 'confirmed', player_visible: true,
      payload: { message },
    }))
    const { error } = await supabase.from('game_events').insert(rows)
    return reportAction(error)
  }

  async function setMemberRole(profileId, role) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('game_players').update({ role }).eq('game_id', gameId).eq('profile_id', profileId)
    if (error) return reportAction(error)
    const refreshError = await refetchMembers()
    return reportAction(refreshError)
  }

  async function removeMember(profileId) {
    const denied = requireGm()
    if (denied) return denied
    const { error } = await supabase.from('game_players').delete().eq('game_id', gameId).eq('profile_id', profileId)
    if (error) return reportAction(error)
    const refreshError = await refetchMembers()
    return reportAction(refreshError)
  }

  async function startHunt() {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('start_hunt', { g: gameId })
    if (error) return reportAction(error)
    setHunt(data)
    setGame((current) => ({ ...current, status: 'active', location_visibility: 'gm_only' }))
    return reportAction(null)
  }

  async function resetHunt() {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('reset_hunt', { g: gameId })
    if (error) return reportAction(error)
    setHunt(data)
    setGame((current) => ({ ...current, status: 'draft' }))
    return reportAction(null)
  }

  async function resolveHuntClaim(claimId, confirmed) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('gm_resolve_elimination', {
      claim_id: claimId,
      confirm_elimination: confirmed,
    })
    if (error) return reportAction(error)
    setHunt(data)
    if (data.phase === 'finished') setGame((current) => ({ ...current, status: 'finished' }))
    return reportAction(null)
  }

  async function eliminateHuntPlayer(profileId) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('gm_eliminate_player', {
      g: gameId,
      victim_id: profileId,
    })
    if (error) return reportAction(error)
    setHunt(data)
    if (data.phase === 'finished') setGame((current) => ({ ...current, status: 'finished' }))
    return reportAction(null)
  }

  async function restoreHuntPlayer(profileId) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('gm_restore_player', {
      g: gameId,
      profile_id: profileId,
    })
    if (error) return reportAction(error)
    setHunt(data)
    setGame((current) => ({ ...current, status: 'active', location_visibility: 'gm_only' }))
    return reportAction(null)
  }

  async function saveHuntChain(profileIds) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('gm_set_hunt_chain', {
      g: gameId,
      player_ids: profileIds,
    })
    if (error) return reportAction(error)
    setHunt(data)
    return reportAction(null)
  }

  async function assignNextTarget(profileId) {
    const denied = requireGm()
    if (denied) return denied
    const { data, error } = await supabase.rpc('gm_assign_next_target', {
      g: gameId,
      hunter_id: profileId,
    })
    if (error) return reportAction(error)
    setHunt(data)
    return reportAction(null)
  }

  function copyCode() {
    if (!game.join_code) return
    navigator.clipboard?.writeText(game.join_code)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }

  if (loadError) return <div className="center-screen"><p className="error">{loadError}</p><button onClick={() => refreshRef.current()}>Retry</button><button onClick={onBack}>Back</button></div>
  if (!game) return <div className="center-screen"><p className="hint">Loading game…</p></div>

  if (!isGm) return (
    <div className="center-screen">
      <div className="card access-card">
        <h2 className="display">GM access required</h2>
        <p className="hint">This dashboard controls the live game. Players should use the LARP Passport mobile app.</p>
        <button onClick={onBack}>Back to games</button>
      </div>
    </div>
  )

  return (
    <div className="game-shell">
      <div className="topbar">
        <button className="ghost back-control" onClick={onBack} aria-label="Back to games">←</button>
        <span className="title display">{game.name}</span>
        <button className="code-chip" onClick={copyCode} title="Copy join code">{copied ? 'COPIED' : game.join_code ?? '········'}</button>
        <span className="spacer" />
        <div className="topbar-control">
          <span className="control-label">STATUS</span>
          <select className={`status-select status-${game.status}`} aria-label="Game status" value={game.status} onChange={(e) => updateGame({ status: e.target.value })}>
            <option value="draft">DRAFT</option>
            <option value="active">ACTIVE</option>
            <option value="finished">FINISHED</option>
          </select>
        </div>
        <div className="topbar-control">
          <span className="control-label">POSITIONS</span>
          <select aria-label="Position visibility" value={game.location_visibility} onChange={(e) => updateGame({ location_visibility: e.target.value })}>
            <option value="gm_only">GMs only</option>
            <option value="faction">Same faction</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        <button className="ghost" onClick={refetchHunt}>Refresh</button><span className="gm-chip">GM</span>
      </div>
      <div className="tabs">
        {['hunt', 'map', 'characters', 'template', 'events', 'players'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => {
            if (t === 'map') setMapOpened(true)
            setTab(t)
          }}>
            {t.toUpperCase()}
            {t === 'events' && pendingEvents.length > 0 && <span className="badge">{pendingEvents.length}</span>}
          </button>
        ))}
      </div>
      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button className="ghost" onClick={() => setActionError('')}>Dismiss</button>
        </div>
      )}
      <div className={`tab-body ${tab === 'map' ? 'no-scroll' : ''}`}>
        {tab === 'hunt' && (
          <HuntPanel
            hunt={hunt}
            members={members}
            characters={characters}
            startHunt={startHunt}
            resetHunt={resetHunt}
            resolveClaim={resolveHuntClaim}
            eliminatePlayer={eliminateHuntPlayer}
            restorePlayer={restoreHuntPlayer}
            saveChain={saveHuntChain}
            assignNextTarget={assignNextTarget}
            refresh={refetchHunt}
          />
        )}
        <div style={{ display: tab === 'map' ? 'block' : 'none', height: '100%' }}>
          {mapOpened && (
            <ErrorBoundary fallback={
              <div className="panel-pad" role="alert">
                <p>The map could not load. Check your connection and reload to try again.</p>
                <button onClick={() => window.location.reload()}>Reload dashboard</button>
              </div>
            }>
              <Suspense fallback={<p className="hint" role="status">Loading map…</p>}>
                <MapPanel
                  active={tab === 'map'}
                  zones={zones} positions={positions} members={members} characters={characters} factions={factions}
                  pendingEvents={pendingEvents} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
                  saveZone={saveZone} deleteZone={deleteZone} confirmEvent={confirmEvent} dismissEvent={dismissEvent}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
        {tab === 'characters' && (
          <CharactersPanel game={game} characters={characters} members={members} factions={factions}
            usernameOf={usernameOf} saveCharacter={saveCharacter} addNpc={addNpc} deleteCharacter={deleteCharacter}
            addFaction={addFaction} />
        )}
        {tab === 'template' && <TemplatePanel game={game} hasCharacters={characters.length > 0} updateGame={updateGame} />}
        {tab === 'events' && (
          <EventsPanel events={history} pendingEvents={pendingEvents} loadOlder={loadOlder} hasMore={hasMore} historyBusy={historyBusy} members={members} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
            confirmEvent={confirmEvent} dismissEvent={dismissEvent} broadcast={broadcast} onOpenHunt={() => setTab('hunt')} />
        )}
        {tab === 'players' && (
          <PlayersPanel members={members} positions={positions} uid={uid} game={game}
            setMemberRole={setMemberRole} removeMember={removeMember} updateGame={updateGame} />
        )}
      </div>
    </div>
  )
}
