import { useState } from 'react'
import { supabase } from '../lib/supabase'

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
          email, password, options: { data: { username: username.trim() } },
        })
        if (error) throw error
        if (data.user && !data.session) setNotice('Account created. Check your email to confirm, then sign in.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="center-screen">
      <div className="brand">
        <h1 className="display">LARP Passport</h1>
        <p>GM console</p>
      </div>
      <div className="card">
        {mode === 'signup' && (
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="gm_morgana" style={{ width: '100%' }} />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </div>
        <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={submit}>
          {mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}
        <p className="hint" style={{ marginTop: 14, textAlign: 'center' }}>
          {mode === 'signin' ? (
            <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup') }} style={{ color: 'var(--brass)' }}>Create an account</a></>
          ) : (
            <>Have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin') }} style={{ color: 'var(--brass)' }}>Sign in</a></>
          )}
        </p>
      </div>
    </div>
  )
}
