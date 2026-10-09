import { MotionScrollView as ScrollView } from '../ui/presentation'
import { useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { parleyActions } from '../lib/pirateParley'
import { pirateRequestId } from '../lib/pirateRequestId'
import { parleyTerms } from '../lib/pirateRules'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { useNow } from '../lib/useNow'
import { Kicker, Notice, Sheet, SheetTitle, TideButton } from './ui'

function statusText(result) {
  if (!result) return ''
  const messages = {
    paused: 'The tide has stopped. Parley is paused.',
    pvp_disabled: 'The GM has closed Parley.',
    wrong_phase: 'Parley is closed during this phase.',
    stale: 'Your location is stale. Send a fresh fix.',
    target_stale: 'The other player needs a fresh location fix.',
    too_far: 'Move within 75 m of the other player, send fresh locations, then try again.',
    no_crew: 'Ask the GM to put you in a crew before starting a Parley.',
    already_reported: 'Your saved report cannot be changed. Ask the GM to rule.',
    treasure_exclusion: 'Parley is closed near the hoard.',
    target_treasure_exclusion: 'The other player is too near the hoard.',
    mercy: 'Davy’s Mercy protects this crew for now. No one can challenge them.',
    pair_cooldown: 'These crews must wait before another Parley.',
    hourly_limit: 'Your crew has reached the attacking limit for this window.',
    crew_busy: 'Your crew already has an active Parley.',
    invalid_code: 'That code has expired or is unavailable.',
    same_crew: 'A crew cannot Parley with itself.',
    wrong_state: 'The Parley has moved on. Pull down to refresh.',
    no_shards: 'The losing crew has no bearing shard to take.',
    disputed: 'The reports disagree. The GM must rule.',
    idempotency_conflict: 'This retry belongs to a different code.',
  }
  return messages[result.status] ?? `Parley status: ${result.status}`
}

// What the player should do next, in words, for each Parley state.
function stepText(active) {
  if (active.state === 'open') return active.can_act ? 'Show this code to the challenger in person.' : 'Waiting for the challenger to enter the code.'
  if (active.state === 'joined') return active.role === 'target' ? 'Choose: Yield or Fight.' : 'Waiting for them to choose Yield or Fight.'
  if (active.state === 'yielded') return 'They yielded. Both players confirm the result before doubloons move.'
  if (active.state === 'fighting') return 'Play rock-paper-scissors in person, then each player reports the winner.'
  if (active.state === 'awaiting_choice') return 'The winner chooses the plunder.'
  if (active.state === 'disputed') return 'Waiting for the GM to rule.'
  return ''
}

function ActionButton({ label, disabled, onPress, variant }) {
  return <TideButton label={label} disabled={disabled} onPress={onPress} variant={variant} style={styles.action} />
}

export function ParleyPanel({ state, error, gameId, refresh }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState('')
  const pendingJoin = useRef(null)
  const active = state?.active_parley
  // Per-second ticks only while a code countdown is on screen; otherwise the
  // coarse tick is enough to lift an expired Davy's Mercy.
  const now = useNow(active?.code ? 1000 : 30000)
  const actions = parleyActions(state, now)
  const secondsLeft = active?.code_expires_at
    ? Math.max(0, Math.ceil((new Date(active.code_expires_at).getTime() - now) / 1000)) : 0
  const ourFaction = state?.crew?.id
  const otherFaction = active?.role === 'target' ? active?.attacker_faction : active?.target_faction

  async function call(name, args, success) {
    if (busy) return null
    setBusy(true)
    setOutcome('')
    try {
      const { data, error: rpcError } = await supabase.rpc(name, { g: gameId, ...args })
      if (rpcError) throw rpcError
      setOutcome(data?.status === 'ok' ? success(data) : statusText(data))
      await refresh()
      return data
    } catch (rpcError) { setOutcome(rpcError.message); return null }
    finally { setBusy(false) }
  }

  async function join() {
    if (!actions.canJoin || !/^\d{4}$/.test(code)) return
    const idem = pendingJoin.current?.code === code ? pendingJoin.current.id : pirateRequestId()
    pendingJoin.current = { code, id: idem }
    const result = await call('join_parley', { code, idem }, () => 'Code accepted. They now choose Yield or Fight.')
    if (result) pendingJoin.current = null
  }

  return <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
    {!!error && <Notice tone="error" text={error} />}
    <Sheet>
      <SheetTitle>Parley</SheetTitle>
      <Text style={styles.muted}>Challenged in person? Show your code. Challenging someone? Enter their code. Stay within 75 m with location sharing on, then settle it with Yield or Fight.</Text>
      {!state && <Text style={styles.body}>Loading Parley…</Text>}
      {state && <>
        <Text style={styles.muted}>{parleyTerms(state)}{active ? ' These terms stay fixed for this Parley.' : ' Terms are fixed when a code opens.'}</Text>
        {state.mercy_until && new Date(state.mercy_until).getTime() > now
          && <Notice tone="warning" text={`Davy’s Mercy: no one can challenge your crew until ${new Date(state.mercy_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`} />}
        {!active && <>
          <Kicker>You were challenged</Kicker>
          <ActionButton label="Show your code" disabled={!actions.canOpen || busy}
            onPress={() => call('open_parley', {}, (data) => `Show code ${data.code} to the challenger.`)} />
          <View style={styles.rule} />
          <Kicker>You are challenging</Kicker>
          <TextInput style={styles.input} value={code} onChangeText={setCode}
            accessibilityLabel="Parley code" keyboardType="number-pad" maxLength={4}
            placeholder="Their 4-digit code" placeholderTextColor={C.sheetMuted} />
          <ActionButton label="Enter code" variant="plank" disabled={!actions.canJoin || busy || !/^\d{4}$/.test(code)} onPress={join} />
        </>}
        {active && <>
          <Kicker>Parley{active.opponent_name ? ` with ${active.opponent_name}` : ''}</Kicker>
          <Text style={styles.step}>{stepText(active)}</Text>
          {active.far_apart && <Notice tone="warning" text="The players were far apart when this Parley began. The GM can review it." />}
          {active.code && <View style={styles.codeBox} accessibilityLabel={`Parley code ${active.code.split('').join(' ')}, ${secondsLeft} seconds left`}>
            <Text style={styles.code}>{active.code}</Text>
            <Text style={styles.muted}>{secondsLeft}s left</Text>
          </View>}
          {!active.can_act && <Text style={styles.body}>Only the two players who met in person make the choices.</Text>}
          {active.self_reported && ['yielded', 'fighting'].includes(active.state)
            && <Text style={styles.body}>Your report is saved. Waiting for the other player.</Text>}
          {active.state === 'disputed' && <Notice tone="warning" text="Reports disagree or the session timed out. The GM must rule." />}
          {actions.canChoose && <View style={styles.row}>
            <ActionButton label="Yield" variant="plank" disabled={busy}
              onPress={() => call('parley_choice', { parley_id: active.id, choice: 'yield' }, () => 'Yield recorded. Both players must confirm the outcome.')} />
            <ActionButton label="Fight" variant="blood" disabled={busy}
              onPress={() => call('parley_choice', { parley_id: active.id, choice: 'fight' }, () => 'Fight recorded. Play the physical exchange.')} />
          </View>}
          {actions.canReport && active.state === 'yielded' && <View style={styles.row}>
            <ActionButton label={active.role === 'attacker' ? 'Confirm we won' : `Confirm ${active.opponent_name ?? 'they'} won`} disabled={busy}
              onPress={() => call('parley_report', { parley_id: active.id, winner_faction: active.attacker_faction },
                (data) => data.state === 'resolved' ? 'Both reports agree. Yield is resolved.' : 'Your report is saved.')} />
          </View>}
          {actions.canReport && active.state === 'fighting' && <View style={styles.row}>
            <ActionButton label="We won" variant="plank" disabled={busy}
              onPress={() => call('parley_report', { parley_id: active.id, winner_faction: ourFaction },
                (data) => data.state === 'resolved' ? 'Both reports agree. The fight is resolved.' : 'Your report is saved.')} />
            <ActionButton label={`${active.opponent_name ?? 'They'} won`} variant="plank" disabled={busy || !otherFaction}
              onPress={() => call('parley_report', { parley_id: active.id, winner_faction: otherFaction },
                (data) => data.state === 'resolved' ? 'Both reports agree. The fight is resolved.' : 'Your report is saved.')} />
          </View>}
          {actions.canPlunder && <View style={styles.row}>
            <ActionButton label="Take 1 shard" variant="plank" disabled={busy}
              onPress={() => call('parley_plunder', { parley_id: active.id, currency: 'bearing' }, () => 'One bearing shard transferred.')} />
            <ActionButton label={`Take ${active.rules?.fight_percent ?? state.settings?.fight_percent ?? 25}% of doubloons`} variant="plank" disabled={busy}
              onPress={() => call('parley_plunder', { parley_id: active.id, currency: 'doubloon' },
                (data) => `${data.amount} doubloons transferred.`)} />
          </View>}
        </>}
        {!!outcome && <Notice text={outcome} />}
      </>}
    </Sheet>
  </ScrollView>
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 16, paddingBottom: 40 },
  body: { color: C.sheetInk, fontFamily: F.body, fontSize: T.bodyLarge, lineHeight: T.lineBody },
  step: { color: C.sheetInk, fontFamily: F.bodyBold, fontSize: 19, lineHeight: 25 },
  muted: { color: C.sheetMuted, fontFamily: F.body, fontSize: 15, lineHeight: 21 },
  rule: { height: 1, backgroundColor: C.sheetRule, marginVertical: 6 },
  input: { color: C.sheetInk, backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 1.5, borderRadius: 10,
    fontFamily: F.numeric, fontSize: 22, letterSpacing: 6, minHeight: S.touch, paddingHorizontal: 16, paddingVertical: 12 },
  codeBox: { alignItems: 'center', gap: 8, borderColor: C.sheetInk, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 16 },
  code: { color: C.sheetInk, fontFamily: F.numeric, fontSize: 44, lineHeight: 50, letterSpacing: 10, paddingLeft: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1, flexShrink: 1, maxWidth: '100%' },
})
