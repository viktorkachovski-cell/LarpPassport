import { useEffect, useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, FlatList } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { C } from '../lib/theme'

export default function GamesScreen({ session, onOpen }) {
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
    const { data, error } = await supabase.rpc('join_game', { code: code.trim() })
    setBusy(false)
    if (error) { setError(error.message); return }
    if (!data?.ok) { setError(data?.error ?? 'Could not join the game.'); return }
    setCode('')
    await load()
    onOpen({ id: data.joined_game_id, name: data.joined_game_name })
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink, padding: 20 }}>
      <Text style={{ color: C.brass, fontSize: 24, fontFamily: 'serif', letterSpacing: 1, marginBottom: 4 }}>Your games</Text>
      <Text style={{ color: C.muted, marginBottom: 20 }}>Join with the code your GM gave you.</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
        <TextInput
          style={{ flex: 1, backgroundColor: C.panel, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 8, color: C.text, paddingHorizontal: 12, paddingVertical: 10, letterSpacing: 4, fontSize: 16 }}
          autoCapitalize="characters" maxLength={8} value={code} onChangeText={setCode}
          placeholder="GAME CODE" placeholderTextColor={C.lineStrong} />
        <TouchableOpacity disabled={busy} onPress={join}
          style={{ backgroundColor: C.brass, borderRadius: 8, paddingHorizontal: 18, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
          <Text style={{ color: '#14110a', fontWeight: '700' }}>Join</Text>
        </TouchableOpacity>
      </View>
      {!!error && <Text style={{ color: C.wax, marginBottom: 8 }}>{error}</Text>}
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        style={{ marginTop: 12 }}
        ListEmptyComponent={<Text style={{ color: C.muted, textAlign: 'center', marginTop: 30 }}>No games yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity onPress={() => onOpen(item)}
            style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 }}>
            <Text style={{ color: C.text, fontSize: 17, fontFamily: 'serif' }}>{item.name}</Text>
            <Text style={{ color: item.status === 'active' ? C.moss : C.muted, fontSize: 12, marginTop: 2 }}>{item.status}</Text>
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity onPress={() => supabase.auth.signOut()} style={{ paddingVertical: 12 }}>
        <Text style={{ color: C.muted, textAlign: 'center' }}>Sign out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  )
}
