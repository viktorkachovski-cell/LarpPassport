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
        <span className="brand-mark" aria-hidden="true"><span /></span>
        <span className="brand-kicker">TEMPORAL FIELD AUTHORITY</span>
        <h1 className="display">LARP PASSPORT</h1>
        <p>GM COMMAND CONSOLE // SECURE UPLINK</p>
      </div>
      <div className="card auth-card">
        <div className="card-heading">
          <span className="micro-label">{mode === 'signin' ? 'COMMAND RE-ENTRY' : 'NEW COMMAND ID'}</span>
          <h2>{mode === 'signin' ? 'Authenticate' : 'Create GM account'}</h2>
        </div>
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
            <>New here? <button type="button" className="text-button" onClick={() => setMode('signup')}>Create an account</button></>
          ) : (
            <>Have an account? <button type="button" className="text-button" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </p>
      </div>
    </div>
  )
}
