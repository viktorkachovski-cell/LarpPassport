import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { compassProgress } from '../lib/pirateCompass'
import { pirateRequestId } from '../lib/pirateRequestId'
import { CompassDial } from './CompassDial'
import { claimClosedReason, claimsOpen, compassOpen, readingClosedReason } from './phases'
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
  if (result.status === 'stale') return 'We have lost your position. Send it now, then try again.'
  if (result.status === 'paused') return 'The tide has stopped. Wait for the GM to resume play.'
  if (result.status === 'no_site') return 'Stand inside a marked site for 20 seconds, then try again.'
  if (result.status === 'ambiguous') return 'You are inside overlapping sites. Ask the GM to check the map.'
  if (result.status === 'idempotency_conflict') return 'The answer changed during a retry. Try again.'
  if (result.status === 'no_shards') return 'The glass is broken: your crew needs a bearing shard first. Solve a bearing riddle.'
  if (result.status === 'wrong_phase') return 'Not open yet. Riddles open at Charting; lighthouse readings once the Curse wakes.'
  if (result.status === 'no_crew') return 'You are not in a crew yet. Ask the GM to put you in one.'
  if (result.status === 'not_ready') return 'The GM has not finished setting up this site or the treasure.'
  return `The site is unavailable (${result.status}).`
}

const BAND = { 25: 'Within 25 m', 100: 'Within 100 m', far: 'More than 100 m', stale: 'Needs a fresh position' }

function bandLabel(state) {
  if (BAND[state?.band]) return BAND[state.band]
  if ((state?.shards ?? 0) < 3) return 'Unlocks at 3 shards'
  if (state?.paused) return 'Paused'
  if (!compassOpen(state)) return 'Opens with the Curse'
  return 'Not available'
}

// Sites (mode 'sites') and the captain's Compass (mode 'compass').
export function PiratePanel({ mode, state, error, gameId, refresh, sharing, checkSpot }) {
  const [answer, setAnswer] = useState('')
  const [outcome, setOutcome] = useState({ text: '', status: '' })
  const [busy, setBusy] = useState(false)
  const [selectedReading, setSelectedReading] = useState(null)
  const pendingClaim = useRef(null)
  const readings = state?.readings ?? []
  const reading = readings.find((item) => item.taken_at === selectedReading) ?? readings[0]
  const site = state?.site_here
  const canClaim = claimsOpen(state)
  const canRead = compassOpen(state)

  if (state && state.role !== 'player') {
    return <ScrollView contentContainerStyle={styles.root}>
      <Sheet>
        <SheetTitle>Pirate game</SheetTitle>
        <Text style={styles.body}>GM controls are available in the dashboard.</Text>
      </Sheet>
    </ScrollView>
  }

  async function claim() {
    if (busy || !canClaim || !answer.trim()) return
    const key = pendingClaim.current?.answer === answer ? pendingClaim.current.id : pirateRequestId()
    pendingClaim.current = { answer, id: key }
    setBusy(true)
    setOutcome({ text: '', status: '' })
    try {
      const { data, error: claimError } = await supabase.rpc('claim_site', {
        g: gameId, answer, idem: key,
      })
      if (claimError) throw claimError
      pendingClaim.current = null
      setOutcome({ text: claimMessage(data), status: data?.status ?? '' })
      if (data?.status === 'ok') {
        setAnswer('')
        await refresh()
      }
    } catch (claimError) {
      setOutcome({ text: `${claimError.message}. Tap again to retry this same request.`, status: 'error' })
    } finally { setBusy(false) }
  }

  // Sends any queued positions, then asks the server which site this is.
  async function lookAround() {
    if (busy || !checkSpot) return
    setBusy(true)
    setOutcome({ text: '', status: '' })
    try {
      await checkSpot()
    } finally { setBusy(false) }
  }

  async function takeReading() {
    if (busy || !canRead) return
    setBusy(true)
    setOutcome({ text: '', status: '' })
    try {
      const { data, error: readingError } = await supabase.rpc('compass_reading', { g: gameId })
      if (readingError) throw readingError
      if (data?.status === 'ok') {
        setSelectedReading(data.taken_at)
        setOutcome({ text: `Reading recorded at ${data.lighthouse_name}.`, status: 'ok' })
        await refresh()
      } else setOutcome({ text: claimMessage(data), status: data?.status ?? '' })
    } catch (readingError) { setOutcome({ text: readingError.message, status: 'error' }) }
    finally { setBusy(false) }
  }

  const claimReason = claimClosedReason(state)
  const readReason = readingClosedReason(state)
  const progress = compassProgress(state?.shards)
  const tone = outcome.status === 'ok' ? 'ok' : outcome.status === 'error' ? 'error' : 'info'

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      {!!error && <Notice tone="error" text={error} />}
      {!state && <Sheet><Text style={styles.body}>Loading…</Text></Sheet>}
      {state && <Sheet>
        {mode === 'sites' ? <>
          <Kicker>Where you stand</Kicker>
          {!sharing && <Notice tone="warning" text="Location sharing is off. Tap GPS at the top and turn it on, or the server cannot see you at a site." />}
          {site?.status === 'ambiguous' && <Notice tone="warning" text={claimMessage(site)} />}
          {site?.site_name ? <>
            <SheetTitle>{site.site_name}</SheetTitle>
            {!!site.reward && <Text style={styles.muted}>
              Prize: {site.reward === 'bearing' ? '1 bearing shard' : '1 oath word'} + doubloons (20 if your crew is first, then 15, 10, and 5 for every later crew)
            </Text>}
            {!!site.prompt && <Text style={styles.prompt}>{site.prompt}</Text>}
            {site.claimed_by_my_crew && <Notice tone="ok" text="Your crew has solved this site." />}
            {site.kind === 'riddle' && !site.claimed_by_my_crew && <>
              <Kicker>Your answer</Kicker>
              <TextInput style={styles.input} value={answer} onChangeText={setAnswer}
                placeholder="Type the answer" placeholderTextColor={C.sheetMuted}
                accessibilityLabel="Site answer" autoCapitalize="none" autoCorrect={false} maxLength={100}
                onSubmitEditing={claim} returnKeyType="send" />
              <TideButton label={busy ? 'Checking…' : 'Submit answer'} disabled={!canClaim || busy || !answer.trim()} onPress={claim} />
              {!!claimReason && <Text style={styles.muted}>{claimReason}</Text>}
            </>}
          </> : <>
            <SheetTitle>No site here</SheetTitle>
            <Text style={styles.body}>Walk to a marked site on your chart. Stay inside for 20 seconds with location sharing on and its riddle appears here.</Text>
            {!!claimReason && <Text style={styles.muted}>{claimReason}</Text>}
          </>}
          {!site?.prompt && !!checkSpot && <TideButton variant="ink" label={busy ? 'Checking…' : 'Check this spot'} disabled={busy} onPress={lookAround} />}
        </> : <>
          <Kicker>{reading ? `Reading at ${reading.lighthouse_name}` : 'Your compass'}</Kicker>
          <CompassDial reading={reading} active={mode === 'compass'} />
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Shards</Text>
            <Text style={styles.ledgerValue}>{progress.now ? `${progress.shards} · ±${progress.now}°` : `${progress.shards} · needle spins`}</Text>
          </View>
          {progress.next != null && <Text style={styles.muted}>One more shard narrows the arc to ±{progress.next}°.</Text>}
          <View style={styles.ledgerRow}>
            <Text style={styles.ledgerLabel}>Distance to the hoard</Text>
            <Text style={styles.ledgerValue}>{bandLabel(state)}</Text>
          </View>
          {state.phase !== 'hoard' && state.phase !== 'recall' && state.phase !== 'finished'
            && <Text style={styles.muted}>The treasure ground is sealed until the Hoard surfaces.</Text>}
          <TideButton label={busy ? 'Reading…' : 'Take lighthouse reading'} disabled={!canRead || busy} onPress={takeReading} />
          {!!readReason && <Text style={styles.muted}>{readReason}</Text>}
          <View style={styles.rule} />
          <Kicker>Past readings</Kicker>
          {readings.length === 0
            ? <Text style={styles.muted}>Stand at a lighthouse after the Curse wakes and take a reading.</Text>
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
        {!!outcome.text && <Notice tone={tone} text={outcome.text} />}
        {outcome.status === 'stale' && !!checkSpot
          && <TideButton label={busy ? 'Sending…' : 'Send my position'} variant="plank" disabled={busy} onPress={lookAround} />}
      </Sheet>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { padding: S.pad, gap: 10, paddingBottom: 40 },
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
