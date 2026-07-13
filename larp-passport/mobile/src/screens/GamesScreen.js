import { useEffect, useState } from 'react'
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { C, F } from '../lib/theme'

const STATUS_COLORS = { active: C.green, draft: C.amber, finished: C.muted }

export default function GamesScreen({ onOpen }) {
  const [games, setGames] = useState([])
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('games').select('*').order('created_at', { ascending: false })
    setGames(data ?? [])
  }

  async function join() {
    if (!code.trim()) return
    setBusy(true); setError('')
    const { data, error: joinError } = await supabase.rpc('join_game', { code: code.trim() })
    setBusy(false)
    if (joinError) { setError(joinError.message); return }
    if (!data?.ok) { setError(data?.error ?? 'Could not join the game.'); return }
    setCode('')
    await load()
    onOpen({ id: data.joined_game_id, name: data.joined_game_name })
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>TEMPORAL FIELD AUTHORITY</Text>
          <Text style={styles.title}>DEPLOYMENTS</Text>
        </View>
        <View style={styles.onlineChip}><View style={styles.onlineDot} /><Text style={styles.onlineText}>UPLINK</Text></View>
      </View>

      <View style={styles.joinCard}>
        <Text style={styles.joinKicker}>JOIN A TIMELINE</Text>
        <Text style={styles.joinCopy}>Enter the field code issued by your GM.</Text>
        <View style={styles.joinRow}>
          <TextInput
            style={styles.codeInput}
            autoCapitalize="characters"
            maxLength={8}
            value={code}
            onChangeText={setCode}
            placeholder="GAME CODE"
            placeholderTextColor={C.lineStrong}
          />
          <TouchableOpacity disabled={busy || !code.trim()} onPress={join} style={[styles.joinButton, (busy || !code.trim()) && styles.disabled]}>
            <Text style={styles.joinButtonText}>{busy ? '...' : 'JOIN'}</Text>
          </TouchableOpacity>
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionLabel}>ASSIGNED OPERATIONS</Text>
        <Text style={styles.sectionCount}>{String(games.length).padStart(2, '0')}</Text>
      </View>
      <FlatList
        data={games}
        keyExtractor={(game) => game.id}
        contentContainerStyle={games.length === 0 ? styles.emptyList : styles.list}
        ListEmptyComponent={<Text style={styles.empty}>NO ACTIVE PASSPORTS FOUND</Text>}
        renderItem={({ item }) => {
          const color = STATUS_COLORS[item.status] ?? C.muted
          return (
            <TouchableOpacity onPress={() => onOpen(item)} style={styles.gameCard}>
              <View style={styles.gameIndex}><Text style={styles.gameIndexText}>//</Text></View>
              <View style={styles.gameBody}>
                <Text style={styles.gameName} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.gameStatus, { color }]}>{item.status?.toUpperCase() ?? 'UNKNOWN'}</Text>
              </View>
              <Text style={styles.arrow}>-&gt;</Text>
            </TouchableOpacity>
          )
        }}
      />
      <TouchableOpacity onPress={() => supabase.auth.signOut()} style={styles.signout}>
        <Text style={styles.signoutText}>DISCONNECT FIELD ID</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink, paddingHorizontal: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 18 },
  eyebrow: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.65 },
  title: { color: C.text, fontFamily: F.displayBold, fontSize: 25, letterSpacing: 1.6, marginTop: 3 },
  onlineChip: { flexDirection: 'row', alignItems: 'center', borderColor: C.greenBorder, borderWidth: 1, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green, marginRight: 6 },
  onlineText: { color: C.green, fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.2 },
  joinCard: { backgroundColor: C.panel, borderColor: C.cyanBorder, borderWidth: 1, borderRadius: 10, padding: 15 },
  joinKicker: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.7 },
  joinCopy: { color: C.muted, fontFamily: F.body, fontSize: 13, marginTop: 5, marginBottom: 13 },
  joinRow: { flexDirection: 'row', gap: 9 },
  codeInput: { flex: 1, backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, color: C.text, fontFamily: F.monoSemiBold, paddingHorizontal: 12, paddingVertical: 11, letterSpacing: 2.4, fontSize: 13 },
  joinButton: { backgroundColor: C.cyan, borderRadius: 6, paddingHorizontal: 18, justifyContent: 'center' },
  joinButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 13, letterSpacing: 1 },
  disabled: { opacity: 0.55 },
  error: { color: C.red, fontFamily: F.bodyMedium, fontSize: 12.5, marginTop: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 9 },
  sectionLabel: { flex: 1, color: C.muted, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.6 },
  sectionCount: { color: C.cyan, fontFamily: F.mono, fontSize: 10 },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  empty: { color: C.muted, textAlign: 'center', fontFamily: F.mono, fontSize: 9.5, letterSpacing: 1.4 },
  gameCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 8, padding: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center' },
  gameIndex: { width: 34, height: 34, borderRadius: 6, borderColor: C.cyanBorder, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  gameIndexText: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 11 },
  gameBody: { flex: 1 },
  gameName: { color: C.text, fontFamily: F.displaySemiBold, fontSize: 17, letterSpacing: 0.5 },
  gameStatus: { fontFamily: F.monoSemiBold, fontSize: 8.5, letterSpacing: 1.4, marginTop: 3 },
  arrow: { color: C.lineStrong, fontFamily: F.monoSemiBold, fontSize: 14 },
  signout: { paddingVertical: 15, borderTopColor: C.panel2, borderTopWidth: 1 },
  signoutText: { color: C.muted, textAlign: 'center', fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
})
