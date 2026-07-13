import { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { supabase } from '../lib/supabase'
import { C, F } from '../lib/theme'

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
        const { data, error: signupError } = await supabase.auth.signUp({
          email: email.trim(), password, options: { data: { username: username.trim() } },
        })
        if (signupError) throw signupError
        if (data.user && !data.session) setNotice('Account created. Confirm your email, then sign in.')
      } else {
        const { error: signinError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signinError) throw signinError
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode((current) => current === 'signin' ? 'signup' : 'signin')
    setError('')
    setNotice('')
  }

  const signingIn = mode === 'signin'

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.scanLineOne} />
      <View pointerEvents="none" style={styles.scanLineTwo} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboard}>
        <View style={styles.identityBlock}>
          <View style={styles.markOuter}><View style={styles.markInner} /></View>
          <Text style={styles.eyebrow}>TEMPORAL FIELD AUTHORITY</Text>
          <Text style={styles.brand}>LARP PASSPORT</Text>
          <Text style={styles.tagline}>IDENTITY UPLINK // FIELD TERMINAL</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardKicker}>{signingIn ? 'AGENT RE-ENTRY' : 'NEW AGENT REGISTRY'}</Text>
            <Text style={styles.cardTitle}>{signingIn ? 'Authenticate' : 'Create identity'}</Text>
          </View>

          {mode === 'signup' && (
            <Field label="FIELD HANDLE" value={username} onChangeText={setUsername} placeholder="agent_tachyon" autoCapitalize="none" />
          )}
          <Field label="EMAIL" value={email} onChangeText={setEmail} placeholder="agent@example.com" autoCapitalize="none" keyboardType="email-address" />
          <Field label="ACCESS PHRASE" value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />

          <TouchableOpacity disabled={busy} onPress={submit} style={[styles.primaryButton, busy && styles.disabled]}>
            <Text style={styles.primaryButtonText}>{busy ? 'CONNECTING...' : signingIn ? 'ENTER TIMELINE' : 'REGISTER AGENT'}</Text>
          </TouchableOpacity>
          {!!error && <Text style={styles.error}>{error}</Text>}
          {!!notice && <Text style={styles.notice}>{notice}</Text>}

          <TouchableOpacity onPress={switchMode} style={styles.modeButton}>
            <Text style={styles.modeCopy}>{signingIn ? 'NO FIELD ID? ' : 'ALREADY REGISTERED? '}<Text style={styles.modeLink}>{signingIn ? 'CREATE ONE' : 'SIGN IN'}</Text></Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.footer}>SECURE CHANNEL // BUILD 2141.07</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={C.lineStrong} {...props} />
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  keyboard: { flex: 1, justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 26 },
  scanLineOne: { position: 'absolute', top: '14%', left: 0, right: 0, height: 1, backgroundColor: C.panel2 },
  scanLineTwo: { position: 'absolute', bottom: '12%', left: 38, right: 38, height: 1, backgroundColor: C.panel2 },
  identityBlock: { alignItems: 'center', marginBottom: 25 },
  markOuter: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: C.cyanBorder, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  markInner: { width: 16, height: 16, borderRadius: 8, borderWidth: 2, borderColor: C.cyan },
  eyebrow: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 2.1 },
  brand: { color: C.text, fontFamily: F.displayBold, fontSize: 29, letterSpacing: 2.5, marginTop: 5 },
  tagline: { color: C.muted, fontFamily: F.mono, fontSize: 9, letterSpacing: 1.25, marginTop: 7 },
  card: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 18 },
  cardHeader: { borderBottomColor: C.line, borderBottomWidth: 1, paddingBottom: 13, marginBottom: 16 },
  cardKicker: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.7 },
  cardTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 21, marginTop: 5 },
  field: { marginBottom: 13 },
  label: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 9, letterSpacing: 1.5, marginBottom: 6 },
  input: { backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, color: C.text, fontFamily: F.body, fontSize: 14, paddingHorizontal: 12, paddingVertical: 11 },
  primaryButton: { backgroundColor: C.cyan, borderRadius: 6, alignItems: 'center', paddingVertical: 13, marginTop: 3 },
  primaryButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: 14, letterSpacing: 1.2 },
  disabled: { opacity: 0.55 },
  error: { color: C.red, fontFamily: F.bodyMedium, fontSize: 13, lineHeight: 19, marginTop: 11 },
  notice: { color: C.green, fontFamily: F.bodyMedium, fontSize: 13, lineHeight: 19, marginTop: 11 },
  modeButton: { paddingTop: 17, paddingBottom: 2 },
  modeCopy: { color: C.muted, textAlign: 'center', fontFamily: F.mono, fontSize: 10, letterSpacing: 0.7 },
  modeLink: { color: C.cyan, fontFamily: F.monoSemiBold },
  footer: { color: C.lineStrong, textAlign: 'center', fontFamily: F.mono, fontSize: 8.5, letterSpacing: 1.5, marginTop: 20 },
})
