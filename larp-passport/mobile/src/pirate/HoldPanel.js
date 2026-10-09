import { StyleSheet, Text, View } from 'react-native'
import { C, F } from '../lib/theme'
import { CharacterSheet, CreateCharacter } from '../screens/game/CharacterTab'
import { DoubloonIcon, Kicker, SHEET_TEXT, ShardIcon, Sheet, TabPage } from './ui'

// Every game has four oath words, one per oath site (game guide, section 3).
const OATH_SLOTS = [1, 2, 3, 4]

function CrewPurse({ state }) {
  const words = new Map((state.oath ?? []).map((word) => [word.index, word.word]))
  const captain = state.is_captain
    ? 'You are the captain. You carry the compass.'
    : `${state.crew?.captain_name ?? 'Your captain (not chosen yet)'} carries the compass. Ask them for bearings.`
  return <>
    <Text style={styles.crewName} accessibilityRole="header">{state.crew?.name ?? 'No crew yet'}</Text>
    <Sheet>
      <Text style={styles.body}>{state.crew ? captain : 'The GM has not put you in a crew yet.'}</Text>

      <View style={styles.rule} />
      <Kicker>Crew purse</Kicker>
      <View style={styles.ledgerRow}>
        <View style={styles.ledgerName}><ShardIcon /><Text style={styles.ledgerLabel}>Bearing shards</Text></View>
        <Text style={styles.ledgerValue}>{state.shards ?? 0}</Text>
      </View>
      <View style={styles.ledgerRow}>
        <View style={styles.ledgerName}><DoubloonIcon /><Text style={styles.ledgerLabel}>Doubloons</Text></View>
        <Text style={styles.ledgerValue}>{state.doubloons ?? 0}</Text>
      </View>

      <View style={styles.rule} />
      <Kicker>Oath words · {words.size}/4</Kicker>
      {OATH_SLOTS.map((index) => (
        <View key={index} style={styles.ledgerRow} accessibilityLabel={`Oath word ${index}: ${words.get(index) ?? 'missing'}`}>
          <Text style={styles.ledgerLabel}>Word {index}</Text>
          <Text style={[styles.ledgerValue, !words.has(index) && styles.missing]}>{words.get(index) ?? '—'}</Text>
        </View>
      ))}
      {words.size < 4 && <Text style={styles.muted}>Solve oath sites or trade with other crews. The Truce is a good time to trade.</Text>}
    </Sheet>
  </>
}

// The Hold: what the crew owns and who carries the compass, then the
// player's own pirate.
export function HoldPanel({ state, error, session }) {
  const { game, character } = session
  return (
    <TabPage state={state} error={error}>
      {!state && <Sheet><Text style={styles.body}>Loading…</Text></Sheet>}
      {!!state && <CrewPurse state={state} />}
      {game && character !== undefined && (
        <View style={styles.pirate}>
          {character === null
            ? <CreateCharacter game={game} uid={session.uid} onCreated={session.setCharacter} embedded />
            : <CharacterSheet character={character} stats={game.template?.stats ?? []} embedded />}
        </View>
      )}
    </TabPage>
  )
}

const styles = StyleSheet.create({
  ...SHEET_TEXT,
  crewName: { color: C.onWood, fontFamily: F.blackletter, fontSize: 34, lineHeight: 40, textShadowColor: C.woodSeam, textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 0 },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 16, minHeight: 30 },
  ledgerName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ledgerLabel: { color: C.sheetInk, fontFamily: F.body, fontSize: 18, lineHeight: 25 },
  ledgerValue: { flexShrink: 1, color: C.sheetInk, fontFamily: F.numeric, fontSize: 19, lineHeight: 25, textAlign: 'right' },
  missing: { color: C.sheetMuted, fontFamily: F.body },
  pirate: { marginTop: 6 },
})
