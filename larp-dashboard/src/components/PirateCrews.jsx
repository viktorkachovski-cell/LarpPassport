import { useState } from 'react'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'

// Crew scoreboard. During setup the GM picks the captain of each crew with
// two or more players; a one-player crew's player is captain automatically.
// Initial selection locks at charting; audited replacement lives in GM controls.
// Only the current captain has the compass.
// A crew left without a captain later (players added during the game) can
// still get one. The GM can add or remove a crew's shards or doubloons with a
// reason (gm_adjust); the crew reads the ruling in its logbook.
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
    && amountValue >= 1 && amountValue <= 1000 && reason.trim().length >= 3

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
        <div className="field"><label htmlFor="pirate-adjust-crew">Adjust crew</label>
          <select id="pirate-adjust-crew" value={adjustTarget ? adjustCrew : ''} onChange={(event) => setAdjustCrew(event.target.value)}>
            <option value="">Choose crew</option>
            {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="pirate-adjust-currency">Currency</label>
          <select id="pirate-adjust-currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="bearing">Bearing shards</option><option value="doubloon">Doubloons</option>
          </select></div>
        <div className="field"><label htmlFor="pirate-adjust-amount">Amount</label>
          <input id="pirate-adjust-amount" type="number" min="1" max="1000" step="1" value={amount}
            onChange={(event) => setAmount(event.target.value)} /></div>
        <div className="field"><label htmlFor="pirate-adjust-reason">Reason (shown to the crew)</label>
          <input id="pirate-adjust-reason" value={reason} minLength={3} maxLength={300}
            onChange={(event) => setReason(event.target.value)} /></div>
        <div className="row">
          <button type="button" disabled={!canAdjust} onClick={() => adjust(1)}>Add</button>
          <button type="button" disabled={!canAdjust} onClick={() => adjust(-1)}>Remove</button>
        </div>
      </form>
      <Outcome outcome={adjusting.outcome} onDismiss={adjusting.clear} />
    </>}
  </section>
}
