import { useState } from 'react'
import { timeAgo } from '../lib/geo'

function cloakLabel(timestamp) {
  if (!timestamp || new Date(timestamp) <= new Date()) return 'visible'
  const minutes = Math.max(1, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 60000))
  return `cloaked ${minutes}m`
}

export default function HuntPanel({ hunt, members, characters, startHunt, resetHunt, refresh }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const players = members.filter((member) => member.role === 'player')
  const readyCharacters = new Set(
    characters.filter((character) => !character.is_npc).map((character) => character.user_id),
  )
  const ready = players.length >= 2 && players.every((player) => readyCharacters.has(player.profile_id))

  async function run(action) {
    setBusy(true); setMessage('')
    const error = await action()
    setBusy(false)
    setMessage(error ? error.message : '')
  }

  function begin() {
    if (!window.confirm(`Start the hunt with ${players.length} players? The roster and GM-only location privacy will be locked.`)) return
    run(startHunt)
  }

  function reset() {
    if (!window.confirm('Reset this hunt? Assignments, claims, and the current winner will be cleared.')) return
    run(resetHunt)
  }

  if (!hunt) return <div className="panel-pad"><p className="hint">Loading hunt state...</p></div>

  if (hunt.phase === 'not_started') return (
    <div className="panel-pad">
      <div className="card" style={{ maxWidth: 720 }}>
        <h2 className="display">Time Hunt</h2>
        <p className="hint">
          Starting randomizes every player into one secret circular target chain. GMs remain observers,
          player positions become GM-only, and the roster locks until reset or a winner is declared.
        </p>
        <div className="row mt">
          <span className={`badge-pill ${players.length >= 2 ? 'on' : 'off'}`}>{players.length} players</span>
          <span className={`badge-pill ${readyCharacters.size >= players.length ? 'on' : 'off'}`}>{readyCharacters.size} characters</span>
        </div>
        {!ready && <p className="error mt">At least two players are required, and every player needs a non-NPC character.</p>}
        {message && <p className="error mt">{message}</p>}
        <div className="row mt">
          <button className="primary" disabled={!ready || busy} onClick={begin}>{busy ? 'Starting...' : 'Start hunt'}</button>
          <button className="ghost" disabled={busy} onClick={() => run(refresh)}>Refresh readiness</button>
        </div>
      </div>
    </div>
  )

  const alive = hunt.players?.filter((player) => player.state === 'alive') ?? []
  const pending = hunt.claims?.filter((claim) => claim.status === 'pending') ?? []

  return (
    <div className="panel-pad">
      <div className="row mb">
        <span className={`badge-pill ${hunt.phase === 'active' ? 'on' : 'gm'}`}>{hunt.phase}</span>
        <span className="hint">{alive.length} of {hunt.players?.length ?? 0} remain</span>
        {hunt.winner && <b style={{ color: 'var(--brass)' }}>Winner: {hunt.winner.character_name}</b>}
        <span className="spacer" />
        <button className="ghost" disabled={busy} onClick={() => run(refresh)}>Refresh</button>
        <button className="danger" disabled={busy} onClick={reset}>Reset hunt</button>
      </div>
      {message && <p className="error mb">{message}</p>}

      <h3>Target chain</h3>
      <table className="grid">
        <thead><tr><th>Traveller</th><th>State</th><th>Target</th><th>Signal</th><th>Eliminated</th></tr></thead>
        <tbody>
          {(hunt.players ?? []).map((player) => (
            <tr key={player.profile_id}>
              <td><b>{player.character_name}</b><div className="hint">{player.username}</div></td>
              <td><span className={`badge-pill ${player.state === 'alive' ? 'on' : 'off'}`}>{player.state}</span></td>
              <td>{player.target_name ?? '-'}</td>
              <td className="hint">{player.state === 'alive' ? cloakLabel(player.hidden_until) : '-'}</td>
              <td className="hint">{player.eliminated_at ? timeAgo(player.eliminated_at) : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="mt">Elimination claims</h3>
      {pending.length > 0 && <p className="hint mb">{pending.length} confirmation(s) currently waiting on the target.</p>}
      {(hunt.claims ?? []).map((claim) => (
        <div key={claim.id} className="event-row">
          <span className={`status ${claim.status}`}>{claim.status}</span>
          <span style={{ flex: 1 }}><b>{claim.hunter_name}</b> claimed <b>{claim.victim_name}</b></span>
          <span className="hint">{timeAgo(claim.requested_at)}</span>
        </div>
      ))}
      {(hunt.claims ?? []).length === 0 && <p className="hint">No claims yet.</p>}
    </div>
  )
}
