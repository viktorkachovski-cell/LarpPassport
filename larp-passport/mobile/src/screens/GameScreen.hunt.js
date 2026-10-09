import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { eventInfo } from '../lib/events'
import { stopSharing } from '../lib/locationTask'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { countdown } from '../lib/time'
import { useNow } from '../lib/useNow'
import { GameFrame, StateCell } from './game/GameFrame'
import { HuntPanel } from './game/HuntPanel'
import { useGameRpc, useGameSession, useSyncLog } from './game/session'

// Only this text ticks; it stops in the background and when the cloak expires.
function Countdown({ to }) {
  const now = useNow(to ? 1000 : null, to)
  return <Text>{countdown(to, now)}</Text>
}

function getPlayerStatus(hunt) {
  if (!hunt || hunt.phase === 'not_started') return { value: 'STANDBY', color: C.amber }
  if (hunt.phase === 'finished' && hunt.winner?.is_self) return { value: 'WINNER', color: C.cyan }
  if (!hunt.participant) return { value: 'OBSERVER', color: C.muted }
  if (!hunt.alive) return { value: 'OUT', color: C.red }
  if (hunt.incoming_claim) return { value: 'CLAIMED', color: C.amber }
  return { value: 'ALIVE', color: C.green }
}

const MODE_TABS = [['hunt', 'HUNT']]
const PHASE_CHIPS = { active: ['ACTIVE', C.green], finished: ['FINISHED', C.muted] }

// The header follows the game row until the first hunt status arrives.
function huntHeader(hunt, game) {
  const phase = hunt?.phase ?? game?.status
  const [phaseLabel, phaseColor] = PHASE_CHIPS[phase] ?? ['DRAFT', C.amber]
  return { phase, phaseLabel, phaseColor }
}

// A boundary warning stays on screen for two minutes after the latest one.
function boundaryWarningActive(events, now) {
  const latest = events.find((event) => eventInfo(event.type).boundary)
  return latest?.type === 'zone_boundary_warning' && now - new Date(latest.created_at).getTime() < 120000
}

function HuntCells({ hunt }) {
  const status = getPlayerStatus(hunt)
  return <>
    <StateCell value={hunt?.alive_count ?? '--'} label={hunt?.phase === 'not_started' ? 'PLAYERS JOINED' : 'TRAVELLERS LEFT'} />
    <StateCell value={status.value} label="YOUR STATUS" color={status.color} bordered />
    <StateCell value={<Countdown to={hunt?.hidden_until} />} label="CLOAK LEFT" color={C.cyan} />
  </>
}

function DecisionBanner({ onOpen }) {
  return (
    <View style={styles.decisionBanner} accessibilityLiveRegion="polite">
      <Text style={styles.decisionText}>1 decision waiting: a hunter claims they defeated you.</Text>
      <TouchableOpacity accessibilityRole="button" onPress={onOpen} style={styles.decisionButton}>
        <Text style={styles.decisionButtonText}>OPEN HUNT</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function GameScreen({ gameId, session: auth, onBack }) {
  const syncLog = useSyncLog()
  const huntState = useGameRpc('get_hunt_status', gameId, syncLog)
  const { data: hunt, setData: setHunt, error: huntError, setError: setHuntError, load: loadHunt } = huntState
  const session = useGameSession({ gameId, uid: auth.user.id, syncLog, loadMode: loadHunt })
  const { sharing, setSharing } = session
  const [tab, setTab] = useState('hunt')
  const [huntBusy, setHuntBusy] = useState(false)
  const now = useNow(30000)

  // Elimination ends location sharing on this device too.
  useEffect(() => {
    if (!hunt?.participant || hunt.alive || !sharing) return
    stopSharing(gameId).then(() => setSharing(false)).catch(() => {})
  }, [gameId, hunt?.alive, hunt?.participant, sharing, setSharing])

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
  }, [gameId, loadHunt, setHuntError])

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
  }, [incomingClaimId, setHunt, setHuntError])

  return (
    <GameFrame
      session={session} onBack={onBack} tab={tab} setTab={setTab} modeTabs={MODE_TABS}
      {...huntHeader(hunt, session.game)} cells={<HuntCells hunt={hunt} />}
      banner={!!hunt?.incoming_claim && tab !== 'hunt' && <DecisionBanner onOpen={() => setTab('hunt')} />}
    >
      {tab === 'hunt' && (
        <HuntPanel
          hunt={hunt}
          hasCharacter={session.character !== null}
          busy={huntBusy}
          error={huntError}
          outcome={huntOutcome}
          dismissOutcome={() => setHuntOutcome('')}
          boundaryWarning={boundaryWarningActive(session.visibleEvents, now)}
          requestElimination={confirmEliminationRequest}
          respondToElimination={respondToElimination}
          refresh={session.refresh}
        />
      )}
    </GameFrame>
  )
}

const styles = StyleSheet.create({
  decisionBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,176,32,0.10)', borderTopColor: C.amberBorder, borderTopWidth: 1, borderBottomColor: C.amberBorder, borderBottomWidth: 1, paddingHorizontal: 13, paddingVertical: 8 },
  decisionText: { flex: 1, color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  decisionButton: { minHeight: S.touch, justifyContent: 'center', backgroundColor: C.amber, borderRadius: 6, paddingHorizontal: 12 },
  decisionButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 12.5, letterSpacing: 0.8 },
})
