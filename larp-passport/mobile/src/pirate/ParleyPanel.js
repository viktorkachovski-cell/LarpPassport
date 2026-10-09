import { useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { mercyActive, parleyActions, REPORT_STATES } from '../lib/pirateParley'
import { pirateRequestId } from '../lib/pirateRequestId'
import { parleyTerms } from '../lib/pirateRules'
import { supabase } from '../lib/supabase'
import { C, F, S } from '../lib/theme'
import { useNow } from '../lib/useNow'
import { Kicker, Notice, SHEET_TEXT, Sheet, SheetTitle, TabPage, TideButton } from './ui'

const STATUS_TEXT = {
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

// What the player should do next, in words, for each Parley state.
const STEP_TEXT = {
  open: (active) => (active.can_act ? 'Show this code to the challenger in person.' : 'Waiting for the challenger to enter the code.'),
  joined: (active) => (active.role === 'target' ? 'Choose: Yield or Fight.' : 'Waiting for them to choose Yield or Fight.'),
  yielded: () => 'They yielded. Both players confirm the result before doubloons move.',
  fighting: () => 'Play rock-paper-scissors in person, then each player reports the winner.',
  awaiting_choice: () => 'The winner chooses the plunder.',
  disputed: () => 'Waiting for the GM to rule.',
}

const statusText = (result) => (result ? STATUS_TEXT[result.status] ?? `Parley status: ${result.status}` : '')
const reported = (done) => (data) => (data.state === 'resolved' ? `Both reports agree. ${done}` : 'Your report is saved.')

function ActionButton({ label, disabled, onPress, variant }) {
  return <TideButton label={label} disabled={disabled} onPress={onPress} variant={variant} style={styles.action} />
}

function ParleyStart({ canStart, busy, call }) {
  const [code, setCode] = useState('')
  const pendingJoin = useRef(null)
  const validCode = /^\d{4}$/.test(code)

  async function join() {
    if (!canStart || !validCode) return
    // A retry of the same code reuses its request ID, so the join lands once.
    const idem = pendingJoin.current?.code === code ? pendingJoin.current.id : pirateRequestId()
    pendingJoin.current = { code, id: idem }
    if (await call('join_parley', { code, idem }, 'Code accepted. They now choose Yield or Fight.')) pendingJoin.current = null
  }

  return <>
    <Kicker>You were challenged</Kicker>
    <ActionButton label="Show your code" disabled={!canStart || busy}
      onPress={() => call('open_parley', {}, (data) => `Show code ${data.code} to the challenger.`)} />
    <View style={styles.rule} />
    <Kicker>You are challenging</Kicker>
    <TextInput style={styles.input} value={code} onChangeText={setCode}
      accessibilityLabel="Parley code" keyboardType="number-pad" maxLength={4}
      placeholder="Their 4-digit code" placeholderTextColor={C.sheetMuted} />
    <ActionButton label="Enter code" variant="plank" disabled={!canStart || busy || !validCode} onPress={join} />
  </>
}

function ReportMoves({ active, ourFaction, busy, act }) {
  const opponent = active.opponent_name
  if (active.state === 'yielded') {
    return <View style={styles.row}>
      <ActionButton label={active.role === 'attacker' ? 'Confirm we won' : `Confirm ${opponent ?? 'they'} won`} disabled={busy}
        onPress={act('parley_report', { winner_faction: active.attacker_faction }, reported('Yield is resolved.'))} />
    </View>
  }
  const otherFaction = active.role === 'target' ? active.attacker_faction : active.target_faction
  return <View style={styles.row}>
    <ActionButton label="We won" variant="plank" disabled={busy}
      onPress={act('parley_report', { winner_faction: ourFaction }, reported('The fight is resolved.'))} />
    <ActionButton label={`${opponent ?? 'They'} won`} variant="plank" disabled={busy || !otherFaction}
      onPress={act('parley_report', { winner_faction: otherFaction }, reported('The fight is resolved.'))} />
  </View>
}

function Moves({ state, active, actions, busy, act }) {
  const percent = active.rules?.fight_percent ?? state.settings?.fight_percent ?? 25
  return <>
    {actions.canChoose && <View style={styles.row}>
      <ActionButton label="Yield" variant="plank" disabled={busy}
        onPress={act('parley_choice', { choice: 'yield' }, 'Yield recorded. Both players must confirm the outcome.')} />
      <ActionButton label="Fight" variant="blood" disabled={busy}
        onPress={act('parley_choice', { choice: 'fight' }, 'Fight recorded. Play the physical exchange.')} />
    </View>}
    {actions.canReport && <ReportMoves active={active} ourFaction={state.crew?.id} busy={busy} act={act} />}
    {actions.canPlunder && <View style={styles.row}>
      <ActionButton label="Take 1 shard" variant="plank" disabled={busy}
        onPress={act('parley_plunder', { currency: 'bearing' }, 'One bearing shard transferred.')} />
      <ActionButton label={`Take ${percent}% of doubloons`} variant="plank" disabled={busy}
        onPress={act('parley_plunder', { currency: 'doubloon' }, (data) => `${data.amount} doubloons transferred.`)} />
    </View>}
  </>
}

function ActiveParley({ active, now, ...moves }) {
  const act = (name, args, success) => () => moves.call(name, { parley_id: active.id, ...args }, success)
  const secondsLeft = active.code_expires_at
    ? Math.max(0, Math.ceil((new Date(active.code_expires_at).getTime() - now) / 1000)) : 0
  return <>
    <Kicker>Parley{active.opponent_name ? ` with ${active.opponent_name}` : ''}</Kicker>
    <Text style={styles.step}>{STEP_TEXT[active.state]?.(active) ?? ''}</Text>
    {active.far_apart && <Notice tone="warning" text="The players were far apart when this Parley began. The GM can review it." />}
    {!!active.code && <View style={styles.codeBox} accessibilityLabel={`Parley code ${active.code.split('').join(' ')}, ${secondsLeft} seconds left`}>
      <Text style={styles.code}>{active.code}</Text>
      <Text style={styles.muted}>{secondsLeft}s left</Text>
    </View>}
    {!active.can_act && <Text style={styles.body}>Only the two players who met in person make the choices.</Text>}
    {active.self_reported && REPORT_STATES.includes(active.state)
      && <Text style={styles.body}>Your report is saved. Waiting for the other player.</Text>}
    {active.state === 'disputed' && <Notice tone="warning" text="Reports disagree or the session timed out. The GM must rule." />}
    <Moves active={active} act={act} {...moves} />
  </>
}

export function ParleyPanel({ state, error, gameId, refresh }) {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState('')
  const active = state?.active_parley
  // Per-second ticks only while a code countdown is on screen; otherwise the
  // coarse tick is enough to lift an expired Davy's Mercy.
  const now = useNow(active?.code ? 1000 : 30000)
  const actions = parleyActions(state, now)

  // success: the message for an 'ok' result, or a function of its data.
  async function call(name, args, success) {
    if (busy) return null
    setBusy(true)
    setOutcome('')
    try {
      const { data, error: rpcError } = await supabase.rpc(name, { g: gameId, ...args })
      if (rpcError) throw rpcError
      if (data?.status === 'ok') setOutcome(typeof success === 'function' ? success(data) : success)
      else setOutcome(statusText(data))
      await refresh()
      return data
    } catch (rpcError) { setOutcome(rpcError.message); return null }
    finally { setBusy(false) }
  }

  return <TabPage error={error}>
    <Sheet>
      <SheetTitle>Parley</SheetTitle>
      <Text style={styles.muted}>Challenged in person? Show your code. Challenging someone? Enter their code. Stay within 75 m with location sharing on, then settle it with Yield or Fight.</Text>
      {!state && <Text style={styles.body}>Loading Parley…</Text>}
      {!!state && <>
        <Text style={styles.muted}>{parleyTerms(state)}{active ? ' These terms stay fixed for this Parley.' : ' Terms are fixed when a code opens.'}</Text>
        {mercyActive(state, now)
          && <Notice tone="warning" text={`Davy’s Mercy: no one can challenge your crew until ${new Date(state.mercy_until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`} />}
        {active
          ? <ActiveParley active={active} now={now} state={state} actions={actions} busy={busy} call={call} />
          : <ParleyStart canStart={actions.canStart} busy={busy} call={call} />}
        {!!outcome && <Notice text={outcome} />}
      </>}
    </Sheet>
  </TabPage>
}

const styles = StyleSheet.create({
  ...SHEET_TEXT,
  step: { color: C.sheetInk, fontFamily: F.bodyBold, fontSize: 19, lineHeight: 25 },
  input: { color: C.sheetInk, backgroundColor: C.sheetShade, borderColor: C.sheetInk, borderWidth: 1.5, borderRadius: 6,
    fontFamily: F.numeric, fontSize: 22, letterSpacing: 6, minHeight: S.touch, paddingHorizontal: 14 },
  codeBox: { alignItems: 'center', gap: 2, borderColor: C.sheetInk, borderWidth: 2, borderStyle: 'dashed', borderRadius: 6, paddingVertical: 12 },
  code: { color: C.sheetInk, fontFamily: F.numeric, fontSize: 44, lineHeight: 50, letterSpacing: 10, paddingLeft: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { flexGrow: 1 },
})
