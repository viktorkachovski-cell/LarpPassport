import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Animated, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { C, F } from '../lib/theme'
import { flush, isSharing, markSeenUpTo, notifyEvents, queueStatus, startSharing, stopSharing } from '../lib/locationTask'

const BANDS = ['immediate', 'close', 'nearby', 'distant', 'far']

function timeAgo(timestamp) {
  if (!timestamp) return '--'
  const seconds = Math.max(0, (Date.now() - new Date(timestamp).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function remainingMinutes(timestamp) {
  if (!timestamp) return 0
  return Math.max(0, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 60000))
}

function countdown(timestamp, now) {
  if (!timestamp) return '--'
  const remaining = Math.max(0, new Date(timestamp).getTime() - now)
  if (!remaining) return '--'
  const totalSeconds = Math.ceil(remaining / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
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
  const [queue, setQueue] = useState({ queued: 0, lastSent: null, profile: 'near' })
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  const stats = game?.template?.stats ?? []

  const loadHunt = useCallback(async () => {
    const { data, error: huntLoadError } = await supabase.rpc('get_hunt_status', { g: gameId })
    if (huntLoadError) {
      setHuntError(huntLoadError.message)
      return null
    }
    setHunt(data)
    setHuntError('')
    return data
  }, [gameId])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let alive = true
    async function load() {
      const [gameResult, characterResult, eventResult] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('characters').select('*').eq('game_id', gameId).eq('user_id', uid).eq('is_npc', false).maybeSingle(),
        supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(50),
      ])
      if (!alive) return
      setGame(gameResult.data ?? null)
      setCharacter(characterResult.data ?? null)
      setEvents(eventResult.data ?? [])
      let maxSeq = 0
      for (const event of eventResult.data ?? []) {
        if (event.player_visible && event.profile_id === uid && event.seq > maxSeq) maxSeq = event.seq
      }
      if (maxSeq > 0) markSeenUpTo(maxSeq)
    }

    load()
    loadHunt()
    isSharing().then(setSharing)
    queueStatus().then(setQueue)
    Notifications.requestPermissionsAsync().catch(() => {})

    const channel = supabase
      .channel(`m-game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `game_id=eq.${gameId}` }, (payload) => {
        if (payload.new?.user_id === uid && !payload.new?.is_npc) setCharacter(payload.new)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` }, (payload) => {
        const row = payload.new
        if (!row?.id) return
        setEvents((previous) => {
          const index = previous.findIndex((event) => event.id === row.id)
          if (index === -1) return [row, ...previous].slice(0, 100)
          const next = [...previous]
          next[index] = row
          return next
        })
        if (row.player_visible && row.profile_id === uid && row.type !== 'player_message') notifyEvents([row])
        if (row.profile_id === uid && (
          row.type?.startsWith('hunt_')
          || row.type?.startsWith('elimination_')
          || row.type === 'eliminated'
          || row.type === 'zone_boundary_exit'
        )) loadHunt()
      })
      .subscribe()

    const interval = setInterval(() => {
      queueStatus().then(setQueue)
      isSharing().then(setSharing)
      loadHunt()
    }, 15000)

    return () => {
      alive = false
      clearInterval(interval)
      supabase.removeChannel(channel)
    }
  }, [gameId, uid, loadHunt])

  useEffect(() => {
    if (!hunt?.participant || hunt.alive || !sharing) return
    stopSharing().then(() => setSharing(false)).catch(() => {})
  }, [hunt?.alive, hunt?.participant, sharing])

  async function toggleSharing(next) {
    setError('')
    try {
      if (next) {
        await supabase.rpc('set_location_consent', { g: gameId, grant_consent: true })
        try {
          await startSharing(gameId)
        } catch (permissionError) {
          await supabase.rpc('set_location_consent', { g: gameId, grant_consent: false })
          throw permissionError
        }
        setSharing(true)
      } else {
        await stopSharing()
        await supabase.rpc('set_location_consent', { g: gameId, grant_consent: false })
        setSharing(false)
      }
    } catch (toggleError) {
      setError(toggleError.message)
    }
  }

  async function sendNow() {
    setError('')
    const result = await flush(gameId)
    if (result?.error) setError(`Send failed: ${result.error}`)
    queueStatus().then(setQueue)
  }

  async function requestElimination() {
    setHuntBusy(true); setHuntError('')
    const { error: claimError } = await supabase.rpc('request_elimination', { g: gameId })
    setHuntBusy(false)
    if (claimError) { setHuntError(claimError.message); return }
    await loadHunt()
  }

  function confirmEliminationRequest() {
    Alert.alert(
      'Confirm elimination claim?',
      'Only continue after the live mock battle has been resolved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request confirmation', onPress: requestElimination },
      ],
    )
  }

  async function respondToElimination(confirmed) {
    if (!hunt?.incoming_claim?.id) return
    setHuntBusy(true); setHuntError('')
    const { data, error: responseError } = await supabase.rpc('respond_elimination', {
      claim_id: hunt.incoming_claim.id,
      confirm_elimination: confirmed,
    })
    setHuntBusy(false)
    if (responseError) { setHuntError(responseError.message); return }
    setHunt(data)
  }

  const visibleEvents = events.filter((event) => event.player_visible && event.profile_id === uid)
  const latestBoundaryEvent = visibleEvents.find((event) => event.type === 'zone_boundary_warning' || event.type === 'zone_boundary_exit')
  const boundaryWarning = latestBoundaryEvent?.type === 'zone_boundary_warning'
    && now - new Date(latestBoundaryEvent.created_at).getTime() < 120000

  if (!game || character === undefined) {
    return (
      <SafeAreaView style={styles.loading}>
        <Text style={styles.loadingText}>SYNCING FIELD DATA...</Text>
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
        <TouchableOpacity accessibilityLabel="Back to deployments" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>&lt;</Text>
        </TouchableOpacity>
        <Text style={styles.gameName} numberOfLines={1}>{game.name.toUpperCase()}</Text>
        <View style={[styles.phaseChip, { borderColor: phaseColor }]}>
          {phase === 'active' && <LiveDot color={C.green} />}
          <Text style={[styles.phaseText, { color: phaseColor }]}>{phaseLabel}</Text>
        </View>
      </View>

      <View style={styles.stateStrip}>
        <StateCell value={hunt?.alive_count ?? '--'} label={phase === 'not_started' ? 'TRAVELLERS JOINED' : 'TRAVELLERS LEFT'} />
        <StateCell value={playerStatus.value} label="YOUR STATUS" color={playerStatus.color} bordered />
        <StateCell value={countdown(hunt?.hidden_until, now)} label="CLOAK LEFT" color={C.cyan} />
      </View>

      <View style={styles.tabs}>
        {[['hunt', 'HUNT'], ['sheet', 'CHARACTER'], ['events', 'EVENTS'], ['share', 'SHARING']].map(([key, label]) => (
          <TouchableOpacity key={key} onPress={() => setTab(key)} style={[styles.tab, tab === key && styles.activeTab]}>
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
          boundaryWarning={boundaryWarning}
          requestElimination={confirmEliminationRequest}
          respondToElimination={respondToElimination}
          refresh={loadHunt}
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
          queue={queue}
          error={error}
          toggleSharing={toggleSharing}
          sendNow={sendNow}
        />
      )}
    </SafeAreaView>
  )
}

function LiveDot({ color }) {
  const opacity = useRef(new Animated.Value(1)).current

  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
    ]))
    animation.start()
    return () => animation.stop()
  }, [opacity])

  return <Animated.View style={[styles.liveDot, { backgroundColor: color, opacity }]} />
}

function StateCell({ value, label, color = C.text, bordered = false }) {
  return (
    <View style={[styles.stateCell, bordered && styles.stateCellBorder]}>
      <Text style={[styles.stateValue, { color }]} numberOfLines={1}>{String(value)}</Text>
      <Text style={styles.stateLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
}

function HuntPanel({ hunt, hasCharacter, busy, error, boundaryWarning, requestElimination, respondToElimination, refresh }) {
  function confirmDefeat() {
    Alert.alert(
      'Confirm your elimination?',
      'This removes you from the hunt. A GM can restore you if the app or ruling is inconsistent.',
      [
        { text: 'Not confirmed', style: 'cancel', onPress: () => respondToElimination(false) },
        { text: 'Confirm elimination', style: 'destructive', onPress: () => respondToElimination(true) },
      ],
    )
  }

  if (!hunt) {
    return (
      <View style={styles.centerState}>
        <Text style={[styles.centerCopy, error && styles.errorText]}>{error || 'Reading temporal field...'}</Text>
        {!!error && <GhostButton label="RETRY" onPress={refresh} />}
      </View>
    )
  }

  if (hunt.phase === 'not_started') {
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
        <View style={styles.neutralCard}>
          <Text style={styles.cyanKicker}>O AWAITING THE HUNT</Text>
          <Text style={styles.sectionTitle}>Deployment pending</Text>
          <Text style={styles.bodyCopy}>The GM will lock the roster and assign one secret target to every traveller.</Text>
          {!hasCharacter && (
            <View style={styles.warningInset}>
              <Text style={styles.warningInsetText}>Create your character before the hunt can start.</Text>
            </View>
          )}
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <GhostButton label="REFRESH" onPress={refresh} />
        </View>
      </ScrollView>
    )
  }

  if (!hunt.participant) {
    return (
      <View style={styles.centerState}>
        <View style={styles.neutralIcon}><Text style={styles.neutralIconText}>O</Text></View>
        <Text style={styles.sectionTitle}>Observer channel</Text>
        <Text style={styles.centerCopy}>You are not part of this target chain.</Text>
      </View>
    )
  }

  if (hunt.phase === 'finished') return <FinishedState hunt={hunt} />
  if (!hunt.alive) return <EliminatedState aliveCount={hunt.alive_count} />

  const cloakMinutes = remainingMinutes(hunt.hidden_until)
  const awaitingTarget = !hunt.target
  const claimPending = !!hunt.outgoing_claim
  const disabled = busy || claimPending || awaitingTarget

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      {!!hunt.incoming_claim && (
        <View style={styles.claimAlert}>
          <Text style={styles.redKicker}>! ELIMINATION CLAIMED</Text>
          <Text style={styles.claimTitle}>A hunter claims they defeated you</Text>
          <Text style={styles.bodyCopy}>The hunter remains anonymous. Confirm only after the live battle is resolved.</Text>
          <TouchableOpacity disabled={busy} onPress={confirmDefeat} style={[styles.redButton, busy && styles.disabled]}>
            <Text style={styles.filledButtonText}>REVIEW CONFIRMATION</Text>
          </TouchableOpacity>
        </View>
      )}

      {boundaryWarning && (
        <View style={styles.boundaryBanner}>
          <Text style={styles.amberKicker}>! ANOMALY BOUNDARY AHEAD</Text>
          <Text style={styles.boundaryCopy}>Move toward the safe interior. Leaving forfeits any pending claim and alerts the GM.</Text>
        </View>
      )}

      {cloakMinutes > 0 && (
        <View style={styles.cloakCard}>
          <View style={styles.kickerRow}><LiveDot color={C.cyan} /><Text style={styles.cyanKicker}>TEMPORAL CLOAK ACTIVE</Text></View>
          <Text style={styles.cloakCopy}>Your hunter cannot read your proximity for about {cloakMinutes} minute{cloakMinutes === 1 ? '' : 's'}.</Text>
        </View>
      )}

      <View style={[styles.targetCard, awaitingTarget && styles.awaitingCard]}>
        <View style={[styles.targetHeader, awaitingTarget && styles.awaitingHeader]}>
          <Text style={[styles.targetKicker, awaitingTarget && styles.mutedKicker]}>+ YOUR TARGET</Text>
          {!!hunt.target?.proximity?.last_seen_at && (
            <Text style={[styles.signalAge, hunt.target.proximity.state === 'stale' && styles.amberText]}>{timeAgo(hunt.target.proximity.last_seen_at)}</Text>
          )}
        </View>
        <View style={styles.targetBody}>
          <Text style={[styles.targetName, awaitingTarget && styles.awaitingName]}>{hunt.target?.character_name ?? 'SIGNAL PENDING'}</Text>
          {awaitingTarget ? (
            <Text style={styles.bodyCopy}>Elimination confirmed. Waiting for the GM to assign your next target. No claim can start until then.</Text>
          ) : (
            <ProximitySignal proximity={hunt.target.proximity} />
          )}

          <TouchableOpacity disabled={disabled} onPress={requestElimination} style={[disabled ? styles.disabledClaimButton : styles.claimButton, busy && styles.disabled]}>
            <Text style={disabled ? styles.disabledButtonText : styles.filledButtonText}>
              {awaitingTarget ? 'AWAITING GM ASSIGNMENT' : claimPending ? 'WAITING FOR TARGET CONFIRMATION' : 'CLAIM ELIMINATION'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.claimCaption}>
            {claimPending ? 'TARGET RESPONSE PENDING' : 'CLAIM ONLY AFTER THE LIVE BATTLE IS RESOLVED\nYOUR TARGET MUST CONFIRM // YOU STAY ANONYMOUS'}
          </Text>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
        </View>
      </View>
      <Text style={styles.hunterWarning}>SOMEONE IS HUNTING YOU. THEIR NAME IS NEVER SHOWN.</Text>
    </ScrollView>
  )
}

function ProximitySignal({ proximity }) {
  if (!proximity || proximity.state === 'waiting_for_location') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalNeutral}>WAITING</Text>
        <Text style={styles.bodyCopy}>Waiting for both devices to report location.</Text>
      </View>
    )
  }

  if (proximity.state === 'stale') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalStale}>STALE</Text>
        <Text style={styles.bodyCopy}>Signal older than 2 minutes. Keep moving and try again.</Text>
      </View>
    )
  }

  if (proximity.state === 'cloaked') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalMasked}>MASKED</Text>
        <Text style={styles.bodyCopy}>Target signal hidden for about {remainingMinutes(proximity.available_at)} minute(s).</Text>
      </View>
    )
  }

  if (proximity.state !== 'available') {
    return <Text style={styles.bodyCopy}>Target signal unavailable.</Text>
  }

  const activeBand = String(proximity.band ?? '').toLowerCase()
  return (
    <View style={styles.signalAvailable}>
      <View style={styles.distanceRow}>
        <Text style={styles.bandWord}>{activeBand.toUpperCase()}</Text>
        <Text style={styles.distance}>~{Math.round(Number(proximity.distance_m) / 10) * 10} m</Text>
      </View>
      <View style={styles.meterRow}>
        {BANDS.map((band) => {
          const active = band === activeBand
          return (
            <View key={band} style={styles.meterItem}>
              <View style={[styles.meterBar, active && styles.meterBarActive]} />
              <Text style={[styles.meterLabel, active && styles.meterLabelActive]} numberOfLines={1}>{band.toUpperCase()}</Text>
            </View>
          )
        })}
      </View>
    </View>
  )
}

function FinishedState({ hunt }) {
  const won = hunt.winner?.is_self
  return (
    <View style={styles.centerState}>
      <View style={[styles.resultIcon, won ? styles.winnerIcon : styles.otherIcon]}>
        <Text style={[styles.resultIconText, { color: won ? C.cyan : C.muted }]}>{won ? '*' : 'O'}</Text>
      </View>
      <Text style={[styles.resultTitle, won && styles.winnerTitle]}>{won ? 'TIMELINE SECURED' : 'THE TIMELINE BELONGS TO ANOTHER'}</Text>
      <Text style={styles.resultCopy}><Text style={!won && styles.targetInline}>{hunt.winner?.character_name ?? 'The final traveller'}</Text> is the last traveller standing.</Text>
      <View style={[styles.resultChip, won && styles.winnerChip]}>
        <Text style={[styles.resultChipText, won && styles.winnerChipText]}>ROUND COMPLETE</Text>
      </View>
    </View>
  )
}

function EliminatedState({ aliveCount }) {
  return (
    <View style={styles.centerState}>
      <View style={styles.eliminatedIcon}><Text style={styles.eliminatedIconText}>X</Text></View>
      <Text style={styles.eliminatedTitle}>ELIMINATED</Text>
      <Text style={styles.resultCopy}>Location sharing has stopped. Your history is cleared and no target is revealed.</Text>
      <View style={styles.resultChip}><Text style={styles.resultChipText}>{aliveCount} TRAVELLERS REMAIN</Text></View>
      <Text style={styles.restoreNote}>THE GM CAN RESTORE YOU TO THE CHAIN</Text>
    </View>
  )
}

function EventsTab({ gameId, events }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      <PlayerMessageBox gameId={gameId} />
      {events.length === 0 && <Text style={styles.emptyText}>NO FIELD EVENTS // STAY ALERT</Text>}
      {events.map((event) => {
        const meta = eventMeta(event.type)
        const message = event.payload?.message || eventBody(event.type)
        return (
          <View key={event.id} style={[styles.eventCard, meta.borderColor && { borderColor: meta.borderColor }]}>
            <View style={styles.eventTopRow}>
              <Text style={[styles.eventTag, { color: meta.color }]}>{meta.label}</Text>
              <Text style={styles.eventTime}>{timeAgo(event.created_at)}</Text>
            </View>
            <Text style={[styles.eventTitle, meta.titleColor && { color: meta.titleColor }]}>{eventTitle(event.type)}</Text>
            {!!message && <Text style={styles.eventBody}>{message}</Text>}
          </View>
        )
      })}
    </ScrollView>
  )
}

function eventMeta(type) {
  if (type === 'zone_boundary_warning' || type === 'zone_boundary_exit') {
    return { label: 'BOUNDARY', color: C.amber, borderColor: C.amberBorder, titleColor: C.amber }
  }
  if (type === 'gm_note') return { label: 'GM NOTE', color: C.cyan, borderColor: C.cyanBorder }
  if (type === 'player_message') return { label: 'PLAYER MESSAGE', color: C.cyan, borderColor: C.cyanBorder }
  if (type === 'elimination_rejected' || type === 'eliminated') return { label: 'HUNT', color: C.red }
  if (type?.startsWith('elimination_')) return { label: 'HUNT', color: type === 'elimination_confirmed' ? C.green : C.amber }
  if (type?.startsWith('hunt_')) return { label: 'HUNT', color: C.green }
  return { label: 'FIELD EVENT', color: C.muted }
}

function eventTitle(type) {
  if (type === 'gm_note') return 'Message from your GM'
  if (type === 'consent_granted') return 'Location uplink enabled'
  if (type === 'consent_revoked') return 'Location uplink disabled'
  if (type === 'hunt_started') return 'The hunt has begun'
  if (type === 'elimination_requested') return 'Elimination confirmation requested'
  if (type === 'elimination_claimed') return 'Waiting for target confirmation'
  if (type === 'elimination_rejected') return 'Elimination claim rejected'
  if (type === 'elimination_confirmed') return 'Timeline correction confirmed'
  if (type === 'eliminated') return 'You have been eliminated'
  if (type === 'hunt_finished') return 'The hunt is over'
  if (type === 'hunt_player_restored') return 'The GM restored a traveller'
  if (type === 'hunt_chain_changed') return 'The GM corrected the target chain'
  if (type === 'hunt_target_assigned') return 'New target assigned'
  if (type === 'player_message') return 'Message sent to your GM'
  if (type === 'zone_boundary_warning') return 'Anomaly boundary ahead'
  if (type === 'zone_boundary_exit') return 'You left the time anomaly'
  return 'Field state changed'
}

function eventBody(type) {
  if (type === 'elimination_confirmed') return 'Wait for the GM to assign your next target. A 10-minute temporal cloak is active.'
  if (type === 'zone_boundary_warning') return 'Move back toward the safe interior.'
  if (type === 'zone_boundary_exit') return 'Any pending claim was forfeited and the GM was alerted.'
  return ''
}

function PlayerMessageBox({ gameId }) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const clean = message.trim()
    if (!clean) return
    setBusy(true); setStatus('')
    const { error } = await supabase.rpc('send_gm_message', { g: gameId, message: clean })
    setBusy(false)
    if (error) { setStatus(error.message); return }
    setMessage('')
    setStatus('Sent to the GM.')
  }

  const sendDisabled = busy || !message.trim()
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>Message the GM</Text>
      <TextInput
        style={[styles.input, styles.messageInput]}
        value={message}
        onChangeText={setMessage}
        maxLength={100}
        placeholder="Short in-game message"
        placeholderTextColor={C.lineStrong}
      />
      <View style={styles.messageFooter}>
        <Text style={styles.charCount}>{message.length}/100</Text>
        <TouchableOpacity disabled={sendDisabled} onPress={send} style={[styles.smallCyanButton, sendDisabled && styles.disabled]}>
          <Text style={styles.smallCyanButtonText}>{busy ? 'SENDING...' : 'SEND'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.privateCaption}>ONLY YOU AND THE GMS SEE THIS // 3s COOLDOWN</Text>
      {!!status && <Text style={[styles.messageStatus, { color: status === 'Sent to the GM.' ? C.green : C.red }]}>{status}</Text>}
    </View>
  )
}

function SharingTab({ game, phase, sharing, queue, error, toggleSharing, sendNow }) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      <View style={styles.neutralCard}>
        <View style={styles.sharingHeader}>
          <View style={styles.flex}>
            <Text style={styles.sharingTitle}>Location uplink</Text>
            <Text style={styles.sharingState}>{sharing ? 'TRANSMITTING' : 'OFFLINE'}</Text>
          </View>
          <Switch
            value={sharing}
            onValueChange={toggleSharing}
            trackColor={{ true: C.cyan, false: C.lineStrong }}
            thumbColor={sharing ? C.ink : C.muted}
          />
        </View>
        <Text style={styles.bodyCopy}>
          While enabled, your phone sends its position roughly every 15 seconds, including with the screen off. GMs see it on their map and a permanent notification stays visible.
        </Text>
        <Text style={[styles.bodyCopy, styles.sharingDetails]}>
          Position history is deleted automatically after {game.purge_after_days} day{game.purge_after_days === 1 ? '' : 's'}. You can stop at any time.
        </Text>
        {phase !== 'active' && <Text style={styles.warningCopy}>Pings are accepted only while the GM has made the game active.</Text>}
        {!!error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <View style={styles.telemetryCard}>
        <Text style={styles.telemetryKicker}>UPLINK TELEMETRY</Text>
        <View style={styles.telemetryRow}>
          <TelemetryCell label="QUEUED" value={queue.queued ?? 0} color={C.cyan} />
          <TelemetryCell label="LAST SENT" value={timeAgo(queue.lastSent).toUpperCase()} color={C.green} />
          <TelemetryCell label="GPS MODE" value={queue.profile === 'far' ? 'RELAXED' : 'PRECISE'} />
        </View>
        <GhostButton label="SEND NOW" onPress={sendNow} />
      </View>
      <Text style={styles.sharingFootnote}>SHARING STOPS AND LOCATION HISTORY IS DELETED ON ELIMINATION.</Text>
    </ScrollView>
  )
}

function TelemetryCell({ label, value, color = C.text }) {
  return (
    <View style={styles.telemetryCell}>
      <Text style={[styles.telemetryValue, { color }]} numberOfLines={1}>{String(value)}</Text>
      <Text style={styles.telemetryLabel}>{label}</Text>
    </View>
  )
}

function CharacterSheet({ character, stats }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const fields = character.fields ?? {}
  const editable = stats.filter((stat) => stat.player_editable)
  const locked = stats.filter((stat) => !stat.player_editable)
  const values = draft ?? {}
  const valueOf = (key) => key in values ? values[key] : fields[key]
  const dirty = draft && Object.keys(draft).some((key) => String(draft[key]) !== String(fields[key] ?? ''))

  async function save() {
    setError(''); setSaved(false)
    const next = { ...fields }
    for (const stat of editable) {
      if (!(stat.key in values)) continue
      next[stat.key] = stat.type === 'number' ? Number(values[stat.key]) : String(values[stat.key] ?? '')
      if (stat.type === 'number' && !Number.isFinite(next[stat.key])) next[stat.key] = stat.default ?? 0
    }
    const { error: saveError } = await supabase.from('characters').update({ fields: next }).eq('id', character.id)
    if (saveError) { setError(saveError.message); return }
    setDraft(null)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      <View style={styles.identityRow}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initials(character.name)}</Text></View>
        <View style={styles.flex}>
          <Text style={styles.characterName}>{character.name}</Text>
          {!!character.bio && <Text style={styles.characterBio}>{character.bio}</Text>}
        </View>
      </View>

      {locked.length > 0 && (
        <>
          <Text style={styles.sheetLabel}>SET BY YOUR GM // UPDATES LIVE</Text>
          <View style={styles.statGrid}>
            {locked.map((stat) => (
              <View key={stat.key} style={styles.statCard}>
                <Text style={[styles.statValue, { color: statColor(stat, fields[stat.key]) }]}>{String(fields[stat.key] ?? '--')}</Text>
                <Text style={styles.statLabel}>{String(stat.label || stat.key).toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {editable.length > 0 && (
        <View style={styles.editSection}>
          <Text style={styles.sheetLabel}>YOURS TO EDIT</Text>
          {editable.map((stat) => (
            <View key={stat.key} style={styles.field}>
              <Text style={styles.inputLabel}>{String(stat.label || stat.key).toUpperCase()}{stat.type === 'number' && stat.min !== undefined && stat.max !== undefined ? ` // ${stat.min}-${stat.max}` : ''}</Text>
              <TextInput
                style={styles.input}
                keyboardType={stat.type === 'number' ? 'numeric' : 'default'}
                value={String(valueOf(stat.key) ?? '')}
                onChangeText={(value) => setDraft({ ...(draft ?? {}), [stat.key]: value })}
              />
            </View>
          ))}
          <TouchableOpacity disabled={!dirty} onPress={save} style={[styles.cyanButton, !dirty && styles.disabled]}>
            <Text style={styles.filledButtonText}>SAVE CHANGES</Text>
          </TouchableOpacity>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          {saved && <Text style={styles.successText}>Changes synchronized.</Text>}
        </View>
      )}
    </ScrollView>
  )
}

function CreateCharacter({ game, uid, onCreated }) {
  const stats = game.template?.stats ?? []
  const editable = stats.filter((stat) => stat.player_editable)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [values, setValues] = useState(() => Object.fromEntries(editable.map((stat) => [stat.key, stat.default ?? (stat.type === 'number' ? 0 : '')])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) { setError('Your character needs a name.'); return }
    setBusy(true); setError('')
    const fields = {}
    for (const stat of editable) fields[stat.key] = stat.type === 'number' ? Number(values[stat.key]) || 0 : String(values[stat.key] ?? '')
    const { data, error: createError } = await supabase.from('characters')
      .insert({ game_id: game.id, user_id: uid, name: name.trim(), bio: bio.trim(), fields })
      .select().single()
    setBusy(false)
    if (createError) { setError(createError.message); return }
    onCreated(data)
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContent}>
      <View style={styles.neutralCard}>
        <Text style={styles.cyanKicker}>IDENTITY REGISTRY</Text>
        <Text style={styles.sectionTitle}>Create your character</Text>
        <Text style={styles.bodyCopy}>This is who you will be in {game.name}.</Text>
        <View style={styles.editSection}>
          <Field label="NAME" value={name} onChangeText={setName} placeholder="Agent name" />
          <Field label="BIO" value={bio} onChangeText={setBio} multiline placeholder="A short field record" style={styles.bioInput} />
          {editable.map((stat) => (
            <Field
              key={stat.key}
              label={String(stat.label || stat.key).toUpperCase()}
              keyboardType={stat.type === 'number' ? 'numeric' : 'default'}
              value={String(values[stat.key] ?? '')}
              onChangeText={(value) => setValues({ ...values, [stat.key]: value })}
            />
          ))}
          <TouchableOpacity disabled={busy} onPress={create} style={[styles.cyanButton, busy && styles.disabled]}>
            <Text style={styles.filledButtonText}>{busy ? 'CREATING...' : 'CREATE CHARACTER'}</Text>
          </TouchableOpacity>
          {!!error && <Text style={styles.errorText}>{error}</Text>}
          <Text style={styles.privateCaption}>GM-CONTROLLED STATS ARE ADDED AUTOMATICALLY.</Text>
        </View>
      </View>
    </ScrollView>
  )
}

function Field({ label, style, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput style={[styles.input, style]} placeholderTextColor={C.lineStrong} {...props} />
    </View>
  )
}

function GhostButton({ label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.ghostButton}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </TouchableOpacity>
  )
}

function initials(name) {
  return String(name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function statColor(stat, value) {
  const identity = `${stat.key} ${stat.label ?? ''}`.toLowerCase()
  if (identity.includes('paradox')) return C.amber
  if ((identity.includes('life') || identity.includes('health')) && Number(value) <= 1) return C.red
  return C.cyan
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: C.ink },
  loading: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: C.cyan, fontFamily: F.mono, fontSize: 10, letterSpacing: 1.8 },
  header: { minHeight: 55, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, backgroundColor: C.ink },
  backButton: { width: 35, alignItems: 'flex-start', paddingVertical: 8 },
  backText: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 20 },
  gameName: { flex: 1, color: C.text, fontFamily: F.displayBold, fontSize: 17, letterSpacing: 1.35 },
  phaseChip: { minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13, paddingHorizontal: 8, paddingVertical: 5 },
  phaseText: { fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.3 },
  liveDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  stateStrip: { minHeight: 57, flexDirection: 'row', backgroundColor: C.panel, borderTopColor: C.line, borderTopWidth: 1, borderBottomColor: C.line, borderBottomWidth: 1 },
  stateCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stateCellBorder: { borderLeftColor: C.line, borderLeftWidth: 1, borderRightColor: C.line, borderRightWidth: 1 },
  stateValue: { fontFamily: F.displayBold, fontSize: 16.5 },
  stateLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 7.5, letterSpacing: 0.85, marginTop: 2 },
  tabs: { minHeight: 47, flexDirection: 'row', borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.ink },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  activeTab: { borderBottomColor: C.cyan },
  tabText: { color: C.muted, fontFamily: F.displaySemiBold, fontSize: 11.5, letterSpacing: 0.45 },
  activeTabText: { color: C.text },
  scrollContent: { padding: 15, paddingBottom: 32 },
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  centerCopy: { color: C.muted, fontFamily: F.body, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 9 },
  neutralCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 17 },
  cyanKicker: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 9.5, letterSpacing: 1.65 },
  redKicker: { color: C.red, fontFamily: F.monoSemiBold, fontSize: 9.5, letterSpacing: 1.65 },
  amberKicker: { color: C.amber, fontFamily: F.monoSemiBold, fontSize: 9.5, letterSpacing: 1.5 },
  kickerRow: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 20, marginTop: 7 },
  bodyCopy: { color: C.muted, fontFamily: F.body, fontSize: 13, lineHeight: 20, marginTop: 7 },
  warningInset: { backgroundColor: 'rgba(255,176,32,0.08)', borderColor: C.amberBorder, borderWidth: 1, borderRadius: 6, padding: 11, marginTop: 14 },
  warningInsetText: { color: C.amber, fontFamily: F.bodyMedium, fontSize: 12.5, lineHeight: 18 },
  neutralIcon: { width: 60, height: 60, borderRadius: 30, borderColor: C.lineStrong, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  neutralIconText: { color: C.muted, fontFamily: F.displayBold, fontSize: 21 },
  claimAlert: { backgroundColor: C.panel, borderColor: C.red, borderWidth: 1, borderRadius: 10, padding: 15, marginBottom: 11 },
  claimTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 19, lineHeight: 24, marginTop: 7 },
  redButton: { backgroundColor: C.red, borderRadius: 6, alignItems: 'center', paddingVertical: 12, marginTop: 14 },
  boundaryBanner: { backgroundColor: 'rgba(255,176,32,0.08)', borderColor: C.amberBorder, borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 11 },
  boundaryCopy: { color: C.muted, fontFamily: F.body, fontSize: 12.5, lineHeight: 19, marginTop: 5 },
  cloakCard: { backgroundColor: C.panel, borderColor: C.cyanBorder, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 11 },
  cloakCopy: { color: C.muted, fontFamily: F.body, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  targetCard: { backgroundColor: C.panel, borderColor: C.orange, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  awaitingCard: { borderColor: C.line },
  targetHeader: { backgroundColor: 'rgba(255,122,51,0.10)', borderBottomColor: 'rgba(255,122,51,0.40)', borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  awaitingHeader: { backgroundColor: C.panel2, borderBottomColor: C.line },
  targetKicker: { flex: 1, color: C.orangeBright, fontFamily: F.monoSemiBold, fontSize: 9.5, letterSpacing: 1.7 },
  mutedKicker: { color: C.muted },
  signalAge: { color: C.muted, fontFamily: F.mono, fontSize: 9.5 },
  amberText: { color: C.amber },
  targetBody: { padding: 14 },
  targetName: { color: C.orangeBright, fontFamily: F.displayBold, fontSize: 24, letterSpacing: 0.35 },
  awaitingName: { color: C.muted },
  signalState: { marginTop: 11 },
  signalNeutral: { color: C.text, fontFamily: F.displayBold, fontSize: 22 },
  signalStale: { color: C.amber, fontFamily: F.displayBold, fontSize: 22 },
  signalMasked: { color: C.cyan, fontFamily: F.displayBold, fontSize: 22 },
  signalAvailable: { marginTop: 10 },
  distanceRow: { flexDirection: 'row', alignItems: 'baseline' },
  bandWord: { flex: 1, color: C.orangeBright, fontFamily: F.displayBold, fontSize: 29 },
  distance: { color: C.text, fontFamily: F.monoSemiBold, fontSize: 12.5 },
  meterRow: { flexDirection: 'row', gap: 5, marginTop: 12 },
  meterItem: { flex: 1, alignItems: 'center' },
  meterBar: { width: '100%', height: 5, borderRadius: 3, backgroundColor: C.line },
  meterBarActive: { backgroundColor: C.orange },
  meterLabel: { color: C.muted, fontFamily: F.mono, fontSize: 6.3, marginTop: 5 },
  meterLabelActive: { color: C.orangeBright, fontFamily: F.monoSemiBold },
  claimButton: { backgroundColor: C.orange, borderRadius: 6, alignItems: 'center', paddingVertical: 13, marginTop: 18 },
  disabledClaimButton: { backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: 6, alignItems: 'center', paddingVertical: 12, marginTop: 18 },
  cyanButton: { backgroundColor: C.cyan, borderRadius: 6, alignItems: 'center', paddingVertical: 13 },
  filledButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 13.5, letterSpacing: 1.05, textAlign: 'center' },
  disabledButtonText: { color: C.muted, fontFamily: F.displayBold, fontSize: 12.5, letterSpacing: 0.7, textAlign: 'center' },
  disabled: { opacity: 0.55 },
  claimCaption: { color: C.muted, fontFamily: F.mono, fontSize: 8.5, lineHeight: 14, letterSpacing: 0.35, textAlign: 'center', marginTop: 8 },
  hunterWarning: { color: C.muted, fontFamily: F.mono, fontSize: 8.5, lineHeight: 14, letterSpacing: 0.65, textAlign: 'center', marginTop: 13 },
  errorText: { color: C.red, fontFamily: F.bodyMedium, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  successText: { color: C.green, fontFamily: F.bodyMedium, fontSize: 12.5, marginTop: 9 },
  resultIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  winnerIcon: { borderColor: C.cyan },
  otherIcon: { borderColor: C.lineStrong },
  resultIconText: { fontFamily: F.displayBold, fontSize: 26 },
  resultTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 26, lineHeight: 31, textAlign: 'center' },
  winnerTitle: { color: C.cyan, fontSize: 30 },
  resultCopy: { color: C.muted, fontFamily: F.body, fontSize: 13.5, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  targetInline: { color: C.orangeBright, fontFamily: F.bodySemiBold },
  resultChip: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 7, marginTop: 18 },
  winnerChip: { borderColor: C.cyanBorder },
  resultChipText: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.25 },
  winnerChipText: { color: C.cyan },
  eliminatedIcon: { width: 64, height: 64, borderRadius: 32, borderColor: C.red, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  eliminatedIconText: { color: C.red, fontFamily: F.displayBold, fontSize: 24 },
  eliminatedTitle: { color: C.red, fontFamily: F.displayBold, fontSize: 30, letterSpacing: 1 },
  restoreNote: { color: C.muted, fontFamily: F.mono, fontSize: 8.5, letterSpacing: 1, marginTop: 17 },
  messageCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 13 },
  messageTitle: { color: C.text, fontFamily: F.bodyBold, fontSize: 14 },
  messageInput: { marginTop: 9 },
  messageFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  charCount: { flex: 1, color: C.muted, fontFamily: F.mono, fontSize: 9.5 },
  smallCyanButton: { backgroundColor: C.cyan, borderRadius: 5, paddingHorizontal: 17, paddingVertical: 8 },
  smallCyanButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 11.5, letterSpacing: 0.8 },
  privateCaption: { color: C.muted, fontFamily: F.mono, fontSize: 8, letterSpacing: 0.65, marginTop: 9 },
  messageStatus: { fontFamily: F.bodyMedium, fontSize: 12.5, marginTop: 8 },
  eventCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 9 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center' },
  eventTag: { flex: 1, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.35 },
  eventTime: { color: C.muted, fontFamily: F.mono, fontSize: 9.5 },
  eventTitle: { color: C.text, fontFamily: F.bodySemiBold, fontSize: 14, marginTop: 7 },
  eventBody: { color: C.muted, fontFamily: F.body, fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  emptyText: { color: C.muted, fontFamily: F.mono, fontSize: 9, letterSpacing: 1.2, textAlign: 'center', marginVertical: 28 },
  sharingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sharingTitle: { color: C.text, fontFamily: F.bodySemiBold, fontSize: 15 },
  sharingState: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.25, marginTop: 3 },
  sharingDetails: { marginTop: 9 },
  warningCopy: { color: C.amber, fontFamily: F.bodyMedium, fontSize: 12.5, lineHeight: 18, marginTop: 11 },
  telemetryCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 12 },
  telemetryKicker: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.5 },
  telemetryRow: { flexDirection: 'row', gap: 7, marginTop: 11 },
  telemetryCell: { flex: 1, minHeight: 57, backgroundColor: C.ink, borderColor: C.line, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  telemetryValue: { fontFamily: F.displayBold, fontSize: 12.5 },
  telemetryLabel: { color: C.muted, fontFamily: F.mono, fontSize: 7.5, letterSpacing: 0.75, marginTop: 3 },
  sharingFootnote: { color: C.muted, fontFamily: F.mono, fontSize: 8, lineHeight: 13, letterSpacing: 0.55, textAlign: 'center', marginTop: 14 },
  ghostButton: { borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, alignItems: 'center', paddingVertical: 11, marginTop: 14 },
  ghostButtonText: { color: C.text, fontFamily: F.displaySemiBold, fontSize: 12.5, letterSpacing: 0.85 },
  identityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: { width: 46, height: 46, borderRadius: 6, backgroundColor: C.panel, borderColor: C.cyanBorder, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  avatarText: { color: C.cyan, fontFamily: F.displayBold, fontSize: 17 },
  characterName: { color: C.text, fontFamily: F.displayBold, fontSize: 22 },
  characterBio: { color: C.muted, fontFamily: F.body, fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  sheetLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.35, marginBottom: 9 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: { minWidth: 94, flexGrow: 1, backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 8, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 13 },
  statValue: { fontFamily: F.displayBold, fontSize: 23 },
  statLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 8, letterSpacing: 0.9, marginTop: 3 },
  editSection: { marginTop: 22 },
  field: { marginBottom: 12 },
  inputLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.15, marginBottom: 5 },
  input: { backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, color: C.text, fontFamily: F.body, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10 },
  bioInput: { minHeight: 76, textAlignVertical: 'top' },
})
