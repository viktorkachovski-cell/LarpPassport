import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GAME_COLUMNS, supabase } from './supabase'
import { unwrap } from './unwrap'
import { modeOf } from './gameModes'
import { parseWkbPoint } from './geo'
import { realtimeStateFromStatus } from './syncStatus'

const MEMBER_COLUMNS = '*, profile:profiles(username)'
const withoutId = (rows, id) => rows.filter((row) => row.id !== id)
const replaceById = (rows, next) => rows.map((row) => (row.id === next.id ? next : row))
const hasId = (rows, id) => rows.some((row) => row.id === id)

export function isGameGm(game, members, uid) {
  return game.gm_id === uid || members.some((member) => member.profile_id === uid && member.role === 'gm')
}

// Each request's data, or the first request error thrown.
async function dataOf(requests) {
  const results = await Promise.all(requests)
  const failed = results.find((result) => result.error)
  if (failed) throw failed.error
  return results.map((result) => result.data)
}

// Every pending event, newest first, across as many 500-row pages as it takes.
async function loadPending(gameId, isAlive) {
  const rows = []
  let before
  while (isAlive()) {
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

function fetchGmData(gameId, game, isAlive) {
  return dataOf([
    supabase.from('zones_view').select('*').eq('game_id', gameId),
    supabase.from('player_positions_view').select('*').eq('game_id', gameId),
    supabase.from('characters').select('*').eq('game_id', gameId),
    supabase.from('factions').select('*').eq('game_id', gameId),
    supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(200),
    supabase.rpc(modeOf(game).stateRpc, { g: gameId }),
    supabase.rpc('gm_get_join_code', { g: gameId }),
    loadPending(gameId, isAlive),
  ])
}

// One game's GM data: authoritative snapshots (on load, focus, reconnect and
// every minute) patched by Realtime. Separate sync facts: the last good
// snapshot, the last failed one, the Realtime socket hint and the browser's
// online hint. onError receives failures no panel reports itself.
export function useGameData(gameId, uid, onError) {
  const [game, setGame] = useState(null)
  const [members, setMembers] = useState([])
  const [zones, setZones] = useState([])
  const [positions, setPositions] = useState({})
  const [characters, setCharacters] = useState([])
  const [factions, setFactions] = useState([])
  const [events, setEvents] = useState([])
  const [pendingEvents, setPendingEvents] = useState([])
  const [olderEvents, setOlderEvents] = useState([])
  const [hasMore, setHasMore] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  // GM state of the game's mode: get_hunt_admin or gm_pirate_overview.
  const [modeState, setModeState] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [sync, setSync] = useState({ lastOkAt: null, lastErrorAt: null, lastError: '' })
  const [realtime, setRealtime] = useState('connecting')
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const refreshRef = useRef(() => {})
  const refreshTimer = useRef(null)
  const invalidateSnapshot = useRef(() => {})
  const loadedOnce = useRef(false)

  const isGm = !!game && isGameGm(game, members, uid)
  const mode = game ? modeOf(game) : null
  const refresh = useCallback(() => refreshRef.current(), [])
  // A write discards any snapshot still in flight: it predates the write.
  const invalidate = useCallback(() => invalidateSnapshot.current(), [])
  const scheduleRefresh = useCallback(() => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refreshRef.current(), 250)
  }, [])
  const recordOk = useCallback(() => setSync((current) => ({ ...current, lastOkAt: Date.now() })), [])
  const failSnapshot = useCallback((message) => {
    setSync((current) => ({ ...current, lastErrorAt: Date.now(), lastError: String(message ?? 'Request failed') }))
    // Keep the last good snapshot on screen; the status line reports staleness.
    if (!loadedOnce.current) setLoadError(message)
  }, [])
  const loadZones = useCallback(async () => {
    setZones(unwrap(await supabase.from('zones_view').select('*').eq('game_id', gameId)) ?? [])
  }, [gameId])
  const loadMembers = useCallback(async () => {
    setMembers(unwrap(await supabase.from('game_players').select(MEMBER_COLUMNS).eq('game_id', gameId)) ?? [])
  }, [gameId])

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
    invalidateSnapshot.current = () => { if (snapshotPending) { ++version; scheduleRefresh() } }
    function applyGmData([zoneRows, positionRows, characterRows, factionRows, eventRows, state, joinCode, pending], gameRow) {
      if (typeof joinCode === 'string') setGame((current) => ({ ...(current ?? gameRow), join_code: joinCode }))
      setZones(zoneRows ?? [])
      setPositions(Object.fromEntries((positionRows ?? []).map((row) => [row.profile_id, row])))
      setCharacters(characterRows ?? [])
      setFactions(factionRows ?? [])
      setEvents(eventRows ?? [])
      setPendingEvents(pending ?? [])
      setModeState(state)
    }
    async function load() {
      const request = ++version
      const current = () => alive && request === version
      snapshotPending = true
      try {
        const [gameRow, memberRows] = await dataOf([
          supabase.from('games').select(GAME_COLUMNS).eq('id', gameId).single(),
          supabase.from('game_players').select(MEMBER_COLUMNS).eq('game_id', gameId),
        ])
        if (!current()) return
        setGame(gameRow)
        setMembers(memberRows ?? [])
        if (isGameGm(gameRow, memberRows ?? [], uid)) {
          const gmData = await fetchGmData(gameId, gameRow, () => alive)
          if (!current()) return
          applyGmData(gmData, gameRow)
        }
        setLoadError('')
        loadedOnce.current = true
        recordOk()
      } catch (error) { if (current()) failSnapshot(error.message) }
      finally { if (request === version) snapshotPending = false }
    }
    refreshRef.current = load
    const focus = () => { if (document.visibilityState !== 'hidden') load() }
    const listeners = [
      [window, 'online', () => { setOnline(true); focus() }], [window, 'offline', () => setOnline(false)],
      [window, 'focus', focus], [document, 'visibilitychange', focus],
    ]
    for (const [target, type, listener] of listeners) target.addEventListener(type, listener)
    const timer = setInterval(focus, 60000)
    load()
    return () => {
      alive = false; ++version; clearInterval(timer); clearTimeout(refreshTimer.current)
      refreshRef.current = () => {}
      invalidateSnapshot.current = () => {}
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener)
    }
  }, [gameId, uid, scheduleRefresh, recordOk, failSnapshot])

  useEffect(() => {
    if (!isGm) return undefined
    const report = (promise) => promise.catch((error) => onError(error.message))
    const changes = (table, handler) => ['postgres_changes', { event: '*', schema: 'public', table, filter: `game_id=eq.${gameId}` }, handler]
    const channel = supabase.channel(`game-${gameId}`)
      .on(...changes('player_positions', (payload) => {
        invalidate()
        if (payload.eventType === 'DELETE') {
          const gone = payload.old?.profile_id
          if (gone) setPositions(({ [gone]: _gone, ...rest }) => rest)
          return
        }
        const row = payload.new
        const point = row?.profile_id && parseWkbPoint(row.geog)
        if (!point) return
        setPositions((prev) => ({ ...prev, [row.profile_id]: {
          ...prev[row.profile_id], profile_id: row.profile_id, lat: point.lat, lng: point.lng, accuracy_m: row.accuracy_m,
          battery_pct: row.battery_pct, recorded_at: row.recorded_at, updated_at: row.updated_at,
        } }))
      }))
      .on(...changes('game_events', (payload) => {
        invalidate()
        if (payload.eventType === 'DELETE') dropEvent(payload.old?.id)
        else putEvent(payload.new, payload.eventType === 'INSERT')
        if (payload.new && mode.reloadsOn(String(payload.new.type ?? ''))) scheduleRefresh()
      }))
      .on(...changes('characters', (payload) => {
        invalidate()
        if (payload.eventType === 'DELETE') setCharacters((prev) => withoutId(prev, payload.old?.id))
        else setCharacters((prev) => (hasId(prev, payload.new.id) ? replaceById(prev, payload.new) : [...prev, payload.new]))
      }))
      .on(...changes('zones', () => report(loadZones())))
      .on(...changes('game_players', () => report(loadMembers())))
      .subscribe((status) => {
        setRealtime(realtimeStateFromStatus(status))
        if (status === 'SUBSCRIBED') scheduleRefresh()
      })
    return () => { supabase.removeChannel(channel); setRealtime('closed') }
  }, [gameId, isGm, mode, invalidate, loadZones, loadMembers, onError, scheduleRefresh, putEvent, dropEvent])

  const history = useMemo(() => [...new Map([...olderEvents, ...events].map((e) => [e.id, e])).values()].sort((a, b) => b.seq - a.seq), [events, olderEvents])
  async function loadOlder() {
    if (historyBusy || !history.length) return
    setHistoryBusy(true)
    try {
      const rows = unwrap(await supabase.from('game_events').select('*').eq('game_id', gameId)
        .lt('seq', history.at(-1).seq).order('seq', { ascending: false }).limit(200))
      setOlderEvents((prev) => [...prev, ...(rows ?? [])])
      setHasMore(rows?.length === 200)
    } catch (error) { onError(error.message) } finally { setHistoryBusy(false) }
  }

  return {
    game, setGame, members, zones, positions, characters, factions, setFactions, pendingEvents, modeState, setModeState,
    history, loadOlder, hasMore, historyBusy, loadError, sync, realtime, online, isGm, mode,
    refresh, invalidate, loadZones, loadMembers, putEvent,
  }
}
