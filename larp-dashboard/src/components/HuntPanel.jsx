import { useState } from 'react'
import { timeAgo } from '../lib/geo'
import TableScroll from './TableScroll'

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
  assignNextTarget,
  refresh,
}) {
  const [busy, setBusy] = useState(false)
  // Outcome of the last consequential action. It stays until the GM dismisses
  // it or starts another action; dismissing it changes no game state.
  const [outcome, setOutcome] = useState(null) // { tone: 'error' | 'ok', text }
  const [editingChain, setEditingChain] = useState(false)
  const [chainOrder, setChainOrder] = useState([])
  const players = members.filter((member) => member.role === 'player')
  const readyCharacters = new Set(
    characters.filter((character) => !character.is_npc).map((character) => character.user_id),
  )
  const ready = players.length >= 2 && players.every((player) => readyCharacters.has(player.profile_id))

  async function run(action, { onSuccess, success } = {}) {
    if (busy) return
    setBusy(true); setOutcome(null)
    try {
      const error = await action()
      if (error) { setOutcome({ tone: 'error', text: error.message }); return }
      if (success) setOutcome({ tone: 'ok', text: success })
      onSuccess?.()
    } catch (error) {
      setOutcome({ tone: 'error', text: error.message })
    } finally { setBusy(false) }
  }

  function begin() {
    if (!window.confirm(`Start the hunt with ${players.length} players? The roster and GM-only location privacy will be locked.`)) return
    run(startHunt, { success: 'Hunt started. Every player has a secret target.' })
  }

  function reset() {
    if (!window.confirm('Reset this hunt? Assignments, claims, and the current winner will be cleared.')) return
    run(resetHunt, { success: 'Hunt reset. Assignments, claims and the winner were cleared.' })
  }

  function forceClaim(claim, confirmed) {
    const action = confirmed ? 'confirm' : 'reject'
    if (!window.confirm(`Force ${action} this claim? This GM decision overrides the player response.`)) return
    run(() => resolveClaim(claim.id, confirmed), {
      success: confirmed
        ? `Claim confirmed: ${claim.victim_name} is eliminated.`
        : `Claim rejected: ${claim.victim_name} stays in the hunt.`,
    })
  }

  function forceEliminate(player) {
    if (!window.confirm(`Eliminate ${player.character_name} and repair the target chain?`)) return
    run(() => eliminatePlayer(player.profile_id), { success: `${player.character_name} eliminated. The target chain was repaired.` })
  }

  function restore(player) {
    if (!window.confirm(`Restore ${player.character_name} to the hunt? Their location consent will remain off until they enable it.`)) return
    run(() => restorePlayer(player.profile_id), { success: `${player.character_name} restored to the hunt.` })
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
    run(() => saveChain(chainOrder), { onSuccess: () => setEditingChain(false), success: 'Target chain applied. Stale pending claims were rejected.' })
  }

  function assignTarget(player) {
    if (!window.confirm(`Assign the inherited target to ${player.character_name}?`)) return
    run(() => assignNextTarget(player.profile_id), { success: `Target assigned to ${player.character_name}.` })
  }

  const outcomeBox = outcome && (
    <div className={`outcome ${outcome.tone === 'error' ? 'outcome-error' : 'outcome-ok'}`} role={outcome.tone === 'error' ? 'alert' : 'status'}>
      <span>{outcome.text}</span>
      <button type="button" className="ghost" onClick={() => setOutcome(null)} aria-label="Dismiss message">Dismiss</button>
    </div>
  )

  if (!hunt) return <div className="panel-pad hunt-panel"><p className="hint">Loading hunt state...</p></div>

  if (hunt.phase === 'not_started') return (
    <div className="panel-pad hunt-panel">
      <div className="card hunt-start-card">
        <span className="micro-label">TIME HUNT // START CONTROL</span>
        <h2 className="display">Roster readiness</h2>
        <p className="hint">
          Starting randomizes every player into one secret circular target chain. GMs remain observers,
          player positions become GM-only, and the roster locks until reset or a winner is declared.
        </p>
        <div className="readiness-row">
          <span className={`badge-pill ${players.length >= 2 ? 'on' : 'off'}`}>{players.length} PLAYERS {players.length >= 2 ? '✓' : ''}</span>
          <span className={`badge-pill ${readyCharacters.size >= players.length ? 'on' : 'off'}`}>{readyCharacters.size} CHARACTERS {readyCharacters.size >= players.length ? '✓' : ''}</span>
        </div>
        {!ready && <p className="error mt">At least two players are required, and every player needs a non-NPC character.</p>}
        {outcomeBox}
        <div className="row mt">
          <button className="primary" disabled={!ready || busy} onClick={begin}>{busy ? 'Starting...' : 'Start hunt'}</button>
          <button className="ghost" disabled={busy} onClick={() => run(refresh)}>Refresh readiness</button>
        </div>
      </div>
    </div>
  )

  const alive = hunt.players?.filter((player) => player.state === 'alive') ?? []
  const pending = hunt.claims?.filter((claim) => claim.status === 'pending') ?? []
  const assignmentPending = alive.some((player) => !player.target_profile_id)
  const playerById = new Map((hunt.players ?? []).map((player) => [player.profile_id, player]))

  return (
    <div className="panel-pad hunt-panel">
      <div className="hunt-phase-row">
        <span className={`badge-pill phase-pill ${hunt.phase === 'active' ? 'on' : 'gm'}`}>
          {hunt.phase === 'active' && <span className="pulse-dot" />}{hunt.phase.toUpperCase()}
        </span>
        <span className="hunt-count">{alive.length} of {hunt.players?.length ?? 0} travellers remain</span>
        {hunt.winner && <b className="winner-inline">Winner: {hunt.winner.character_name}</b>}
        <span className="spacer" />
        <button className="ghost" disabled={busy} onClick={() => run(refresh)}>Refresh</button>
        <button className="danger" disabled={busy} onClick={reset}>Reset hunt</button>
      </div>
      {outcomeBox}

      {hunt.phase === 'finished' && hunt.winner && (
        <div className="winner-banner">
          <span className="winner-orbit">◉</span>
          <div>
            <span className="micro-label">TIMELINE SECURED</span>
            <h2>TIMELINE SECURED // {hunt.winner.character_name}</h2>
            <p>Restore a traveller or reset the hunt only if the final ruling needs correction.</p>
          </div>
        </div>
      )}

      {editingChain && (
        <div className="card chain-editor mb">
          <span className="micro-label">TARGET ORDER // GM EYES ONLY</span>
          <h3>Target order</h3>
          <p className="hint">Each traveller targets the next row; the last row targets the first.</p>
          {chainOrder.map((profileId, index) => {
            const player = playerById.get(profileId)
            const next = playerById.get(chainOrder[(index + 1) % chainOrder.length])
            return (
              <div className="chain-order-row" key={profileId}>
                <span className="chain-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="chain-route"><b>{player?.character_name}</b> targets <b>{next?.character_name}</b></span>
                <button className="ghost" aria-label={`Move ${player?.character_name ?? 'player'} up`} disabled={busy || index === 0} onClick={() => moveChain(index, -1)}>Up</button>
                <button className="ghost" aria-label={`Move ${player?.character_name ?? 'player'} down`} disabled={busy || index === chainOrder.length - 1} onClick={() => moveChain(index, 1)}>Down</button>
              </div>
            )
          })}
          <div className="row mt">
            <button className="primary" disabled={busy} onClick={applyChain}>Apply chain</button>
            <button className="ghost" disabled={busy} onClick={() => setEditingChain(false)}>Cancel</button>
            <span className="chain-warning">SAVING REJECTS STALE PENDING CLAIMS</span>
          </div>
        </div>
      )}

      <div className="hunt-command-grid">
        <section className="command-card chain-card">
          <div className="command-card-header">
            <div><span className="micro-label">TARGET CHAIN // GM EYES ONLY</span><h3>Live assignment ring</h3></div>
            {hunt.phase === 'active' && alive.length >= 2 && (
              <button className="ghost" disabled={busy} onClick={editChain}>Edit target chain</button>
            )}
          </div>
          <TableScroll label="Target chain table">
            <table className="grid hunt-grid">
              <thead><tr><th>Traveller</th><th>State</th><th>Targets</th><th>Signal</th><th>Eliminated</th><th>GM action</th></tr></thead>
              <tbody>
                {(hunt.players ?? []).map((player) => {
                  const awaitingAssignment = hunt.phase === 'active' && player.state === 'alive' && !player.target_profile_id
                  const signal = player.state === 'alive' ? cloakLabel(player.hidden_until) : '-'
                  return (
                    <tr key={player.profile_id} className={`${player.state === 'eliminated' ? 'eliminated-row' : ''} ${awaitingAssignment ? 'awaiting-row' : ''}`}>
                      <td><b>{player.character_name}</b><div className="hint">@{player.username}</div></td>
                      <td><span className={`badge-pill ${player.state === 'alive' ? 'on' : 'off'}`}>{player.state.toUpperCase()}</span></td>
                      <td className={awaitingAssignment ? 'awaiting-target' : 'target-cell'}>{player.target_name ? <>→ {player.target_name}</> : awaitingAssignment ? 'Waiting for GM target assignment' : '-'}</td>
                      <td className={signal.startsWith('cloaked') ? 'signal-cloaked' : 'hint'}>{signal}</td>
                      <td className="hint">{player.eliminated_at ? timeAgo(player.eliminated_at) : '-'}</td>
                      <td className="action-cell">
                        {hunt.phase === 'active' && player.state === 'alive' && alive.length > 1 && (
                          <button className="danger" aria-label={`Eliminate ${player.character_name}`} disabled={busy || assignmentPending} onClick={() => forceEliminate(player)}>Eliminate</button>
                        )}
                        {awaitingAssignment && (
                          <button className="primary" aria-label={`Assign target to ${player.character_name}`} disabled={busy} onClick={() => assignTarget(player)}>Assign target</button>
                        )}
                        {player.state === 'eliminated' && (
                          <button className="ghost" aria-label={`Restore ${player.character_name}`} disabled={busy} onClick={() => restore(player)}>Restore</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        </section>

        <aside className="hunt-sidebar">
          <section className="command-card recovery-card">
            <span className="micro-label">GM OVERRIDES</span>
            <h3>Rulings and corrections</h3>
            <p className="hint">Override claims, eliminate or restore a traveller, or replace the complete living-player chain. Every action is recorded.</p>
          </section>

          <section className="command-card claims-card">
            <div className="command-card-header compact">
              <div><span className="micro-label">ELIMINATION CLAIMS</span><h3>Adjudication queue</h3></div>
              {pending.length > 0 && <span className="queue-count">{pending.length}</span>}
            </div>
            {(hunt.claims ?? []).map((claim) => (
              <div key={claim.id} className="claim-row">
                <div className="claim-meta"><span className={`status ${claim.status}`}>{claim.status.toUpperCase()}</span><span>{timeAgo(claim.requested_at)}</span></div>
                <p><b>{claim.hunter_name}</b> claimed <b className="victim-name">{claim.victim_name}</b></p>
                {claim.status === 'pending' && (
                  <div className="claim-actions">
                    <button className="primary" disabled={busy} onClick={() => forceClaim(claim, true)}>Force confirm</button>
                    <button className="ghost" disabled={busy} onClick={() => forceClaim(claim, false)}>Force reject</button>
                  </div>
                )}
              </div>
            ))}
            {(hunt.claims ?? []).length === 0 && <p className="hint">No claims yet.</p>}
          </section>
        </aside>
      </div>
    </div>
  )
}
