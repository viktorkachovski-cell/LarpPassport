import { useState } from 'react'
import { Reason, validReason } from './pirateCommon'

// Every Pirate site with its standing claims. A GM voids a mistaken or cheated
// claim with a reason (gm_void_claim): the shard and doubloons are reversed,
// an oath word is withdrawn, and the crew may solve the riddle again.
export default function PirateSiteBoard({ gameId, state, busy, run, rpc, refresh, onRemoveSite }) {
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const canSetSite = state.phase === 'setup'

  function voidClaim(event) {
    event.preventDefault()
    if (!window.confirm(`Void ${voiding.crew_name}'s claim? Its rewards will be reversed.`)) return
    run(async () => {
      await rpc('gm_void_claim', { g: gameId, claim_id: voiding.id, reason })
      setVoiding(null)
      setReason('')
      refresh()
    }, { success: 'Claim voided and its rewards reversed.' })
  }

  return <section className="command-card pirate-section">
    <h3>Site board</h3>
    <div className="table-scroll"><table className="grid">
      <thead><tr><th>Site</th><th>Kind</th><th>Reward</th><th>Answer</th><th>Claims</th>{canSetSite && <th>Setup</th>}</tr></thead>
      <tbody>{(state.sites ?? []).map((site) => <tr key={site.zone_id}>
        <td>{site.name}{!site.active && ' (inactive)'}</td><td>{site.kind}</td>
        <td>{site.reward ?? '—'}</td><td>{site.answer_set ? 'set' : '—'}</td>
        <td>{(site.claims ?? []).length === 0 ? '—' : <ol className="pirate-claims">
          {site.claims.map((claim) => <li key={claim.id}>
            {claim.crew_name}{claim.claimed_by_name && ` (${claim.claimed_by_name})`}{claim.via_gm && ' · GM claim'}
            {claim.gm_reason && <span> · {claim.gm_reason}</span>}
            {' '}<button type="button" disabled={!!busy} onClick={() => setVoiding({ ...claim, site_name: site.name })}>Void</button>
          </li>)}
        </ol>}</td>
        {canSetSite && <td><button type="button" disabled={!!busy} onClick={() => onRemoveSite(site)}>Remove</button></td>}
      </tr>)}</tbody>
    </table></div>
    {voiding && <form onSubmit={voidClaim} className="pirate-form-grid">
      <p className="hint">Void {voiding.crew_name}'s claim at {voiding.site_name}. Fails if the crew no longer holds the reward.</p>
      <Reason id="pirate-claim-void-reason" label="Correction reason" value={reason} onChange={setReason} />
      <div className="row">
        <button type="submit" disabled={!!busy || !validReason(reason)}>Void claim</button>
        <button type="button" onClick={() => { setVoiding(null); setReason('') }}>Cancel</button>
      </div>
    </form>}
  </section>
}
