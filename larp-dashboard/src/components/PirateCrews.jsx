// Crew scoreboard. During setup the GM picks the captain of each crew with
// two or more players; a one-player crew's player is captain automatically.
// Captains lock when charting starts, and only the captain has the compass.
export default function PirateCrews({ gameId, state, busy, run, rpc, refresh }) {
  const canChoose = state.phase === 'setup'

  function chooseCaptain(crew, captain) {
    run(async () => {
      await rpc('pirate_set_captain', { g: gameId, crew: crew.id, captain })
      refresh()
    }, { success: `Captain set for ${crew.name}.` })
  }

  function captainCell(crew) {
    const members = crew.members ?? []
    const captain = members.find((member) => member.profile_id === crew.captain_id)
    if (!canChoose || members.length < 2) return captain?.name ?? 'None'
    return <select aria-label={`Captain of ${crew.name}`} value={crew.captain_id ?? ''} disabled={!!busy}
      onChange={(event) => event.target.value && chooseCaptain(crew, event.target.value)}>
      <option value="">Choose captain</option>
      {members.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.name}</option>)}
    </select>
  }

  return <section className="command-card pirate-section">
    <h3>Crews</h3>
    <p className="hint">{canChoose
      ? 'Choose a captain for every crew of two or more. Only the captain sees the compass. Captains lock when charting starts.'
      : 'Captains are locked. Only the captain sees the compass.'}</p>
    <div className="table-scroll"><table className="grid">
      <thead><tr><th>Crew</th><th>Captain</th><th>Players</th><th>Shards</th><th>Doubloons</th><th>Oath</th><th>Readings</th></tr></thead>
      <tbody>{(state.crews ?? []).map((crew) => <tr key={crew.id}>
        <td>{crew.name}</td><td>{captainCell(crew)}</td><td>{crew.members?.length ?? 0}</td>
        <td>{crew.shards}</td><td>{crew.doubloons}</td>
        <td>{crew.oath_count}/4</td><td>{crew.reading_count}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}
