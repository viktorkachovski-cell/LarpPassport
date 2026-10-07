import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ErrorBoundary } from '@sentry/react'
import { GAME_COLUMNS, supabase } from '../lib/supabase'
import { unwrap } from '../lib/unwrap'
import { eventInfo } from '../lib/events'
import { modeOf, PIRATE_MODE, ruledInModeTab } from '../lib/gameModes'
import { parseWkbPoint } from '../lib/geo'
import CharactersPanel from './CharactersPanel'
import TemplatePanel from './TemplatePanel'
import EventsPanel from './EventsPanel'
import PlayersPanel from './PlayersPanel'
import HuntPanel from './HuntPanel'
import PiratePanel from './PiratePanel'
import SyncStatus from './SyncStatus'
import { realtimeStateFromStatus } from '../lib/syncStatus'

const MapPanel = lazy(() => import('./MapPanel'))

const ZONE_FIELDS = [
  'name', 'zone_type', 'trigger_mode', 'dwell_seconds', 'exit_buffer_m', 'one_shot', 'active',
  'radius_m', 'warning_distance_m', 'payload',
]

// The database keeps a game 'active' and GM-only for as long as its hunt
// round is active (protect_active_hunt_game), draft after a reset and
// finished with the round.
const GAME_FOR_HUNT_PHASE = {
  not_started: { status: 'draft' },
  active: { status: 'active', location_visibility: 'gm_only' },
  finished: { status: 'finished' },
}

const withoutId = (rows, id) => rows.filter((row) => row.id !== id)
const replaceById = (rows, next) => rows.map((row) => (row.id === next.id ? next : row))
const hasId = (rows, id) => rows.some((row) => row.id === id)

function isGameGm(game, members, uid) {
  return game.gm_id === uid || members.some((member) => member.profile_id === uid && member.role === 'gm')
}

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
  const invalidateSnapshot = useRef(() => {})
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refreshRef.current(), 250)
  }, [])
  // GM state of the game's mode: get_hunt_admin or gm_pirate_overview.
  const [modeState, setModeState] = useState(null)
  const [tab, setTab] = useState(null)
  const [mapOpened, setMapOpened] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  // Separate facts (U01): last successful authoritative snapshot, last failed
  // one, the Realtime socket hint and the browser online hint.
  const [sync, setSync] = useState({ lastOkAt: null, lastErrorAt: null, lastError: '' })
  const [realtime, setRealtime] = useState('connecting')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const loadedOnce = useRef(false)
  const recordOk = useCallback(() => setSync((current) => ({ ...current, lastOkAt: Date.now() })), [])
  const recordError = useCallback((message) => {
    setSync((current) => ({ ...current, lastErrorAt: Date.now(), lastError: String(message ?? 'Request failed') }))
    return message
  }, [])
  const failSnapshot = useCallback((message) => {
    recordError(message)
    // Keep the last good snapshot on screen; the status line reports staleness.
    if (!loadedOnce.current) setLoadError(message)
  }, [recordError])

  const isGm = !!game && isGameGm(game, members, uid)
  const mode = game ? modeOf(game) : null
  // The mode tab until the GM picks another tab this mode has.
  const activeTab = mode?.tabs.includes(tab) ? tab : mode?.key

  // Failures of writes that no panel reports itself go to the banner.
  const reportFailure = useCallback((promise) => promise.catch((error) => setActionError(error.message)), [])

  const loadZones = useCallback(async () => {
    setZones(unwrap(await supabase.from('zones_view').select('*').eq('game_id', gameId)) ?? [])
  }, [gameId])

  const loadMembers = useCallback(async () => {
    setMembers(unwrap(await supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId)) ?? [])
  }, [gameId])

  const refresh = useCallback(() => refreshRef.current(), [])

  // One event row changed: keep the recent page, the older pages and the
  // pending queue consistent with it. Only a new row joins the recent page.
  const putEvent = useCallback((row, isNew = false) => {
    setPendingEvents((prev) => (row.status === 'pending' ? [row, ...withoutId(prev, row.id)] : withoutId(prev, row.id)))
    setEvents((prev) => (hasId(prev, row.id) ? replaceById(prev, row) : isNew ? [row, ...prev].slice(0, 300) : prev))
    setOlderEvents((prev) => replaceById(prev, row))
  }, [])

  const dropEvent = useCallback((id) => {
    setPendingEvents((prev) => withoutId(prev, id))
    setEvents((prev) => withoutId(prev, id))
    setOlderEvents((prev) => withoutId(prev, id))
  }, [])

  useEffect(() => {
    let alive = true
    let version = 0
    let snapshotPending = false
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
    invalidateSnapshot.current = () => { if (snapshotPending) { ++version; scheduleRefresh() } }
    async function load() {
      const request = ++version
      snapshotPending = true
      try {
      const [g, mem] = await Promise.all([
        supabase.from('games').select(GAME_COLUMNS).eq('id', gameId).single(),
        supabase.from('game_players').select('*, profile:profiles(username)').eq('game_id', gameId),
      ])
      if (!alive || request !== version) return
      const accessFailure = [g, mem].find((result) => result.error)
      if (accessFailure) { failSnapshot(accessFailure.error.message); return }

      setGame(g.data)
      setMembers(mem.data ?? [])
      if (!isGameGm(g.data, mem.data ?? [], uid)) { setLoadError(''); loadedOnce.current = true; recordOk(); return }

      const [z, pos, chars, fac, ev, modeState, joinCode, pending] = await Promise.all([
        supabase.from('zones_view').select('*').eq('game_id', gameId),
        supabase.from('player_positions_view').select('*').eq('game_id', gameId),
        supabase.from('characters').select('*').eq('game_id', gameId),
        supabase.from('factions').select('*').eq('game_id', gameId),
        supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(200),
        supabase.rpc(modeOf(g.data).stateRpc, { g: gameId }),
        supabase.rpc('gm_get_join_code', { g: gameId }),
        loadPending(),
      ])
      if (!alive || request !== version) return
      const failed = [z, pos, chars, fac, ev, modeState, pending, joinCode].find((result) => result.error)
      if (failed) { failSnapshot(failed.error.message); return }
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
      setModeState(modeState.data)
      loadedOnce.current = true
      recordOk()
      } catch (error) { if (alive && request === version) failSnapshot(error.message) }
      finally { if (request === version) snapshotPending = false }
    }
    refreshRef.current = load
    const focus = () => { if (document.visibilityState !== 'hidden') load() }
    const wentOnline = () => { setOnline(true); focus() }
    const wentOffline = () => setOnline(false)
    window.addEventListener('online', wentOnline)
    window.addEventListener('offline', wentOffline)
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const timer = setInterval(focus, 60000)
    load()

    return () => {
      alive = false; ++version; clearInterval(timer); clearTimeout(refreshTimer.current)
      refreshRef.current = () => {}
      invalidateSnapshot.current = () => {}
      window.removeEventListener('online', wentOnline); window.removeEventListener('offline', wentOffline)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [gameId, uid, scheduleRefresh, recordOk, failSnapshot])

  useEffect(() => {
    if (!isGm) return undefined

    const channel = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_positions', filter: `game_id=eq.${gameId}` }, (payload) => {
        invalidateSnapshot.current()
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
        invalidateSnapshot.current()
        if (payload.eventType === 'DELETE') dropEvent(payload.old?.id)
        else putEvent(payload.new, payload.eventType === 'INSERT')
        if (payload.new && mode.reloadsOn(String(payload.new.type ?? ''))) scheduleRefresh()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `game_id=eq.${gameId}` }, (payload) => {
        invalidateSnapshot.current()
        if (payload.eventType === 'DELETE') setCharacters((prev) => withoutId(prev, payload.old?.id))
        else setCharacters((prev) => (hasId(prev, payload.new.id) ? replaceById(prev, payload.new) : [...prev, payload.new]))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'zones', filter: `game_id=eq.${gameId}` }, () => reportFailure(loadZones()))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${gameId}` }, () => reportFailure(loadMembers()))
      .subscribe((status) => {
        setRealtime(realtimeStateFromStatus(status))
        if (status === 'SUBSCRIBED') scheduleRefresh()
      })

    return () => { supabase.removeChannel(channel); setRealtime('closed') }
  }, [gameId, isGm, mode, loadZones, loadMembers, reportFailure, scheduleRefresh, putEvent, dropEvent])

  const usernameOf = useCallback((profileId) => {
    const m = members.find((x) => x.profile_id === profileId)
    return m?.profile?.username ?? positions[profileId]?.username ?? 'unknown'
  }, [members, positions])

  const zoneNameOf = useCallback((zoneId) => zones.find((z) => z.id === zoneId)?.name ?? 'a zone', [zones])

  // Pending events the Events tab and map rule on; Parley disputes are ruled
  // on in the Pirate tab.
  const eventQueue = useMemo(() => pendingEvents.filter((event) => !ruledInModeTab(event)), [pendingEvents])

  // Pending GM decisions, derived from authoritative state only: the mode
  // state and the fully paginated pending-event query, never the capped
  // history page.
  const decisions = useMemo(() => {
    if (!mode) return []
    const breaches = eventQueue.filter((event) => eventInfo(event.type).breach).length
    const triggers = eventQueue.length - breaches
    return [
      ...mode.decisions(modeState).map((item) => ({ ...item, tab: mode.key })),
      breaches && { key: 'breach', tab: 'events', text: `${breaches} boundary breach${breaches === 1 ? '' : 'es'} to review` },
      triggers && { key: 'trigger', tab: 'events', text: `${triggers} zone trigger${triggers === 1 ? '' : 's'} to confirm` },
    ].filter(Boolean)
  }, [mode, modeState, eventQueue])

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
    } catch (error) { setActionError(error.message) } finally { setHistoryBusy(false) }
  }

  // Every GM write discards any snapshot still in flight (it predates the
  // write) and clears the banner once it succeeds. Failures throw to the
  // panel that started the write, which reports them. RLS and the RPCs are
  // the access check.
  const gmWrite = (write) => async (...args) => {
    invalidateSnapshot.current()
    const result = await write(...args)
    setActionError('')
    return result
  }

  // Hunt RPCs return the new admin state; the game row follows its phase.
  const huntRpc = (name, argsOf) => gmWrite(async (...args) => {
    const data = unwrap(await supabase.rpc(name, argsOf(...args)))
    setModeState(data)
    setGame((current) => ({ ...current, ...GAME_FOR_HUNT_PHASE[data.phase] }))
  })

  const resolveEvent = (patch) => gmWrite(async (ev) => {
    const data = unwrap(await supabase.from('game_events')
      .update({ ...patch, resolved_at: new Date().toISOString(), resolved_by: uid }).eq('id', ev.id).select().single())
    putEvent(data)
  })

  const updateGame = gmWrite(async (patch) => {
    const data = unwrap(await supabase.from('games').update(patch).eq('id', gameId).select(GAME_COLUMNS).single())
    setGame((current) => ({ ...data, join_code: current?.join_code }))
  })
  const confirmEvent = resolveEvent({ status: 'confirmed', player_visible: true })
  const dismissEvent = resolveEvent({ status: 'dismissed' })
  const saveZone = gmWrite(async (draft) => {
    const fields = Object.fromEntries(ZONE_FIELDS.map((key) => [key, draft[key]]))
    unwrap(draft.id
      ? await supabase.from('zones').update(fields).eq('id', draft.id)
      : await supabase.from('zones').insert({ ...fields, game_id: gameId, shape: draft.shape, geog: draft.geog }))
    await loadZones()
  })
  const deleteZone = gmWrite(async (id) => {
    unwrap(await supabase.from('zones').delete().eq('id', id))
    await loadZones()
  })
  const saveCharacter = gmWrite(async (id, patch) => unwrap(await supabase.from('characters').update(patch).eq('id', id)))
  const addNpc = gmWrite(async (name) => unwrap(await supabase.from('characters').insert({ game_id: gameId, user_id: uid, name, is_npc: true })))
  const deleteCharacter = gmWrite(async (id) => unwrap(await supabase.from('characters').delete().eq('id', id)))
  const addFaction = gmWrite(async (name, color) => {
    const data = unwrap(await supabase.from('factions').insert({ game_id: gameId, name, color }).select().single())
    setFactions((prev) => [...prev, data])
  })
  const broadcast = gmWrite(async (targetProfileIds, message) => unwrap(await supabase.from('game_events').insert(
    targetProfileIds.map((pid) => ({
      game_id: gameId, profile_id: pid, type: 'gm_note', status: 'confirmed', player_visible: true,
      payload: { message },
    })),
  )))
  const setMemberRole = gmWrite(async (profileId, role) => {
    unwrap(await supabase.from('game_players').update({ role }).eq('game_id', gameId).eq('profile_id', profileId))
    await loadMembers()
  })
  const removeMember = gmWrite(async (profileId) => {
    unwrap(await supabase.from('game_players').delete().eq('game_id', gameId).eq('profile_id', profileId))
    await loadMembers()
  })
  const startHunt = huntRpc('start_hunt', () => ({ g: gameId }))
  const resetHunt = huntRpc('reset_hunt', () => ({ g: gameId }))
  const resolveHuntClaim = huntRpc('gm_resolve_elimination', (claimId, confirmed) => ({ claim_id: claimId, confirm_elimination: confirmed }))
  const eliminateHuntPlayer = huntRpc('gm_eliminate_player', (profileId) => ({ g: gameId, victim_id: profileId }))
  const restoreHuntPlayer = huntRpc('gm_restore_player', (profileId) => ({ g: gameId, profile_id: profileId }))
  const saveHuntChain = huntRpc('gm_set_hunt_chain', (profileIds) => ({ g: gameId, player_ids: profileIds }))
  const assignNextTarget = huntRpc('gm_assign_next_target', (profileId) => ({ g: gameId, hunter_id: profileId }))

  function copyCode() {
    if (!game.join_code) return
    navigator.clipboard?.writeText(game.join_code)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }

  if (loadError && !game) return <div className="center-screen"><p className="error" role="alert">{loadError}</p><button onClick={() => refreshRef.current()}>Retry</button><button onClick={onBack}>Back</button></div>
  if (!game) return <div className="center-screen"><p className="hint" role="status">Loading game…</p></div>

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
        <button className="code-chip" onClick={copyCode} title="Copy join code" aria-label={game.join_code ? `Join code ${game.join_code.split('').join(' ')}, copy to clipboard` : 'Join code not loaded'} aria-live="polite">{copied ? 'COPIED' : game.join_code ?? '········'}</button>
        <span className="spacer" />
        <div className="topbar-control">
          <span className="control-label">STATUS</span>
          <select className={`status-select status-${game.status}`} aria-label="Game status" value={game.status}
            disabled={mode.statusFollowsPhase} title={mode.statusFollowsPhase ? 'Pirate status follows the phase controls' : undefined}
            onChange={(e) => reportFailure(updateGame({ status: e.target.value }))}>
            <option value="draft">DRAFT</option>
            <option value="active">ACTIVE</option>
            <option value="finished">FINISHED</option>
          </select>
        </div>
        <div className="topbar-control">
          <span className="control-label">WHO SEES POSITIONS</span>
          <select aria-label="Position visibility" value={game.location_visibility} onChange={(e) => reportFailure(updateGame({ location_visibility: e.target.value }))}>
            <option value="gm_only">GMs only</option>
            <option value="faction">Same faction</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        {mode.directionControl && <div className="topbar-control">
          <span className="control-label">HUNTER DIRECTION</span>
          <select aria-label="Hunter direction to target" title="On: living hunters see a true-north bearing to their target and only the distance band. Off: rounded metres, no bearing."
            value={game.direction_enabled ? 'on' : 'off'} onChange={(e) => reportFailure(updateGame({ direction_enabled: e.target.value === 'on' }))}>
            <option value="off">Off (bands + metres)</option>
            <option value="on">On (bearing + bands)</option>
          </select>
        </div>}
        <button className="ghost" onClick={refresh}>Refresh</button><span className="gm-chip">GM</span>
      </div>
      <SyncStatus sync={sync} realtime={realtime} online={online} onRetry={refresh} />
      {decisions.length > 0 && (
        <div className="pending-decisions" role="region" aria-label="Pending decisions" aria-live="polite">
          <b>{decisions.length} DECISION{decisions.length === 1 ? '' : 'S'} WAITING</b>
          {[mode.key, 'events'].map((target) => {
            const items = decisions.filter((item) => item.tab === target)
            if (items.length === 0) return null
            return (
              <span key={target} className="row">
                <span>{items.map((item) => item.text).join(' · ')}</span>
                {activeTab !== target && <button type="button" className="ghost" onClick={() => setTab(target)}>Open {target[0].toUpperCase() + target.slice(1)}</button>}
              </span>
            )
          })}
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="Game sections">
        {mode.tabs.map((t) => (
          <button key={t} role="tab" aria-selected={activeTab === t} className={activeTab === t ? 'active' : ''} onClick={() => {
            if (t === 'map') setMapOpened(true)
            setTab(t)
          }}>
            {t.toUpperCase()}
            {t === 'events' && eventQueue.length > 0 && <span className="badge" aria-label={`${eventQueue.length} pending`}>{eventQueue.length}</span>}
          </button>
        ))}
      </div>
      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button className="ghost" onClick={() => setActionError('')}>Dismiss</button>
        </div>
      )}
      <div className={`tab-body ${activeTab === 'map' ? 'no-scroll' : ''}`}>
        {activeTab === 'pirate' && <PiratePanel game={game} state={mode === PIRATE_MODE ? modeState : null} zones={zones}
          refresh={refresh} />}
        {activeTab === 'hunt' && (
          <HuntPanel
            hunt={modeState}
            members={members}
            characters={characters}
            startHunt={startHunt}
            resetHunt={resetHunt}
            resolveClaim={resolveHuntClaim}
            eliminatePlayer={eliminateHuntPlayer}
            restorePlayer={restoreHuntPlayer}
            saveChain={saveHuntChain}
            assignNextTarget={assignNextTarget}
            refresh={refresh}
          />
        )}
        <div style={{ display: activeTab === 'map' ? 'block' : 'none', height: '100%' }}>
          {mapOpened && (
            <ErrorBoundary fallback={
              <div className="panel-pad" role="alert">
                <p>The map could not load. Check your connection and reload to try again.</p>
                <button onClick={() => window.location.reload()}>Reload dashboard</button>
              </div>
            }>
              <Suspense fallback={<p className="hint" role="status">Loading map…</p>}>
                <MapPanel
                  active={activeTab === 'map'}
                  zones={zones} positions={positions} members={members} characters={characters} factions={factions}
                  pendingEvents={eventQueue} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
                  saveZone={saveZone} deleteZone={deleteZone} confirmEvent={confirmEvent} dismissEvent={dismissEvent}
                />
              </Suspense>
            </ErrorBoundary>
          )}
        </div>
        {activeTab === 'characters' && (
          <CharactersPanel game={game} characters={characters} members={members} factions={factions}
            usernameOf={usernameOf} saveCharacter={saveCharacter} addNpc={addNpc} deleteCharacter={deleteCharacter}
            addFaction={addFaction} />
        )}
        {activeTab === 'template' && <TemplatePanel game={game} hasCharacters={characters.length > 0} updateGame={updateGame} />}
        {activeTab === 'events' && (
          <EventsPanel events={history} pendingEvents={eventQueue} loadOlder={loadOlder} hasMore={hasMore} historyBusy={historyBusy} members={members} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
            confirmEvent={confirmEvent} dismissEvent={dismissEvent} broadcast={broadcast} onOpenHunt={() => setTab('hunt')} />
        )}
        {activeTab === 'players' && (
          <PlayersPanel members={members} positions={positions} uid={uid} game={game}
            setMemberRole={setMemberRole} removeMember={removeMember} updateGame={updateGame} />
        )}
      </div>
    </div>
  )
}
