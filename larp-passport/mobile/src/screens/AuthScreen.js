import { useState } from 'react'
import { View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { C } from '../lib/theme'

const s = {
  input: {
    backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 8,
    color: C.text, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, fontSize: 15,
  },
  label: { color: C.muted, fontSize: 12, marginBottom: 4 },
}

export default function AuthScreen() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setError(''); setNotice(''); setBusy(true)
    try {
      if (mode === 'signup') {
        if (username.trim().length < 3) throw new Error('Username needs at least 3 characters.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { username: username.trim() } },
        })
        if (error) throw error
        if (data.user && !data.session) setNotice('Account created. Check your email to confirm, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.brass, fontSize: 30, textAlign: 'center', fontFamily: 'serif', letterSpacing: 2 }}>LARP PASSPORT</Text>
        <Text style={{ color: C.muted, textAlign: 'center', marginBottom: 28 }}>Your character, in the field</Text>
        <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 20 }}>
          {mode === 'signup' && (<>
            <Text style={s.label}>Username</Text>
            <TextInput style={s.input} autoCapitalize="none" value={username} onChangeText={setUsername} placeholder="ranger_of_the_vale" placeholderTextColor={C.lineStrong} />
          </>)}
          <Text style={s.label}>Email</Text>
          <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholderTextColor={C.lineStrong} />
          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} secureTextEntry value={password} onChangeText={setPassword} placeholderTextColor={C.lineStrong} />
          <TouchableOpacity disabled={busy} onPress={submit}
            style={{ backgroundColor: C.brass, borderRadius: 8, paddingVertical: 12, alignItems: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#14110a', fontWeight: '700', fontSize: 15 }}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Text>
          </TouchableOpacity>
          {!!error && <Text style={{ color: C.wax, marginTop: 10 }}>{error}</Text>}
          {!!notice && <Text style={{ color: C.moss, marginTop: 10 }}>{notice}</Text>}
          <TouchableOpacity onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')} style={{ marginTop: 16 }}>
            <Text style={{ color: C.muted, textAlign: 'center' }}>
              {mode === 'signin' ? 'New here? ' : 'Have an account? '}
              <Text style={{ color: C.brass }}>{mode === 'signin' ? 'Create an account' : 'Sign in'}</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
