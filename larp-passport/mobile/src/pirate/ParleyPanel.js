import { useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { parleyActions } from '../lib/pirateParley'
import { pirateRequestId } from '../lib/pirateRequestId'
import { supabase } from '../lib/supabase'
import { C, F, S, T } from '../lib/theme'
import { useNow } from '../lib/useNow'

function statusText(result) {
  if (!result) return ''
  const messages = {
    paused: 'The tide has stopped. Parley is paused.',
    pvp_disabled: 'The GM has closed Parley.',
    wrong_phase: 'Parley is closed during this phase.',
    stale: 'Your location is stale. Send a fresh fix.',
    target_stale: 'The other player needs a fresh location fix.',
    safe_harbour: 'Parley is not allowed inside a Safe Harbour.',
    target_safe_harbour: 'The other player is inside a Safe Harbour.',
    treasure_exclusion: 'Parley is closed near the hoard.',
    target_treasure_exclusion: 'The other player is too near the hoard.',
    mercy: 'Davy’s Mercy protects this crew for now.',
    pair_cooldown: 'These crews must wait before another Parley.',
    hourly_limit: 'Your crew has used its three Parleys this hour.',
    crew_busy: 'Your crew already has an active Parley.',
    invalid_code: 'That code has expired or is unavailable.',
    same_crew: 'A crew cannot Parley with itself.',
    wrong_state: 'The Parley has moved on. Refresh the logbook.',
    no_shards: 'The losing crew has no bearing shard to take.',
    disputed: 'The reports disagree. The GM must rule.',
    idempotency_conflict: 'This retry belongs to a different code.',
  }
  return messages[result.status] ?? `Parley status: ${result.status}`
}

function ActionButton({ label, disabled, onPress }) {
  return <TouchableOpacity accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[styles.button, disabled && styles.disabled]}>
    <Text style={styles.buttonText}>{label}</Text>
  </TouchableOpacity>
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
    const result = await call('join_parley', { code, idem }, () => 'Joined. Wait for the target player to choose Yield or Fight.')
    if (result) pendingJoin.current = null
  }

  return <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
    <Text style={styles.heading}>PARLEY</Text>
    <Text style={styles.body}>The target shows a code. Both players confirm the result after the physical exchange.</Text>
    {!!error && <Text style={styles.error}>{error}</Text>}
    {!state && <Text style={styles.body}>Loading Parley…</Text>}
    {state && <>
      {state.mercy_until && new Date(state.mercy_until).getTime() > now
        && <Text style={styles.warning}>Davy’s Mercy protects your crew until {new Date(state.mercy_until).toLocaleTimeString()}.</Text>}
      {!active && <>
        <ActionButton label="OPEN PARLEY CODE" disabled={!actions.canOpen || busy}
          onPress={() => call('open_parley', {}, (data) => `Show code ${data.code} to the other player.`)} />
        <Text style={styles.caption}>JOIN ANOTHER CREW</Text>
        <TextInput style={styles.input} value={code} onChangeText={setCode}
          accessibilityLabel="Parley code" keyboardType="number-pad" maxLength={4}
          placeholder="Four digit code" placeholderTextColor={C.muted} />
        <ActionButton label="JOIN PARLEY" disabled={!actions.canJoin || busy || !/^\d{4}$/.test(code)} onPress={join} />
      </>}
      {active && <>
        <View style={styles.card}>
          <Text style={styles.caption}>CURRENT PARLEY · {active.state.toUpperCase()}</Text>
          {!!active.opponent_name && <Text style={styles.body}>Other crew: {active.opponent_name}</Text>}
          {active.far_apart && <Text style={styles.warning}>The players were far apart when this Parley began. The GM can review it.</Text>}
          {active.code && <Text style={styles.code} accessibilityLabel={`Parley code ${active.code}`}>
            {active.code} · {secondsLeft}s
          </Text>}
          {!active.can_act && <Text style={styles.body}>The two players in this Parley must handle its decisions.</Text>}
          {active.state === 'open' && active.can_act && <Text style={styles.body}>Show this code to the other player in person.</Text>}
          {active.state === 'joined' && active.role === 'attacker' && <Text style={styles.body}>Waiting for the target to choose Yield or Fight.</Text>}
          {active.state === 'yielded' && <Text style={styles.body}>Yield chosen. Both players must confirm that the attacker won before doubloons move.</Text>}
          {active.state === 'fighting' && <Text style={styles.body}>Play the physical rock-paper-scissors exchange, then each player reports the winner.</Text>}
          {active.self_reported && ['yielded', 'fighting'].includes(active.state)
            && <Text style={styles.body}>Your report is saved. Waiting for the other player.</Text>}
          {active.state === 'disputed' && <Text style={styles.warning}>Reports disagree or the session timed out. The GM must rule.</Text>}
        </View>
        {actions.canChoose && <View style={styles.row}>
          <ActionButton label="YIELD" disabled={busy}
            onPress={() => call('parley_choice', { parley_id: active.id, choice: 'yield' }, () => 'Yield recorded. Both players must confirm the outcome.')} />
          <ActionButton label="FIGHT" disabled={busy}
            onPress={() => call('parley_choice', { parley_id: active.id, choice: 'fight' }, () => 'Fight recorded. Play the physical exchange.')} />
        </View>}
        {actions.canReport && active.state === 'yielded' && <View style={styles.row}>
          <ActionButton label="CONFIRM ATTACKER WON" disabled={busy}
            onPress={() => call('parley_report', { parley_id: active.id, winner_faction: active.attacker_faction },
              (data) => data.state === 'resolved' ? 'Both reports agree. Yield is resolved.' : 'Your report is saved.')} />
        </View>}
        {actions.canReport && active.state === 'fighting' && <View style={styles.row}>
          <ActionButton label="OUR CREW WON" disabled={busy}
            onPress={() => call('parley_report', { parley_id: active.id, winner_faction: ourFaction },
              (data) => data.state === 'resolved' ? 'Both reports agree. The fight is resolved.' : 'Your report is saved.')} />
          <ActionButton label="OTHER CREW WON" disabled={busy || !otherFaction}
            onPress={() => call('parley_report', { parley_id: active.id, winner_faction: otherFaction },
              (data) => data.state === 'resolved' ? 'Both reports agree. The fight is resolved.' : 'Your report is saved.')} />
        </View>}
        {actions.canPlunder && <View style={styles.row}>
          <ActionButton label="TAKE ONE SHARD" disabled={busy}
            onPress={() => call('parley_plunder', { parley_id: active.id, currency: 'bearing' }, () => 'One bearing shard transferred.')} />
          <ActionButton label="TAKE DOUBLOONS" disabled={busy}
            onPress={() => call('parley_plunder', { parley_id: active.id, currency: 'doubloon' },
              (data) => `${data.amount} doubloons transferred.`)} />
        </View>}
      </>}
      {!!outcome && <Text style={styles.outcome} accessibilityLiveRegion="polite">{outcome}</Text>}
    </>}
  </ScrollView>
}

const styles = StyleSheet.create({
  root: { padding: S.pad, gap: S.gap, paddingBottom: 40 },
  heading: { color: C.text, fontFamily: F.displayBold, fontSize: T.title },
  caption: { color: C.amber, fontFamily: F.monoMedium, fontSize: T.label },
  body: { color: C.text, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody },
  warning: { color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  error: { color: C.red, fontFamily: F.body, fontSize: T.body },
  outcome: { color: C.cyan, fontFamily: F.bodyMedium, fontSize: T.body, marginTop: 12 },
  card: { backgroundColor: C.panel, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  code: { color: C.amber, fontFamily: F.monoMedium, fontSize: T.hero, textAlign: 'center', paddingVertical: 10 },
  input: { color: C.text, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6,
    fontFamily: F.mono, fontSize: T.bodyLarge, minHeight: S.touch, paddingHorizontal: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minHeight: S.touch, backgroundColor: C.amber, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, flexGrow: 1 },
  buttonText: { color: C.ink, fontFamily: F.displayBold, fontSize: T.button },
  disabled: { opacity: 0.5 },
})
