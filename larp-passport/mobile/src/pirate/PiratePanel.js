import { useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { C, F, S } from '../lib/theme'
import { compassProgress } from '../lib/pirateCompass'
import { pirateRequestId } from '../lib/pirateRequestId'
import { riddleRewardText } from '../lib/pirateRules'
import { CompassDial } from './CompassDial'
import { claimClosedReason, claimsOpen, compassOpen, readingClosedReason } from './phases'
import { Kicker, Notice, SHEET_TEXT, Sheet, SheetTitle, TabPage, TideButton } from './ui'
import { TouchableOpacity } from '../ui/presentation'

const ordinal = (n) => ['first', 'second', 'third', 'fourth', 'fifth'][n - 1] ?? `#${n}`

const CLAIM_MESSAGES = {
  wrong: (r) => `That answer did not open it. ${r.attempts_remaining} attempts remain.`,
  locked_out: (r) => `Too many attempts. Wait ${r.remaining_seconds ?? 120} seconds before trying again.`,
  already_claimed: (r) => (r.claimed_by_name ? `${r.claimed_by_name} already solved this for your crew.` : 'Your crew has already claimed this site.'),
  not_captain: 'Only your captain can read the compass.',
  stale: 'We have lost your position. Send it now, then try again.',
  paused: 'The tide has stopped. Wait for the GM to resume play.',
  no_site: 'Stand inside a marked site for 20 seconds, then try again.',
  ambiguous: 'You are inside overlapping sites. Ask the GM to check the map.',
  idempotency_conflict: 'The answer changed during a retry. Try again.',
  no_shards: 'The glass is broken: your crew needs a bearing shard first. Solve a bearing riddle.',
  wrong_phase: 'Not open yet. Riddles open at Charting; lighthouse readings once the Curse wakes.',
  no_crew: 'You are not in a crew yet. Ask the GM to put you in one.',
  not_ready: 'The GM has not finished setting up this site or the treasure.',
}

function claimMessage(result) {
  if (!result) return ''
  if (result.status === 'ok') {
    const reward = result.reward === 'oath' ? `Oath word ${result.oath_index}: ${result.oath_word}.` : '+1 bearing shard.'
    const doubloons = result.doubloons > 0 ? ` +${result.doubloons} doubloons (solved ${ordinal(result.rank)}).` : ''
    return `Solved ${result.site_name}. ${reward}${doubloons}`
  }
  const message = CLAIM_MESSAGES[result.status] ?? `The site is unavailable (${result.status}).`
  return typeof message === 'function' ? message(result) : message
}

const BAND = { 25: 'Within 25 m', 100: 'Within 100 m', far: 'More than 100 m', stale: 'Needs a fresh position' }
const TONES = { ok: 'ok', error: 'error' }

function bandLabel(state) {
  if (BAND[state?.band]) return BAND[state.band]
  if ((state?.shards ?? 0) < 3) return 'Unlocks at 3 shards'
  if (state?.paused) return 'Paused'
  if (!compassOpen(state)) return 'Opens with the Curse'
  return 'Not available'
}

function SiteHere({ site, state, answer, setAnswer, busy, onClaim }) {
  const canClaim = claimsOpen(state)
  const reason = claimClosedReason(state)
  return <>
    <SheetTitle>{site.site_name}</SheetTitle>
    {!!site.reward && <Text style={styles.muted}>
      Prize: {site.reward === 'bearing' ? '1 bearing shard' : '1 oath word'} + doubloons ({riddleRewardText(state.settings)})
    </Text>}
    {!!site.prompt && <Text style={styles.prompt}>{site.prompt}</Text>}
    {site.claimed_by_my_crew && <Notice tone="ok" text="Your crew has solved this site." />}
    {site.kind === 'riddle' && !site.claimed_by_my_crew && <>
      <Kicker>Your answer</Kicker>
      <TextInput style={styles.input} value={answer} onChangeText={setAnswer}
        placeholder="Type the answer" placeholderTextColor={C.sheetMuted}
        accessibilityLabel="Site answer" autoCapitalize="none" autoCorrect={false} maxLength={100}
        onSubmitEditing={onClaim} returnKeyType="send" />
      <TideButton label={busy ? 'Checking…' : 'Submit answer'} disabled={!canClaim || busy || !answer.trim()} onPress={onClaim} />
      {!!reason && <Text style={styles.muted}>{reason}</Text>}
    </>}
  </>
}

function SitesSheet({ state, sharing, busy, onCheckSpot, ...claim }) {
  const site = state.site_here
  const reason = claimClosedReason(state)
  return <>
    <Kicker>Where you stand</Kicker>
    {!sharing && <Notice tone="warning" text="Location sharing is off. Tap GPS at the top and turn it on, or the server cannot see you at a site." />}
    {site?.status === 'ambiguous' && <Notice tone="warning" text={claimMessage(site)} />}
    {site?.site_name ? <SiteHere site={site} state={state} busy={busy} {...claim} /> : <>
      <SheetTitle>No site here</SheetTitle>
      <Text style={styles.body}>Walk to a marked site on your chart. Stay inside for 20 seconds with location sharing on and its riddle appears here.</Text>
      {!!reason && <Text style={styles.muted}>{reason}</Text>}
    </>}
    {!site?.prompt && !!onCheckSpot && <TideButton variant="ink" label={busy ? 'Checking…' : 'Check this spot'} disabled={busy} onPress={onCheckSpot} />}
  </>
}

function CompassSheet({ state, selected, onSelect, busy, onRead }) {
  const readings = state.readings ?? []
  const reading = readings.find((item) => item.taken_at === selected) ?? readings[0]
  const progress = compassProgress(state.shards)
  const reason = readingClosedReason(state)
  return <>
    <Kicker>{reading ? `Reading at ${reading.lighthouse_name}` : 'Your compass'}</Kicker>
    <CompassDial reading={reading} />
    <View style={styles.ledgerRow}>
      <Text style={styles.ledgerLabel}>Shards</Text>
      <Text style={styles.ledgerValue}>{progress.now ? `${progress.shards} · ±${progress.now}°` : `${progress.shards} · needle spins`}</Text>
    </View>
    {progress.next != null && <Text style={styles.muted}>One more shard narrows the arc to ±{progress.next}°.</Text>}
    <View style={styles.ledgerRow}>
      <Text style={styles.ledgerLabel}>Distance to the hoard</Text>
      <Text style={styles.ledgerValue}>{bandLabel(state)}</Text>
    </View>
    {!['hoard', 'recall', 'finished'].includes(state.phase) && <Text style={styles.muted}>The treasure ground is sealed until the Hoard surfaces.</Text>}
    <TideButton label={busy ? 'Reading…' : 'Take lighthouse reading'} disabled={!compassOpen(state) || busy} onPress={onRead} />
    {!!reason && <Text style={styles.muted}>{reason}</Text>}
    <View style={styles.rule} />
    <Kicker>Past readings</Kicker>
    {readings.length === 0
      ? <Text style={styles.muted}>Stand at a lighthouse after the Curse wakes and take a reading.</Text>
      : readings.map((item) => {
        const chosen = item.taken_at === reading?.taken_at
        return (
          <TouchableOpacity key={`${item.lighthouse_name}:${item.level}:${item.taken_at}`}
            accessibilityRole="button" accessibilityState={{ selected: chosen }}
            onPress={() => onSelect(item.taken_at)} style={[styles.reading, chosen && styles.readingSelected]}>
            <Text style={styles.readingName}>{item.lighthouse_name}</Text>
            <Text style={styles.muted}>{item.centre_deg}° ±{item.half_width_deg}° · {item.level} shards</Text>
          </TouchableOpacity>
        )
      })}
  </>
}

// Sites (mode 'sites') and the captain's Compass (mode 'compass'). One
// instance serves both tabs, so a typed answer survives switching between them.
export function PiratePanel({ mode, state, error, gameId, refresh, sharing, checkSpot }) {
  const [answer, setAnswer] = useState('')
  const [outcome, setOutcome] = useState({ text: '', status: '' })
  const [busy, setBusy] = useState(false)
  const [selectedReading, setSelectedReading] = useState(null)
  const pendingClaim = useRef(null)

  async function attempt(work) {
    setBusy(true)
    setOutcome({ text: '', status: '' })
    try { await work() } finally { setBusy(false) }
  }

  function claim() {
    if (busy || !claimsOpen(state) || !answer.trim()) return
    // A retry of the same answer reuses its request ID, so the claim lands once.
    const key = pendingClaim.current?.answer === answer ? pendingClaim.current.id : pirateRequestId()
    pendingClaim.current = { answer, id: key }
    attempt(async () => {
      try {
        const { data, error: claimError } = await supabase.rpc('claim_site', { g: gameId, answer, idem: key })
        if (claimError) throw claimError
        pendingClaim.current = null
        setOutcome({ text: claimMessage(data), status: data?.status ?? '' })
        if (data?.status === 'ok') {
          setAnswer('')
          await refresh()
        }
      } catch (claimError) {
        setOutcome({ text: `${claimError.message}. Tap again to retry this same request.`, status: 'error' })
      }
    })
  }

  // Sends any queued positions, then asks the server which site this is.
  function lookAround() {
    if (!busy && checkSpot) attempt(checkSpot)
  }

  function takeReading() {
    if (busy || !compassOpen(state)) return
    attempt(async () => {
      try {
        const { data, error: readingError } = await supabase.rpc('compass_reading', { g: gameId })
        if (readingError) throw readingError
        if (data?.status !== 'ok') { setOutcome({ text: claimMessage(data), status: data?.status ?? '' }); return }
        setSelectedReading(data.taken_at)
        setOutcome({ text: `Reading recorded at ${data.lighthouse_name}.`, status: 'ok' })
        await refresh()
      } catch (readingError) { setOutcome({ text: readingError.message, status: 'error' }) }
    })
  }

  return (
    <TabPage state={state} error={error}>
      {!state && <Sheet><Text style={styles.body}>Loading…</Text></Sheet>}
      {!!state && <Sheet>
        {mode === 'sites'
          ? <SitesSheet state={state} sharing={sharing} busy={busy} onCheckSpot={checkSpot && lookAround}
              answer={answer} setAnswer={setAnswer} onClaim={claim} />
          : <CompassSheet state={state} selected={selectedReading} onSelect={setSelectedReading} busy={busy} onRead={takeReading} />}
        {!!outcome.text && <Notice tone={TONES[outcome.status] ?? 'info'} text={outcome.text} />}
        {outcome.status === 'stale' && !!checkSpot
          && <TideButton label={busy ? 'Sending…' : 'Send my position'} variant="plank" disabled={busy} onPress={lookAround} />}
      </Sheet>}
    </TabPage>
  )
}

const styles = StyleSheet.create({
  ...SHEET_TEXT,
  prompt: { color: C.sheetInk, fontFamily: F.bodyMedium, fontStyle: 'italic', fontSize: 18, lineHeight: 26, marginVertical: 4 },
  input: { color: C.sheetInk, backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 1.5, borderRadius: 10,
    fontFamily: F.body, fontSize: 18, minHeight: S.touch, paddingHorizontal: 16, paddingVertical: 12 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  ledgerLabel: { flex: 1, color: C.sheetInk, fontFamily: F.body, fontSize: 18, lineHeight: 25 },
  ledgerValue: { flexShrink: 1, color: C.sheetInk, fontFamily: F.bodyMedium, fontSize: 18, lineHeight: 25, textAlign: 'right' },
  reading: { minHeight: S.touch, justifyContent: 'center', borderColor: C.sheetMuted, borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  readingSelected: { backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 1.5 },
  readingName: { color: C.sheetInk, fontFamily: F.bodySemiBold, fontSize: 17, lineHeight: 22 },
})
