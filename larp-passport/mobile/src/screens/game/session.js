import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import { ownsGame } from '../../lib/brand'
import { readGameSnapshot } from '../../lib/gameSnapshot'
import { updateLocationConsent } from '../../lib/locationConsent'
import { flush, isSharing, locationPermissionStatus, queueStatus, startSharing, stopSharing, syncNotifications } from '../../lib/locationTask'
import { GAME_COLUMNS, supabase } from '../../lib/supabase'
import { realtimeStateFromStatus } from '../../lib/syncStatus'

// Separate facts (U01): last successful authoritative response, last failed
// one. The Realtime socket hint is tracked beside them; they may disagree.
export function useSyncLog() {
  const [sync, setSync] = useState({ lastOkAt: null, lastErrorAt: null, lastError: '' })
  const recordOk = useCallback(() => setSync((current) => ({ ...current, lastOkAt: Date.now() })), [])
  const recordError = useCallback((message) => setSync((current) => ({ ...current, lastErrorAt: Date.now(), lastError: String(message ?? 'Request failed') })), [])
  return { sync, recordOk, recordError }
}

// Latest reply of one game-scoped status RPC (`get_hunt_status`,
// `get_pirate_state`). A newer request or leaving the game discards older replies.
export function useGameRpc(name, gameId, { recordOk, recordError }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => () => { ++request.current }, [gameId])
  const load = useCallback(async () => {
    const id = ++request.current
    try {
      const { data: next, error: rpcError } = await supabase.rpc(name, { g: gameId })
      if (id !== request.current) return null
      if (rpcError) throw rpcError
      setData(next)
      setError('')
      recordOk()
      return next
    } catch (rpcError) {
      if (id === request.current) { setError(rpcError.message); recordError(rpcError.message) }
      return null
    }
  }, [name, gameId, recordOk, recordError])
  return { data, setData, error, setError, load }
}

// Everything a game screen shares across both apps: the snapshot (game,
// character, events), Realtime wake-ups, foreground recovery polling, device
// facts and location sharing. `loadMode` reloads the app's own game state and
// runs after every snapshot of a game this app owns.
export function useGameSession({ gameId, uid, syncLog, loadMode }) {
  const { recordOk, recordError } = syncLog
  const [game, setGame] = useState(null)
  const [character, setCharacter] = useState(undefined)
  const [events, setEvents] = useState([])
  const [sharing, setSharing] = useState(false)
  const [queue, setQueue] = useState({ queued: 0, failed: 0, lastError: null, lastSent: null, lastFixAt: null, profile: 'near' })
  const [permission, setPermission] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [realtime, setRealtime] = useState('connecting')
  const [sharingBusy, setSharingBusy] = useState(false)
  const refreshRef = useRef(() => {})
  const loadedOnce = useRef(false)

  useEffect(() => {
    let alive = true
    let version = 0
    let refreshTimer
    const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (alive) refresh() }, 250) }
    async function load() {
      const request = ++version
      try {
        const snapshot = await readGameSnapshot(supabase, gameId, uid, GAME_COLUMNS)
        if (!alive || request !== version) return
        setLoadError('')
        setGame(snapshot.game)
        setCharacter(snapshot.character)
        setEvents(snapshot.events)
        loadedOnce.current = true
        recordOk()
        if (ownsGame(snapshot.game)) loadMode()
        await syncNotifications(gameId).catch(() => {})
      } catch (loadFailure) {
        if (!alive || request !== version) return
        recordError(loadFailure.message)
        // Keep the last good snapshot on screen; the status line says it is stale.
        if (!loadedOnce.current) setLoadError(loadFailure.message)
      }
    }
    const refresh = () => { load() }
    refreshRef.current = refresh
    const readDeviceFacts = () => {
      queueStatus(gameId).then((status) => { if (alive) setQueue(status) }).catch((factError) => { if (alive) setError(factError.message) })
      isSharing(gameId).then((value) => { if (alive) setSharing(value) }).catch((factError) => { if (alive) setError(factError.message) })
      locationPermissionStatus().then((value) => { if (alive) setPermission(value) }).catch(() => {})
    }
    load()
    readDeviceFacts()
    Notifications.requestPermissionsAsync().catch(() => {})

    // Any change only wakes the debounced refresh, which reloads the snapshot,
    // the mode state and the notification feed together. An in-flight snapshot
    // predates the change, so it is discarded.
    const changed = () => { ++version; scheduleRefresh() }
    const channel = supabase
      .channel(`m-game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `game_id=eq.${gameId}` }, changed)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` }, changed)
      .subscribe((status) => {
        if (!alive) return
        setRealtime(realtimeStateFromStatus(status))
        if (status === 'SUBSCRIBED') refresh()
      })

    // Realtime is the normal update path; polling is the recovery mechanism.
    // Foreground snapshots recover every data set, including deletions missed
    // while the app was suspended. Background GPS continues independently.
    const tick = () => {
      if (AppState.currentState !== 'active') return
      readDeviceFacts()
      refresh()
    }
    const interval = setInterval(tick, 45000)
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') tick() // refresh immediately on return to foreground
    })

    return () => {
      alive = false; ++version
      refreshRef.current = () => {}
      clearInterval(interval); clearTimeout(refreshTimer)
      appStateSub.remove()
      supabase.removeChannel(channel)
    }
  }, [gameId, uid, loadMode, recordOk, recordError])

  const toggleSharing = useCallback(async (next) => {
    if (sharingBusy) return
    setSharingBusy(true)
    setError('')
    try {
      await updateLocationConsent({
        gameId, enabled: next,
        rpc: (...args) => supabase.rpc(...args),
        start: startSharing,
        stop: () => stopSharing(gameId),
        onStopped: () => setSharing(false),
      })
      setSharing(next)
    } catch (toggleError) {
      setError(toggleError.message)
    } finally { setSharingBusy(false) }
  }, [gameId, sharingBusy])

  const sendNow = useCallback(async () => {
    setError('')
    try {
      const result = await flush(gameId)
      if (result?.error) setError(`Send failed: ${result.error}`)
      setQueue(await queueStatus(gameId))
      setPermission(await locationPermissionStatus().catch(() => null))
    } catch (sendError) { setError(sendError.message) }
  }, [gameId])

  const visibleEvents = useMemo(
    () => events.filter((event) => event.player_visible && event.profile_id === uid),
    [events, uid],
  )
  const refresh = useCallback(() => refreshRef.current(), [])

  return {
    gameId, uid, game, character, setCharacter, visibleEvents,
    sync: syncLog.sync, realtime, loadError, refresh,
    sharing, setSharing, sharingBusy, toggleSharing, permission, queue, error, sendNow,
  }
}
