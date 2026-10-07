import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { pirateRequestId } from '../lib/pirateRequestId'
import { CompassDial } from './CompassDial'

function claimMessage(result) {
  if (!result) return ''
  if (result.status === 'ok' && result.reward === 'oath') {
    return `Oath word ${result.oath_index}: ${result.oath_word}`
  }
  if (result.status === 'ok') {
    return `Claimed ${result.site_name}. +${result.amount} ${result.reward === 'bearing' ? 'bearing shard' : 'doubloons'}.`
  }
  if (result.status === 'wrong') return `That answer did not open it. ${result.attempts_remaining} attempts remain.`
  if (result.status === 'locked_out') return 'Too many attempts. Wait two minutes before trying again.'
  if (result.status === 'already_claimed') return 'Your crew has already claimed this site.'
  if (result.status === 'stale') return 'Your location is stale. Send your position, then try again.'
  if (result.status === 'paused') return 'The tide has stopped. Wait for the GM to resume play.'
  if (result.status === 'no_site') return 'Check in at the marked site before claiming.'
  if (result.status === 'ambiguous') return 'You are inside overlapping sites. Ask the GM to check the map.'
  if (result.status === 'idempotency_conflict') return 'The answer changed during a retry. Try again.'
  return `The site is unavailable (${result.status}).`
}

export function PiratePanel({ mode, state, error, gameId, refresh }) {
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
      <Text style={styles.heading}>PIRATE GAME</Text>
      <Text style={styles.body}>GM controls are available in the dashboard.</Text>
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

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      {!state && <Text style={styles.body}>Loading the Pirate logbook…</Text>}
      {state && <>
        <Text style={styles.heading}>{state.crew?.name ?? 'PIRATE GAME'}</Text>
        {state.paused && <Text style={styles.warning}>The tide has stopped. Player actions are paused.</Text>}
        {mode === 'chart' ? <>
          <Text style={styles.caption}>CURRENT SITE</Text>
          <Text style={styles.body}>{site?.site_name ?? 'No marked site in range.'}</Text>
          {!!site?.reward && <Text style={styles.body}>Reward: {site.reward === 'bearing' ? 'bearing shard' : 'oath word'}</Text>}
          {!!site?.prompt && <Text style={styles.prompt}>{site.prompt}</Text>}
          {site?.claimed_by_my_crew && <Text style={styles.warning}>Your crew has claimed this site.</Text>}
          {site && ['riddle', 'cache'].includes(site.kind) && !site.claimed_by_my_crew && <>
            <TextInput style={styles.input} value={answer} onChangeText={setAnswer}
              placeholder="Enter the answer" placeholderTextColor={C.muted}
              accessibilityLabel="Site answer" autoCapitalize="none" autoCorrect={false} maxLength={100} />
            <TouchableOpacity accessibilityRole="button" disabled={!claimOpen || busy || !answer.trim()}
              onPress={claim} style={[styles.button, (!claimOpen || busy || !answer.trim()) && styles.disabled]}>
              <Text style={styles.buttonText}>{busy ? 'CLAIMING…' : 'CLAIM FOR CREW'}</Text>
            </TouchableOpacity>
          </>}
          <Text style={styles.caption}>OATH LOGBOOK</Text>
          {(state.oath ?? []).length === 0
            ? <Text style={styles.body}>No words recovered yet.</Text>
            : state.oath.map((word) => <Text key={word.index} style={styles.body}>{word.index}. {word.word}</Text>)}
        </> : <>
          <Text style={styles.caption}>TRUE BEARING</Text>
          <CompassDial reading={reading} active={mode === 'compass'} />
          <Text style={styles.body}>Distance band: {state.band === '25' ? 'within 25 m' : state.band === '100' ? 'within 100 m' : state.band === 'far' ? 'farther than 100 m' : state.band ?? 'locked'}</Text>
          <TouchableOpacity accessibilityRole="button" disabled={!compassOpen || busy}
            onPress={takeReading} style={[styles.button, (!compassOpen || busy) && styles.disabled]}>
            <Text style={styles.buttonText}>{busy ? 'READING…' : 'TAKE LIGHTHOUSE READING'}</Text>
          </TouchableOpacity>
          <Text style={styles.caption}>LOGBOOK READINGS</Text>
          {readings.length === 0
            ? <Text style={styles.body}>Reach a lighthouse after the curse wakes.</Text>
            : readings.map((item) => (
              <TouchableOpacity key={`${item.lighthouse_name}:${item.level}:${item.taken_at}`}
                accessibilityRole="button" onPress={() => setSelectedReading(item.taken_at)} style={styles.reading}>
                <Text style={styles.body}>{item.lighthouse_name} · {item.centre_deg}° ±{item.half_width_deg}° · {item.level} shards</Text>
              </TouchableOpacity>
            ))}
        </>}
        {!!outcome && <Text style={styles.outcome} accessibilityLiveRegion="polite">{outcome}</Text>}
      </>}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { padding: S.pad, gap: S.gap, paddingBottom: 40 },
  heading: { color: C.text, fontFamily: F.displayBold, fontSize: T.title },
  caption: { color: C.amber, fontFamily: F.monoMedium, fontSize: T.label, marginTop: 12 },
  body: { color: C.text, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody },
  prompt: { color: C.text, fontFamily: F.bodySemiBold, fontSize: T.bodyLarge, lineHeight: T.lineBody, marginVertical: 8 },
  input: { color: C.text, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6,
    fontFamily: F.body, fontSize: T.bodyLarge, minHeight: S.touch, paddingHorizontal: 12 },
  button: { minHeight: S.touch, backgroundColor: C.amber, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  disabled: { opacity: 0.5 },
  buttonText: { color: C.ink, fontFamily: F.displayBold, fontSize: T.button },
  warning: { color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body },
  error: { color: C.red, fontFamily: F.body, fontSize: T.body },
  outcome: { color: C.cyan, fontFamily: F.bodyMedium, fontSize: T.body, marginTop: 12 },
  reading: { borderColor: C.line, borderWidth: 1, borderRadius: 6, padding: 10 },
})
