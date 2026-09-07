import { useState } from 'react'
import { timeAgo } from '../lib/geo'

export default function PlayersPanel({ members, positions, uid, game, setMemberRole, removeMember, updateGame }) {
  const gmCount = members.filter((m) => m.role === 'gm').length
  const [busy, setBusy] = useState(null)
  const [outcome, setOutcome] = useState(null)

  async function act(profileId, label, action) {
    if (busy) return
    setBusy(profileId); setOutcome(null)
    try {
      const error = await action()
      setOutcome(error ? { tone: 'error', text: `${label} failed: ${error.message}` } : { tone: 'ok', text: `${label}.` })
    } catch (error) {
      setOutcome({ tone: 'error', text: `${label} failed: ${error.message}` })
    } finally { setBusy(null) }
  }

  function remove(m) {
    const name = m.profile?.username ?? 'this member'
    if (!window.confirm(`Remove ${name} from the game? They will need the join code to come back.`)) return
    act(m.profile_id, `Removed ${name}`, () => removeMember(m.profile_id))
  }

  const consentActive = (m) =>
    m.sharing_enabled && m.location_consent_at &&
    (!m.consent_revoked_at || new Date(m.consent_revoked_at) < new Date(m.location_consent_at))

  return (
    <div className="panel-pad">
      <p className="hint mb">
        Players join from the app with code <b style={{ color: 'var(--cyan)' }}>{game.join_code}</b>.
        Location pings older than <input type="number" min="1" style={{ width: 76 }} defaultValue={game.purge_after_days}
          onBlur={(e) => { const v = Number(e.target.value); if (v >= 1 && v !== game.purge_after_days) updateGame({ purge_after_days: v }) }} /> days are deleted automatically.
      </p>
      <table className="grid">
        <thead><tr><th>Member</th><th>Role</th><th>Location sharing</th><th>Last seen</th><th>Battery</th><th></th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.profile_id}>
              <td>{m.profile?.username}{m.profile_id === uid && <span className="hint"> (you)</span>}</td>
              <td>
                <select value={m.role} disabled={busy === m.profile_id || (m.profile_id === uid && m.role === 'gm' && gmCount === 1)}
                  onChange={(e) => act(m.profile_id, `Role of ${m.profile?.username ?? 'member'} set to ${e.target.value === 'gm' ? 'GM' : 'player'}`, () => setMemberRole(m.profile_id, e.target.value))}>
                  <option value="player">player</option>
                  <option value="gm">GM</option>
                </select>
              </td>
              <td>
                {m.role === 'gm' ? <span className="badge-pill gm">GM</span>
                  : consentActive(m) ? <span className="badge-pill on">sharing</span>
                  : <span className="badge-pill off">not sharing</span>}
              </td>
              <td className="hint">{timeAgo(positions[m.profile_id]?.recorded_at)}</td>
              <td className="hint">{positions[m.profile_id]?.battery_pct != null ? Math.round(positions[m.profile_id].battery_pct) + '%' : '—'}</td>
              <td>{m.profile_id !== uid && <button className="danger" disabled={busy === m.profile_id} onClick={() => remove(m)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {outcome && (
        <div className={`outcome ${outcome.tone === 'error' ? 'outcome-error' : 'outcome-ok'}`} role={outcome.tone === 'error' ? 'alert' : 'status'}>
          <span>{outcome.text}</span>
          <button type="button" className="ghost" onClick={() => setOutcome(null)} aria-label="Dismiss message">Dismiss</button>
        </div>
      )}
      {members.length <= 1 && <p className="hint mt">Just you so far. Share the join code with your players.</p>}
    </div>
  )
}
