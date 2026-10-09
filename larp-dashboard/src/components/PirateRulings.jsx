import { useState } from 'react'
import { CrewSelect, Reason, parleyTitle, validReason } from './pirateCommon'

// Awards the hoard after the GM hears the oath on site, or voids that award.
export function TreasureAward({ gameId, state, busy, run, rpc, refresh }) {
  const crews = state.crews ?? []
  const [crew, setCrew] = useState('')
  const [reason, setReason] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const { treasure, treasure_award: award } = state

  function grant(event) {
    event.preventDefault()
    if (!window.confirm('Award the hoard to this crew after hearing the oath on site?')) return
    run(async () => {
      await rpc('gm_award_treasure', { g: gameId, faction_id: crew, reason })
      setReason('')
      refresh()
    }, { success: 'Treasure awarded and announced to players.' })
  }

  function revoke(event) {
    event.preventDefault()
    if (!window.confirm('Void the current treasure award and reverse its doubloons?')) return
    run(async () => {
      await rpc('gm_void_treasure', { g: gameId, reason: voidReason })
      setVoidReason('')
      refresh()
    }, { success: 'Treasure award voided and reversed.' })
  }

  return <section className="command-card pirate-section">
    <h3>Treasure award</h3>
    {treasure?.value != null
      ? <p className="hint">Worth {treasure.value} doubloons (based on the leading {treasure.basis}, frozen under the rules when the hoard first opened).</p>
      : <p className="hint">No value frozen yet. Open the hoard with the phase control to set it.</p>}
    {award ? <>
      <p>{award.crew_name} holds the hoard.</p>
      <form onSubmit={revoke} className="pirate-form-grid">
        <Reason id="pirate-void-reason" label="Correction reason" value={voidReason} onChange={setVoidReason} />
        <button type="submit" disabled={!!busy || !validReason(voidReason)}>Void treasure award</button>
      </form>
    </> : <form onSubmit={grant} className="pirate-form-grid">
      <CrewSelect id="pirate-award-crew" label="Crew" value={crew} onChange={setCrew} crews={crews} />
      <Reason id="pirate-award-reason" label="Oath verification note" value={reason} onChange={setReason} />
      <button type="submit" disabled={!!busy || !crews.some((item) => item.id === crew) || !validReason(reason)}>Award treasure</button>
    </form>}
  </section>
}

const reportedName = (parley, report) => {
  if (report === parley.target_faction) return parley.target_name
  return report === parley.attacker_faction ? parley.attacker_name : 'missing'
}

// GM ruling for a Parley whose reports conflict or never arrived.
function ParleyRuling({ gameId, parley, busy, run, rpc, refresh }) {
  const [winner, setWinner] = useState(parley.attacker_faction ?? '')
  const [currency, setCurrency] = useState('doubloon')
  const [reason, setReason] = useState('')
  const fight = parley.choice === 'fight'
  const yielded = parley.choice === 'yield'

  function rule(name, args, success) {
    run(async () => {
      await rpc(name, { g: gameId, parley_id: parley.id, reason, ...args })
      setReason('')
      refresh()
    }, { success })
  }
  function resolve() {
    if (!window.confirm('Resolve this Parley despite the conflicting or missing reports?')) return
    rule('gm_resolve_parley', { winner_faction: yielded ? parley.attacker_faction : winner, currency: yielded ? 'doubloon' : currency },
      'Parley resolved with a recorded GM ruling.')
  }
  function voidSession() {
    if (!window.confirm('Void this Parley? Any transfer will be reversed.')) return
    rule('gm_void_parley', {}, 'Parley voided with an audit entry.')
  }

  return <div className="pirate-ruling">
    <p className="hint">Target report: {reportedName(parley, parley.target_report)} · Attacker report: {reportedName(parley, parley.attacker_report)}</p>
    <div className="pirate-form-grid">
      {fight && <>
        <div className="field"><label htmlFor={`winner-${parley.id}`}>Winner</label>
          <select id={`winner-${parley.id}`} value={winner} onChange={(event) => setWinner(event.target.value)}>
            <option value={parley.target_faction}>{parley.target_name}</option>
            <option value={parley.attacker_faction}>{parley.attacker_name}</option>
          </select></div>
        <div className="field"><label htmlFor={`currency-${parley.id}`}>Plunder</label>
          <select id={`currency-${parley.id}`} value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="doubloon">Doubloons</option><option value="bearing">One bearing shard</option>
          </select></div>
      </>}
      <Reason id={`reason-${parley.id}`} label="Ruling reason" value={reason} onChange={setReason} />
    </div>
    <div className="row">
      <button type="button" disabled={!!busy || !(fight || yielded) || !validReason(reason)} onClick={resolve}>Resolve Parley</button>
      <button type="button" disabled={!!busy || !validReason(reason)} onClick={voidSession}>Void Parley</button>
    </div>
  </div>
}

export function ParleyDisputes({ gameId, state, busy, run, rpc, refresh }) {
  const parleys = state.parleys ?? []
  return <section className="command-card pirate-section">
    <h3>Parley and disputes</h3>
    {parleys.length === 0 && <p className="hint">No active Parleys.</p>}
    {parleys.map((parley) => <div key={parley.id} className="pirate-parley-row">
      <strong>{parleyTitle(parley)} · {parley.state}</strong>
      {parley.far_apart && <span className="hint">The players were far apart at join.</span>}
      {parley.state === 'disputed' && <ParleyRuling gameId={gameId} parley={parley}
        busy={busy} run={run} rpc={rpc} refresh={refresh} />}
    </div>)}
  </section>
}
