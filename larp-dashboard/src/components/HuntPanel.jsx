import { useState } from 'react'
import { timeAgo } from '../lib/geo'

function cloakLabel(timestamp) {
  if (!timestamp || new Date(timestamp) <= new Date()) return 'visible'
  const minutes = Math.max(1, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 60000))
  return `cloaked ${minutes}m`
}

function orderedAlivePlayers(players) {
  const alive = players.filter((player) => player.state === 'alive')
  if (alive.length < 2) return alive
  const byId = new Map(alive.map((player) => [player.profile_id, player]))
  const ordered = []
  const visited = new Set()
  let current = alive[0]
  while (current && !visited.has(current.profile_id)) {
    ordered.push(current)
    visited.add(current.profile_id)
    current = byId.get(current.target_profile_id)
  }
  return ordered.length === alive.length ? ordered : alive
}

export default function HuntPanel({
  hunt,
  members,
  characters,
  startHunt,
  resetHunt,
  resolveClaim,
  eliminatePlayer,
  restorePlayer,
  saveChain,
  refresh,
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [editingChain, setEditingChain] = useState(false)
  const [chainOrder, setChainOrder] = useState([])
  const players = members.filter((member) => member.role === 'player')
  const readyCharacters = new Set(
    characters.filter((character) => !character.is_npc).map((character) => character.user_id),
  )
  const ready = players.length >= 2 && players.every((player) => readyCharacters.has(player.profile_id))

  async function run(action, onSuccess) {
    setBusy(true); setMessage('')
    const error = await action()
    setBusy(false)
    setMessage(error ? error.message : '')
    if (!error) onSuccess?.()
  }

  function begin() {
    if (!window.confirm(`Start the hunt with ${players.length} players? The roster and GM-only location privacy will be locked.`)) return
    run(startHunt)
  }

  function reset() {
    if (!window.confirm('Reset this hunt? Assignments, claims, and the current winner will be cleared.')) return
    run(resetHunt)
  }

  function forceClaim(claim, confirmed) {
    const action = confirmed ? 'confirm' : 'reject'
    if (!window.confirm(`Force ${action} this claim? This GM decision overrides the player response.`)) return
    run(() => resolveClaim(claim.id, confirmed))
  }

  function forceEliminate(player) {
    if (!window.confirm(`Eliminate ${player.character_name} and repair the target chain?`)) return
    run(() => eliminatePlayer(player.profile_id))
  }

  function restore(player) {
    if (!window.confirm(`Restore ${player.character_name} to the hunt? Their location consent will remain off until they enable it.`)) return
    run(() => restorePlayer(player.profile_id))
  }

  function editChain() {
    setChainOrder(orderedAlivePlayers(hunt.players ?? []).map((player) => player.profile_id))
    setEditingChain(true)
  }

  function moveChain(index, offset) {
    const target = index + offset
    if (target < 0 || target >= chainOrder.length) return
    setChainOrder((current) => {
      const next = [...current]
      const moved = next[index]
      next[index] = next[target]
      next[target] = moved
      return next
    })
  }

  function applyChain() {
    if (!window.confirm('Apply this complete target order? Pending claims will be rejected.')) return
    run(() => saveChain(chainOrder), () => setEditingChain(false))
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
  const playerById = new Map((hunt.players ?? []).map((player) => [player.profile_id, player]))

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

      <div className="card mb">
        <h3 style={{ marginTop: 0 }}>GM recovery</h3>
        <p className="hint">
          Override disputed claims, eliminate or restore a traveller, or replace the complete living-player chain.
          Recovery actions are immediate and recorded in the claim/event history.
        </p>
        {hunt.phase === 'active' && alive.length >= 2 && (
          <button className="ghost" disabled={busy} onClick={editChain}>Edit target chain</button>
        )}
      </div>

      {editingChain && (
        <div className="card mb">
          <h3 style={{ marginTop: 0 }}>Target order</h3>
          <p className="hint">Each traveller targets the next row; the last row targets the first.</p>
          {chainOrder.map((profileId, index) => {
            const player = playerById.get(profileId)
            const next = playerById.get(chainOrder[(index + 1) % chainOrder.length])
            return (
              <div className="event-row" key={profileId}>
                <span style={{ flex: 1 }}><b>{player?.character_name}</b> targets <b>{next?.character_name}</b></span>
                <button className="ghost" disabled={busy || index === 0} onClick={() => moveChain(index, -1)}>Up</button>
                <button className="ghost" disabled={busy || index === chainOrder.length - 1} onClick={() => moveChain(index, 1)}>Down</button>
              </div>
            )
          })}
          <div className="row mt">
            <button className="primary" disabled={busy} onClick={applyChain}>Apply chain</button>
            <button className="ghost" disabled={busy} onClick={() => setEditingChain(false)}>Cancel</button>
          </div>
        </div>
      )}

      <h3>Target chain</h3>
      <table className="grid">
        <thead><tr><th>Traveller</th><th>State</th><th>Target</th><th>Signal</th><th>Eliminated</th><th>GM action</th></tr></thead>
        <tbody>
          {(hunt.players ?? []).map((player) => (
            <tr key={player.profile_id}>
              <td><b>{player.character_name}</b><div className="hint">{player.username}</div></td>
              <td><span className={`badge-pill ${player.state === 'alive' ? 'on' : 'off'}`}>{player.state}</span></td>
              <td>{player.target_name ?? '-'}</td>
              <td className="hint">{player.state === 'alive' ? cloakLabel(player.hidden_until) : '-'}</td>
              <td className="hint">{player.eliminated_at ? timeAgo(player.eliminated_at) : '-'}</td>
              <td>
                {hunt.phase === 'active' && player.state === 'alive' && alive.length > 1 && (
                  <button className="danger" disabled={busy} onClick={() => forceEliminate(player)}>Eliminate</button>
                )}
                {player.state === 'eliminated' && (
                  <button className="ghost" disabled={busy} onClick={() => restore(player)}>Restore</button>
                )}
              </td>
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
          {claim.status === 'pending' && (
            <span className="row">
              <button className="primary" disabled={busy} onClick={() => forceClaim(claim, true)}>Force confirm</button>
              <button className="ghost" disabled={busy} onClick={() => forceClaim(claim, false)}>Force reject</button>
            </span>
          )}
        </div>
      ))}
      {(hunt.claims ?? []).length === 0 && <p className="hint">No claims yet.</p>}
    </div>
  )
}
