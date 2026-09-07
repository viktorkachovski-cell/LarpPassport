import { useEffect, useState } from 'react'
import { GAME_COLUMNS, supabase } from '../lib/supabase'
import SyncStatus from './SyncStatus'

const DEFAULT_TEMPLATE = {
  stats: [
    { key: 'hp', label: 'Hit points', type: 'number', default: 10, min: 0, max: 20, player_editable: false },
    { key: 'notes', label: 'Notes', type: 'text', default: '', player_editable: true },
  ],
}

export default function GamesList({ session, onOpen }) {
  const [games, setGames] = useState([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  // Last successful / failed games request (U01); the parent keys this
  // component by account, so a second account starts from "Checking".
  const [sync, setSync] = useState({ lastOkAt: null, lastErrorAt: null, lastError: '' })
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))

  useEffect(() => { load() }, [])
  useEffect(() => {
    const wentOnline = () => { setOnline(true); load() }
    const wentOffline = () => setOnline(false)
    window.addEventListener('online', wentOnline)
    window.addEventListener('offline', wentOffline)
    return () => { window.removeEventListener('online', wentOnline); window.removeEventListener('offline', wentOffline) }
  }, [])
  async function load() {
    setLoading(true); setError('')
    try {
      const { data, error } = await supabase.from('games').select(GAME_COLUMNS).order('created_at', { ascending: false })
      if (error) throw error
      setGames(data ?? [])
      setSync((current) => ({ ...current, lastOkAt: Date.now() }))
    } catch (error) {
      setError(error.message)
      setSync((current) => ({ ...current, lastErrorAt: Date.now(), lastError: error.message }))
    } finally { setLoading(false) }
  }

  async function createGame() {
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
    const { data, error } = await supabase.from('games')
      .insert({ name: name.trim(), gm_id: session.user.id, status: 'draft', template: DEFAULT_TEMPLATE })
      .select(GAME_COLUMNS).single()
    setBusy(false)
    if (error) { setError(error.message); return }
    onOpen(data.id)
    } catch (error) { setError(error.message) } finally { setBusy(false) }
  }

  return (
    <div className="center-screen" style={{ justifyContent: 'flex-start', paddingTop: 60 }}>
      <div className="brand">
        <span className="brand-kicker">TEMPORAL FIELD AUTHORITY</span>
        <h1 className="display">GAMES</h1>
        <p>Open a game or create a new one.</p>
      </div>
      <div className="games-list">
        <div className="registry-heading"><span>YOUR GAMES</span><b>{String(games.length).padStart(2, '0')}</b></div>
        <SyncStatus sync={sync} realtime={null} online={online} onRetry={load} label="Games" />
        {games.map((g) => (
          <button key={g.id} type="button" className="game-card" onClick={() => onOpen(g.id)}>
            <span className="game-card-mark">//</span>
            <span className="game-card-copy">
              <span className="name">{g.name}</span>
              <span className={`sub game-status-${g.status}`}>{g.status}</span>
            </span>
            <span className="game-card-action">OPEN</span>
          </button>
        ))}
        {!loading && !error && games.length === 0 && <p className="hint" style={{ textAlign: 'center' }}>No games yet. Create your first one below.</p>}
        <button onClick={load} disabled={loading}>{loading ? 'Loading games...' : 'Refresh games'}</button>
        <div className="row mt">
          <input aria-label="New game name" placeholder="New game name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createGame()} style={{ flex: 1 }} />
          <button className="primary" onClick={createGame} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create game'}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <p className="hint mt" style={{ textAlign: 'center' }}>
          <button type="button" className="text-button" onClick={() => supabase.auth.signOut()} style={{ color: 'var(--muted)' }}>Sign out</button>
        </p>
      </div>
    </div>
  )
}
