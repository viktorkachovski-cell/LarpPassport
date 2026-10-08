import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { pirateRequestId } from '../lib/pirateRequestId'
import { CompassDial } from './CompassDial'
import { Kicker, Notice, Sheet, SheetTitle, TideButton } from './ui'

const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] ?? `#${n}`

function claimMessage(result) {
  if (!result) return ''
  if (result.status === 'ok') {
    const reward = result.reward === 'oath'
      ? `Oath word ${result.oath_index}: ${result.oath_word}.`
      : '+1 bearing shard.'
    const doubloons = result.doubloons > 0 ? ` +${result.doubloons} doubloons (solved ${ordinal(result.rank)}).` : ''
    return `Solved ${result.site_name}. ${reward}${doubloons}`
  }
  if (result.status === 'wrong') return `That answer did not open it. ${result.attempts_remaining} attempts remain.`
  if (result.status === 'locked_out') return 'Too many attempts. Wait two minutes before trying again.'
  if (result.status === 'already_claimed') {
    return result.claimed_by_name
      ? `${result.claimed_by_name} already solved this for your crew.`
      : 'Your crew has already claimed this site.'
  }
  if (result.status === 'not_captain') return 'Only your captain can read the compass.'
  if (result.status === 'stale') return 'Your location is stale. Send your position, then try again.'
  if (result.status === 'paused') return 'The tide has stopped. Wait for the GM to resume play.'
  if (result.status === 'no_site') return 'Check in at the marked site before claiming.'
  if (result.status === 'ambiguous') return 'You are inside overlapping sites. Ask the GM to check the map.'
  if (result.status === 'idempotency_conflict') return 'The answer changed during a retry. Try again.'
  if (result.status === 'no_shards') return 'The glass is broken: your crew needs a bearing shard first. Solve a bearing riddle.'
  if (result.status === 'wrong_phase') return 'Not open yet. Riddles open at charting; lighthouse readings once the curse wakes.'
  if (result.status === 'no_crew') return 'You are not in a crew yet. Ask the GM to put you in one.'
  if (result.status === 'not_ready') return 'The GM has not finished setting up this site or the treasure.'
  return `The site is unavailable (${result.status}).`
}

export function PiratePanel({ mode, state, error, gameId, refresh, sharing, checkSpot }) {
  const [answer, setAnswer] = useState('')
  const [outcome, setOutcome] = useState('')
  const [busy, setBusy] = useState(false)
  const [selectedReading, setSelectedReading] = useState(null)
  const pendingClaim = useRef(null)
  const readings = state?.readings ?? []
  const reading = readings.find((item) => item.taken_at === selectedReading) ?? readings[0]
  const site = state?.site_here
  const claimOpen = ['charting', 'cursed', 'hunt', 'hoard'].includes(state?.phase) && !state?.paused
  const compassOpen = ['cursed', 'hunt', 'hoard'].includes(state?.phase) && !state?.paused

  if (state && state.role !== 'player') {
    return <ScrollView contentContainerStyle={styles.root}>
      <Sheet>
        <SheetTitle>Pirate game</SheetTitle>
        <Text style={styles.body}>GM controls are available in the dashboard.</Text>
      </Sheet>
    </ScrollView>
  }

  async function claim() {
    if (busy || !claimOpen || !answer.trim()) return
    const key = pendingClaim.current?.answer === answer ? pendingClaim.current.id : pirateRequestId()
    pendingClaim.current = { answer, id: key }
    setBusy(true)
    setOutcome('')
    try {
      const { data, error: claimError } = await supabase.rpc('claim_site', {
        g: gameId, answer, idem: key,
      })
      if (claimError) throw claimError
      pendingClaim.current = null
      setOutcome(claimMessage(data))
      if (data?.status === 'ok') {
        setAnswer('')
        await refresh()
      }
    } catch (claimError) {
      setOutcome(`${claimError.message}. Tap again to retry this same request.`)
    } finally { setBusy(false) }
  }

  // Sends any queued positions, then asks the server which site this is.
  async function lookAround() {
    if (busy) return
    setBusy(true)
    setOutcome('')
    try {
      await checkSpot()
    } finally { setBusy(false) }
  }

  async function takeReading() {
    if (busy || !compassOpen) return
    setBusy(true)
    setOutcome('')
    try {
      const { data, error: readingError } = await supabase.rpc('compass_reading', { g: gameId })
      if (readingError) throw readingError
      if (data?.status === 'ok') {
        setSelectedReading(data.taken_at)
        setOutcome(`Reading recorded at ${data.lighthouse_name}.`)
        await refresh()
      } else setOutcome(claimMessage(data))
    } catch (readingError) { setOutcome(readingError.message) }
    finally { setBusy(false) }
  }

  const bandLabel = state?.band === '25' ? 'within 25 m' : state?.band === '100' ? 'within 100 m'
    : state?.band === 'far' ? 'farther than 100 m' : state?.band ?? 'locked'
  const claimDisabled = !claimOpen || busy || !answer.trim()

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      {!!error && <Notice tone="error" text={error} />}
      {!state && <Sheet><Text style={styles.body}>Loading the Pirate logbook…</Text></Sheet>}
      {state && <>
        <Text style={styles.crewName} accessibilityRole="header">{state.crew?.name ?? 'Pirate game'}</Text>
        <Sheet>
          {!!state.crew && <Text style={styles.body}>{state.is_captain
            ? 'You are the captain. You carry the compass.'
            : `Captain: ${state.crew.captain_name ?? 'not chosen yet'}. Only the captain reads the compass.`}</Text>}
          {state.paused && <Notice tone="warning" text="The tide has stopped. Player actions are paused." />}
          {mode === 'chart' ? <>
            <Kicker style={styles.section}>Current site</Kicker>
            <Text style={styles.siteName}>{site?.site_name ?? 'No marked site in range.'}</Text>
            {site?.status === 'ambiguous' && <Notice tone="warning" text={claimMessage(site)} />}
            {!site && <Text style={styles.muted}>Stand inside a marked site with location sharing on and wait a moment. Its riddle and the answer box appear here.</Text>}
            {!sharing && <Notice tone="warning" text="Location sharing is off. Turn it on in the SHARING tab, or the server cannot see you at a site." />}
            {state.phase === 'setup' && <Notice text="Riddles open when the GM starts charting." />}
            {!site?.prompt && checkSpot && <TideButton variant="ink" label={busy ? 'Checking…' : 'Check this spot'} disabled={busy} onPress={lookAround} />}
            {!!site?.reward && <Text style={styles.muted}>Reward: {site.reward === 'bearing' ? 'bearing shard' : 'oath word'}, plus doubloons by the order crews answer it (20 / 15 / 10 / 5 / 5).</Text>}
            {!!site?.prompt && <Text style={styles.prompt}>{site.prompt}</Text>}
            {site?.claimed_by_my_crew && <Notice tone="ok" text="Your crew has claimed this site." />}
            {site?.kind === 'riddle' && !site.claimed_by_my_crew && <>
              <Kicker>Your answer</Kicker>
              <TextInput style={styles.input} value={answer} onChangeText={setAnswer}
                placeholder="Enter the answer" placeholderTextColor={C.sheetMuted}
                accessibilityLabel="Site answer" autoCapitalize="none" autoCorrect={false} maxLength={100} />
              <TideButton label={busy ? 'Claiming…' : 'Claim for crew'} disabled={claimDisabled} onPress={claim} />
            </>}
            <View style={styles.rule} />
            <Kicker>Oath logbook</Kicker>
            {(state.oath ?? []).length === 0
              ? <Text style={styles.muted}>No words recovered yet.</Text>
              : state.oath.map((word) => (
                <View key={word.index} style={styles.ledgerRow}>
                  <Text style={styles.ledgerLabel}>Word {word.index}</Text>
                  <Text style={styles.ledgerValue}>{word.word}</Text>
                </View>
              ))}
          </> : <>
            <Kicker style={styles.section}>{reading ? `Reading at ${reading.lighthouse_name}` : 'True bearing'}</Kicker>
            <CompassDial reading={reading} active={mode === 'compass'} />
            <View style={styles.ledgerRow}>
              <Text style={styles.ledgerLabel}>Distance band</Text>
              <Text style={styles.ledgerValue}>{bandLabel}</Text>
            </View>
            <TideButton label={busy ? 'Reading…' : 'Take lighthouse reading'} disabled={!compassOpen || busy} onPress={takeReading} />
            <View style={styles.rule} />
            <Kicker>Logbook readings</Kicker>
            {readings.length === 0
              ? <Text style={styles.muted}>Reach a lighthouse after the curse wakes.</Text>
              : readings.map((item) => {
                const selected = item.taken_at === reading?.taken_at
                return (
                  <TouchableOpacity key={`${item.lighthouse_name}:${item.level}:${item.taken_at}`}
                    accessibilityRole="button" accessibilityState={{ selected }}
                    onPress={() => setSelectedReading(item.taken_at)} style={[styles.reading, selected && styles.readingSelected]}>
                    <Text style={styles.readingName}>{item.lighthouse_name}</Text>
                    <Text style={styles.muted}>{item.centre_deg}° ±{item.half_width_deg}° · {item.level} shards</Text>
                  </TouchableOpacity>
                )
              })}
          </>}
          {!!outcome && <Notice text={outcome} />}
        </Sheet>
      </>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { padding: S.pad, gap: 10, paddingBottom: 40 },
  crewName: { color: C.onWood, fontFamily: F.blackletter, fontSize: 34, lineHeight: 40, textShadowColor: C.woodSeam, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  section: { marginTop: 2 },
  siteName: { color: C.sheetInk, fontFamily: F.bodyBold, fontSize: 19, lineHeight: 25 },
  body: { color: C.sheetInk, fontFamily: F.body, fontSize: T.bodyLarge, lineHeight: T.lineBody },
  muted: { color: C.sheetMuted, fontFamily: F.body, fontSize: 15, lineHeight: 21 },
  prompt: { color: C.sheetInk, fontFamily: F.bodyMedium, fontStyle: 'italic', fontSize: 18, lineHeight: 26, marginVertical: 4 },
  input: { color: C.sheetInk, backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 1.5, borderRadius: 6,
    fontFamily: F.body, fontSize: 18, minHeight: S.touch, paddingHorizontal: 14 },
  rule: { height: 1, backgroundColor: C.sheetRule, marginVertical: 6 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 },
  ledgerLabel: { color: C.sheetInk, fontFamily: F.body, fontSize: 18, lineHeight: 25 },
  ledgerValue: { flexShrink: 1, color: C.sheetInk, fontFamily: F.bodyMedium, fontSize: 18, lineHeight: 25, textAlign: 'right' },
  reading: { minHeight: S.touch, justifyContent: 'center', borderColor: C.sheetMuted, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
  readingSelected: { backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 2 },
  readingName: { color: C.sheetInk, fontFamily: F.bodySemiBold, fontSize: 17, lineHeight: 22 },
})
