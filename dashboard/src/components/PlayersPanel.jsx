import { timeAgo } from '../lib/geo'

export default function PlayersPanel({ members, positions, uid, game, setMemberRole, removeMember, updateGame }) {
  const gmCount = members.filter((m) => m.role === 'gm').length

  const consentActive = (m) =>
    m.sharing_enabled && m.location_consent_at &&
    (!m.consent_revoked_at || new Date(m.consent_revoked_at) < new Date(m.location_consent_at))

  return (
    <div className="panel-pad">
      <p className="hint mb">
        Players join from the app with code <b style={{ color: 'var(--brass)' }}>{game.join_code}</b>.
        Location pings older than <input type="number" min="1" style={{ width: 60 }} defaultValue={game.purge_after_days}
          onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v !== game.purge_after_days) updateGame({ purge_after_days: v }) }} /> days are deleted automatically.
      </p>
      <table className="grid">
        <thead><tr><th>Member</th><th>Role</th><th>Location sharing</th><th>Last seen</th><th>Battery</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.profile_id}>
              <td>{m.profile?.username}{m.profile_id === uid && <span className="hint"> (you)</span>}</td>
              <td>
                <select value={m.role} disabled={m.profile_id === uid && m.role === 'gm' && gmCount === 1}
                  onChange={(e) => setMemberRole(m.profile_id, e.target.value)}>
                  <option value="player">player</option>
                  <option value="gm">GM</option>
                </select>
              </td>
              <td>
                {m.role === 'gm' ? <span className="badge-pill gm">GM</span>
                  : consentActive(m) ? <span className="badge-pill on">sharing</span>
                  : <span className="badge-pill off">not sharing</span>}
              </td>
              <td className="hint">{timeAgo(positions[m.profile_id]?.updated_at)}</td>
              <td className="hint">{positions[m.profile_id]?.battery_pct != null ? Math.round(positions[m.profile_id].battery_pct) + '%' : '—'}</td>
              <td>{m.profile_id !== uid && <button className="danger" onClick={() => removeMember(m.profile_id)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {members.length <= 1 && <p className="hint mt">Just you so far. Share the join code with your players.</p>}
    </div>
  )
}
