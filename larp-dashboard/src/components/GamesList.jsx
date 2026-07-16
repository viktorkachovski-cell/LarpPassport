import { useEffect, useState } from 'react'
import { GAME_COLUMNS, supabase } from '../lib/supabase'

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

  useEffect(() => { load() }, [])
  async function load() {
    const { data, error } = await supabase.from('games').select(GAME_COLUMNS).order('created_at', { ascending: false })
    if (!error) setGames(data ?? [])
  }

  async function createGame() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const { data, error } = await supabase.from('games')
      .insert({ name: name.trim(), gm_id: session.user.id, status: 'draft', template: DEFAULT_TEMPLATE })
      .select(GAME_COLUMNS).single()
    setBusy(false)
    if (error) { setError(error.message); return }
    onOpen(data.id)
  }

  return (
    <div className="center-screen" style={{ justifyContent: 'flex-start', paddingTop: 60 }}>
      <div className="brand">
        <span className="brand-kicker">TEMPORAL FIELD AUTHORITY</span>
        <h1 className="display">DEPLOYMENT REGISTRY</h1>
        <p>Open an operation or authorize a new timeline.</p>
      </div>
      <div className="games-list">
        <div className="registry-heading"><span>ASSIGNED OPERATIONS</span><b>{String(games.length).padStart(2, '0')}</b></div>
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
        {games.length === 0 && <p className="hint" style={{ textAlign: 'center' }}>No games yet. Create your first one below.</p>}
        <div className="row mt">
          <input placeholder="New game name" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createGame()} style={{ flex: 1 }} />
          <button className="primary" onClick={createGame} disabled={busy}>Create game</button>
        </div>
        {error && <p className="error">{error}</p>}
        <p className="hint mt" style={{ textAlign: 'center' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); supabase.auth.signOut() }} style={{ color: 'var(--muted)' }}>Sign out</a>
        </p>
      </div>
    </div>
  )
}
