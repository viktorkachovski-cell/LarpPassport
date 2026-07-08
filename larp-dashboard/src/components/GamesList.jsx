import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
    const { data, error } = await supabase.from('games').select('*').order('created_at', { ascending: false })
    if (!error) setGames(data ?? [])
  }

  async function createGame() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const { data, error } = await supabase.from('games')
      .insert({ name: name.trim(), gm_id: session.user.id, status: 'draft', template: DEFAULT_TEMPLATE })
      .select().single()
    setBusy(false)
    if (error) { setError(error.message); return }
    onOpen(data.id)
  }

  return (
    <div className="center-screen" style={{ justifyContent: 'flex-start', paddingTop: 60 }}>
      <div className="brand">
        <h1 className="display">LARP Passport</h1>
        <p>Your games</p>
      </div>
      <div className="games-list">
        {games.map((g) => (
          <div key={g.id} className="game-card" onClick={() => onOpen(g.id)}>
            <div>
              <div className="name">{g.name}</div>
              <div className="sub">{g.status} · code {g.join_code}</div>
            </div>
            <button className="ghost">Open</button>
          </div>
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
