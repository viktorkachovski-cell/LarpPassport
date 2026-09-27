import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Notifications from 'expo-notifications'
import { GAME_COLUMNS, supabase } from '../lib/supabase'
import { C, F, S, T, toneColor } from '../lib/theme'
import { readGameSnapshot } from '../lib/gameSnapshot'
import { eventInfo } from '../lib/events'
import { updateLocationConsent } from '../lib/locationConsent'
import { flush, isSharing, locationPermissionStatus, syncNotifications, queueStatus, startSharing, stopSharing } from '../lib/locationTask'
import { describeServerSync, realtimeStateFromStatus } from '../lib/syncStatus'
import { countdown } from '../lib/time'
import { useNow } from '../lib/useNow'
import { common } from '../ui/common'
import { LiveDot } from '../ui/primitives'
import { HuntPanel } from './game/HuntPanel'
import { CharacterSheet, CreateCharacter } from './game/CharacterTab'
import { EventsTab } from './game/EventsTab'
import { SharingTab } from './game/SharingTab'

// Self-ticking countdown. The one-second timer lives HERE, so it re-renders
// this single <Text> instead of the whole game screen; it also stops itself
// once the target time has passed.
function Countdown({ to }) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    if (!to || new Date(to).getTime() <= Date.now()) return undefined
    const timer = setInterval(() => {
      const t = Date.now()
      setTick(t)
      if (new Date(to).getTime() <= t) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [to])
  return <Text>{countdown(to, tick)}</Text>
}

function getPlayerStatus(hunt) {
  if (!hunt || hunt.phase === 'not_started') return { value: 'STANDBY', color: C.amber }
  if (hunt.phase === 'finished' && hunt.winner?.is_self) return { value: 'WINNER', color: C.cyan }
  if (!hunt.participant) return { value: 'OBSERVER', color: C.muted }
  if (!hunt.alive) return { value: 'OUT', color: C.red }
  if (hunt.incoming_claim) return { value: 'CLAIMED', color: C.amber }
  return { value: 'ALIVE', color: C.green }
}

export default function GameScreen({ gameId, session, onBack }) {
  const uid = session.user.id
  const [game, setGame] = useState(null)
  const [character, setCharacter] = useState(undefined)
  const [events, setEvents] = useState([])
  const [tab, setTab] = useState('hunt')
  const [sharing, setSharing] = useState(false)
  const [hunt, setHunt] = useState(null)
  const [huntBusy, setHuntBusy] = useState(false)
  const [huntError, setHuntError] = useState('')
  const [queue, setQueue] = useState({ queued: 0, failed: 0, lastError: null, lastSent: null, lastFixAt: null, profile: 'near' })
  const [permission, setPermission] = useState(null)
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  // Separate facts (U01): last successful authoritative response, last failed
  // one, and the Realtime socket hint. They are allowed to disagree.
  const [sync, setSync] = useState({ lastOkAt: null, lastErrorAt: null, lastError: '' })
  const [realtime, setRealtime] = useState('connecting')
  const refreshRef = useRef(() => {})
  const huntRequest = useRef(0)
  const loadedOnce = useRef(false)
  const now = useNow(30000)
  const recordOk = useCallback(() => setSync((current) => ({ ...current, lastOkAt: Date.now() })), [])
  const recordError = useCallback((message) => setSync((current) => ({ ...current, lastErrorAt: Date.now(), lastError: String(message ?? 'Request failed') })), [])

  const stats = game?.template?.stats ?? []

  const loadHunt = useCallback(async () => {
    const request = ++huntRequest.current
    try {
    const { data, error: huntLoadError } = await supabase.rpc('get_hunt_status', { g: gameId })
    if (request !== huntRequest.current) return null
    if (huntLoadError) {
      setHuntError(huntLoadError.message)
      recordError(huntLoadError.message)
      return null
    }
    setHunt(data)
    setHuntError('')
    recordOk()
    return data
    } catch (error) {
      if (request === huntRequest.current) { setHuntError(error.message); recordError(error.message) }
      return null
    }
  }, [gameId, recordOk, recordError])


  // Relative timestamps ("5m ago") and the boundary banner only need coarse
  // time. Live countdowns tick per-second inside <Countdown /> instead of
  // re-rendering the whole screen every second.
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
      await syncNotifications(gameId).catch(() => {})
      } catch (error) {
        if (!alive || request !== version) return
        recordError(error.message)
        // Keep the last good snapshot on screen; the status line says it is stale.
        if (!loadedOnce.current) setLoadError(error.message)
      }
    }
    const refresh = () => { load(); loadHunt() }
    refreshRef.current = refresh
    const readDeviceFacts = () => {
      queueStatus(gameId).then((status) => { if (alive) setQueue(status) }).catch((error) => { if (alive) setError(error.message) })
      isSharing(gameId).then((value) => { if (alive) setSharing(value) }).catch((error) => { if (alive) setError(error.message) })
      locationPermissionStatus().then((value) => { if (alive) setPermission(value) }).catch(() => {})
    }
    load()
    loadHunt()
    readDeviceFacts()
    Notifications.requestPermissionsAsync().catch(() => {})

    // Any change only wakes the debounced refresh, which reloads the snapshot,
    // the hunt and the notification feed together. An in-flight snapshot
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
      alive = false; ++version; ++huntRequest.current
      refreshRef.current = () => {}
      clearInterval(interval); clearTimeout(refreshTimer)
      appStateSub.remove()
      supabase.removeChannel(channel)
    }
  }, [gameId, uid, loadHunt, recordOk, recordError])

  useEffect(() => {
    if (!hunt?.participant || hunt.alive || !sharing) return
    stopSharing(gameId).then(() => setSharing(false)).catch(() => {})
  }, [gameId, hunt?.alive, hunt?.participant, sharing])

  const [sharingBusy, setSharingBusy] = useState(false)
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
    } catch (error) { setError(error.message) }
  }, [gameId])

  // Outcome of the player's last hunt action. Stays until dismissed or the
  // next action; dismissing it never touches server state.
  const [huntOutcome, setHuntOutcome] = useState('')
  const huntBusyRef = useRef(false)
  const requestElimination = useCallback(async () => {
    if (huntBusyRef.current) return
    huntBusyRef.current = true
    setHuntBusy(true); setHuntError(''); setHuntOutcome('')
    try {
    const { error: claimError } = await supabase.rpc('request_elimination', { g: gameId })
    if (claimError) { setHuntError(claimError.message); return }
    setHuntOutcome('Claim sent. Your target must confirm it.')
    await loadHunt()
    } catch (error) { setHuntError(error.message) } finally { huntBusyRef.current = false; setHuntBusy(false) }
  }, [gameId, loadHunt])

  const confirmEliminationRequest = useCallback(() => {
    Alert.alert(
      'Confirm elimination claim?',
      'Only continue after the live mock battle has been resolved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request confirmation', onPress: requestElimination },
      ],
    )
  }, [requestElimination])

  const incomingClaimId = hunt?.incoming_claim?.id
  const respondToElimination = useCallback(async (confirmed) => {
    if (!incomingClaimId || huntBusyRef.current) return
    huntBusyRef.current = true
    setHuntBusy(true); setHuntError(''); setHuntOutcome('')
    try {
    const { data, error: responseError } = await supabase.rpc('respond_elimination', {
      claim_id: incomingClaimId,
      confirm_elimination: confirmed,
    })
    if (responseError) { setHuntError(responseError.message); return }
    setHunt(data)
    setHuntOutcome(confirmed ? 'Elimination confirmed.' : 'Claim not confirmed. You stay in the hunt; the GM can still overrule.')
    } catch (error) { setHuntError(error.message) } finally { huntBusyRef.current = false; setHuntBusy(false) }
  }, [incomingClaimId])

  const visibleEvents = events.filter((event) => event.player_visible && event.profile_id === uid)
  const latestBoundaryEvent = visibleEvents.find((event) => eventInfo(event.type).boundary)
  const boundaryWarning = latestBoundaryEvent?.type === 'zone_boundary_warning'
    && now - new Date(latestBoundaryEvent.created_at).getTime() < 120000

  if (loadError) return (
    <SafeAreaView style={styles.loading}>
      <Text style={styles.loadingText} accessibilityLiveRegion="polite">{loadError}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={() => refreshRef.current()} style={styles.loadingAction}><Text style={styles.loadingText}>Retry</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.loadingAction}><Text style={styles.loadingText}>Back to games</Text></TouchableOpacity>
    </SafeAreaView>
  )
  if (!game || character === undefined) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.loadingText}>LOADING GAME...</Text>
      </SafeAreaView>
    )
  }

  const phase = hunt?.phase ?? game.status
  const playerStatus = getPlayerStatus(hunt)
  const phaseColor = phase === 'active' ? C.green : phase === 'finished' ? C.muted : C.amber
  const phaseLabel = phase === 'active' ? 'ACTIVE' : phase === 'finished' ? 'FINISHED' : 'DRAFT'

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to games" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>&lt;</Text>
        </TouchableOpacity>
        <Text style={styles.gameName} numberOfLines={1}>{game.name.toUpperCase()}</Text>
        <View style={[styles.phaseChip, { borderColor: phaseColor }]} accessibilityLabel={`Game ${phaseLabel.toLowerCase()}`}>
          {phase === 'active' && <LiveDot color={C.green} />}
          <Text style={[styles.phaseText, { color: phaseColor }]}>{phaseLabel}</Text>
        </View>
      </View>

      <SyncStatusLine sync={sync} realtime={realtime} onRetry={() => refreshRef.current()} />

      <View style={styles.stateStrip}>
        <StateCell value={hunt?.alive_count ?? '--'} label={phase === 'not_started' ? 'PLAYERS JOINED' : 'TRAVELLERS LEFT'} />
        <StateCell value={playerStatus.value} label="YOUR STATUS" color={playerStatus.color} bordered />
        <StateCell value={<Countdown to={hunt?.hidden_until} />} label="CLOAK LEFT" color={C.cyan} />
      </View>

      {!!hunt?.incoming_claim && tab !== 'hunt' && (
        <View style={styles.decisionBanner} accessibilityLiveRegion="polite">
          <Text style={styles.decisionText}>1 decision waiting: a hunter claims they defeated you.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setTab('hunt')} style={styles.decisionButton}>
            <Text style={styles.decisionButtonText}>OPEN HUNT</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.tabs}>
        {[['hunt', 'HUNT'], ['sheet', 'CHARACTER'], ['events', 'EVENTS'], ['share', 'SHARING']].map(([key, label]) => (
          <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} accessibilityLabel={label.toLowerCase()} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.activeTab]}>
            <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'hunt' && (
        <HuntPanel
          hunt={hunt}
          hasCharacter={character !== null}
          busy={huntBusy}
          error={huntError}
          outcome={huntOutcome}
          dismissOutcome={() => setHuntOutcome('')}
          boundaryWarning={boundaryWarning}
          requestElimination={confirmEliminationRequest}
          respondToElimination={respondToElimination}
          refresh={() => refreshRef.current()}
        />
      )}

      {tab === 'sheet' && (
        character === null
          ? <CreateCharacter game={game} uid={uid} onCreated={setCharacter} />
          : <CharacterSheet character={character} stats={stats} />
      )}

      {tab === 'events' && <EventsTab gameId={gameId} events={visibleEvents} />}

      {tab === 'share' && (
        <SharingTab
          game={game}
          phase={phase}
          sharing={sharing}
          permission={permission}
          queue={queue}
          error={error}
          sharingBusy={sharingBusy}
          toggleSharing={toggleSharing}
          sendNow={sendNow}
        />
      )}
    </SafeAreaView>
  )
}

// Self-ticking (10 s) so "12s ago" stays honest without re-rendering the
// screen. The age line is deliberately not a live region: announcing every
// tick would be noise. Only the error detail is announced.
function SyncStatusLine({ sync, realtime, onRetry }) {
  const now = useNow(10000)
  const status = describeServerSync({ ...sync, realtime, now })
  const color = toneColor(status.tone)
  return (
    <View style={styles.syncLine}>
      <View style={common.flex}>
        <Text style={[styles.syncText, { color }]}>{status.text}</Text>
        <Text style={styles.syncDetail} accessibilityLiveRegion={status.tone === 'error' ? 'polite' : 'none'}>{status.detail}</Text>
      </View>
      {status.tone === 'error' && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry sync" onPress={onRetry} style={styles.syncRetry}>
          <Text style={styles.syncRetryText}>RETRY</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

const StateCell = memo(function StateCell({ value, label, color = C.text, bordered = false }) {
  const isElement = typeof value === 'object' && value !== null
  return (
    <View style={[styles.stateCell, bordered && styles.stateCellBorder]}>
      <Text style={[styles.stateValue, { color }]} numberOfLines={1}>{isElement ? value : String(value)}</Text>
      <Text style={styles.stateLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  loading: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 6 },
  loadingAction: { minHeight: S.touch, justifyContent: 'center', paddingHorizontal: 16 },
  loadingText: { color: C.cyan, fontFamily: F.mono, fontSize: T.label, letterSpacing: 1.4, textAlign: 'center', paddingHorizontal: 20, lineHeight: T.lineLabel },
  header: { minHeight: 55, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, backgroundColor: C.ink },
  backButton: { width: S.touch, minHeight: S.touch, alignItems: 'flex-start', justifyContent: 'center' },
  backText: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 20 },
  gameName: { flex: 1, color: C.text, fontFamily: F.displayBold, fontSize: 17, letterSpacing: 1.35 },
  phaseChip: { minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 6 },
  phaseText: { fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1.1 },
  syncLine: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingBottom: 8, gap: 10 },
  syncText: { fontFamily: F.bodyMedium, fontSize: T.body },
  syncDetail: { color: C.muted, fontFamily: F.body, fontSize: T.label, lineHeight: T.lineLabel, marginTop: 1 },
  syncRetry: { minHeight: S.touch, justifyContent: 'center', borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12 },
  syncRetryText: { color: C.text, fontFamily: F.displaySemiBold, fontSize: 12.5, letterSpacing: 0.85 },
  stateStrip: { minHeight: 57, flexDirection: 'row', backgroundColor: C.panel, borderTopColor: C.line, borderTopWidth: 1, borderBottomColor: C.line, borderBottomWidth: 1 },
  stateCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stateCellBorder: { borderLeftColor: C.line, borderLeftWidth: 1, borderRightColor: C.line, borderRightWidth: 1 },
  stateValue: { fontFamily: F.displayBold, fontSize: 18 },
  stateLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 0.6, marginTop: 3, textAlign: 'center' },
  tabs: { minHeight: S.touch, flexDirection: 'row', borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.ink },
  tab: { flex: 1, minHeight: S.touch, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  activeTab: { borderBottomColor: C.cyan },
  tabText: { color: C.muted, fontFamily: F.displaySemiBold, fontSize: 13, letterSpacing: 0.4, textAlign: 'center' },
  activeTabText: { color: C.text },
  decisionBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,176,32,0.10)', borderTopColor: C.amberBorder, borderTopWidth: 1, borderBottomColor: C.amberBorder, borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
  decisionText: { flex: 1, color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  decisionButton: { minHeight: S.touch, justifyContent: 'center', backgroundColor: C.amber, borderRadius: 6, paddingHorizontal: 12 },
  decisionButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 12.5, letterSpacing: 0.8 },
})
