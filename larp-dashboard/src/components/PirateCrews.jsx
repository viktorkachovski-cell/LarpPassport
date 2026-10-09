import { useState } from 'react'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'
import { CrewSelect, Reason, validReason } from './pirateCommon'

// Crew scoreboard and gm_adjust. The GM picks captains for crews of two or
// more during setup, or later for a crew still without one; a one-player crew
// captains itself. Audited replacement lives in PirateGmControls.
export default function PirateCrews({ gameId, state, busy, run, rpc, refresh }) {
  const inSetup = state.phase === 'setup'
  const [adjustCrew, setAdjustCrew] = useState('')
  const [currency, setCurrency] = useState('bearing')
  const [amount, setAmount] = useState('1')
  const [reason, setReason] = useState('')
  // Adjustments report next to their form, not at the top of the Pirate tab.
  const adjusting = useAction()
  const crews = state.crews ?? []
  const adjustTarget = crews.find((crew) => crew.id === adjustCrew)
  const amountValue = Number(amount)
  const canAdjust = !busy && !adjusting.busy && !!adjustTarget && Number.isInteger(amountValue)
    && amountValue >= 1 && amountValue <= 1000 && validReason(reason)

  // The amount and reason stay filled in, so repeated test adjustments are quick.
  function adjust(sign) {
    const unit = currency === 'bearing' ? 'bearing shard' : 'doubloon'
    const change = `${sign > 0 ? 'Added' : 'Removed'} ${amountValue} ${unit}${amountValue === 1 ? '' : 's'}`
    adjusting.run(async () => {
      await rpc('gm_adjust', { g: gameId, crew: adjustTarget.id, currency, delta: sign * amountValue, reason })
      refresh()
    }, { success: `${change} ${sign > 0 ? 'to' : 'from'} ${adjustTarget.name}. The crew sees the ruling in its logbook.` })
  }

  function chooseCaptain(crew, captain) {
    run(async () => {
      await rpc('pirate_set_captain', { g: gameId, crew: crew.id, captain })
      refresh()
    }, { success: `Captain set for ${crew.name}.` })
  }

  function captainCell(crew) {
    const members = crew.members ?? []
    const captain = members.find((member) => member.profile_id === crew.captain_id)
    const canChoose = members.length > 1 && (inSetup || !crew.captain_id)
    if (!canChoose) return captain?.name ?? 'None'
    return <select aria-label={`Captain of ${crew.name}`} value={crew.captain_id ?? ''} disabled={!!busy}
      onChange={(event) => event.target.value && chooseCaptain(crew, event.target.value)}>
      <option value="">Choose captain</option>
      {members.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.name}</option>)}
    </select>
  }

  return <section className="command-card pirate-section">
    <h3>Crews</h3>
    <p className="hint">{inSetup
      ? 'Choose a captain for every crew of two or more. Only the captain sees the compass. Captains lock when charting starts.'
      : 'Only the captain sees the compass. A GM can replace a captain with a recorded reason using the recovery controls. A crew without a captain can still be given one.'}</p>
    <div className="table-scroll"><table className="grid">
      <thead><tr><th>Crew</th><th>Captain</th><th>Players</th><th>Shards</th><th>Doubloons</th><th>Oath</th><th>Readings</th></tr></thead>
      <tbody>{crews.map((crew) => <tr key={crew.id}>
        <td>{crew.name}</td><td>{captainCell(crew)}</td><td>{crew.members?.length ?? 0}</td>
        <td>{crew.shards}</td><td>{crew.doubloons}</td>
        <td>{crew.oath_count}/4</td><td>{crew.reading_count}</td>
      </tr>)}</tbody>
    </table></div>
    {crews.length > 0 && <>
      <p className="hint">Add or remove a crew's shards or doubloons, for testing or to correct a result. Each change is recorded with its reason; a balance cannot go below zero.</p>
      <form className="pirate-form-grid" onSubmit={(event) => event.preventDefault()}>
        <CrewSelect id="pirate-adjust-crew" label="Adjust crew" value={adjustCrew} onChange={setAdjustCrew} crews={crews} />
        <div className="field"><label htmlFor="pirate-adjust-currency">Currency</label>
          <select id="pirate-adjust-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="bearing">Bearing shards</option><option value="doubloon">Doubloons</option>
          </select></div>
        <div className="field"><label htmlFor="pirate-adjust-amount">Amount</label>
          <input id="pirate-adjust-amount" type="number" min="1" max="1000" step="1" value={amount}
            onChange={(event) => setAmount(event.target.value)} /></div>
        <Reason id="pirate-adjust-reason" label="Reason (shown to the crew)" value={reason} onChange={setReason} />
        <div className="row">
          <button type="button" disabled={!canAdjust} onClick={() => adjust(1)}>Add</button>
          <button type="button" disabled={!canAdjust} onClick={() => adjust(-1)}>Remove</button>
        </div>
      </form>
      <Outcome outcome={adjusting.outcome} onDismiss={adjusting.clear} />
    </>}
  </section>
}
