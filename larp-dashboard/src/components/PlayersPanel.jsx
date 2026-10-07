import { formatAge } from '../lib/time'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'
import TableScroll from './TableScroll'

export default function PlayersPanel({ members, positions, uid, game, setMemberRole, removeMember, updateGame }) {
  const gmCount = members.filter((m) => m.role === 'gm').length
  const { busy, outcome, clear, run } = useAction()

  function act(profileId, label, action) {
    run(action, { key: profileId, success: `${label}.`, failure: (reason) => `${label} failed: ${reason}` })
  }

  function setRetention(days) {
    if (!(days >= 1) || days === game.purge_after_days) return
    run(() => updateGame({ purge_after_days: days }), { key: 'retention', failure: (reason) => `Retention change failed: ${reason}` })
  }

  function remove(m) {
    const name = m.profile?.username ?? 'this member'
    if (!window.confirm(`Remove ${name} from the game? They will need the join code to come back.`)) return
    act(m.profile_id, `Removed ${name}`, () => removeMember(m.profile_id))
  }

  return (
    <div className="panel-pad">
      <p className="hint mb">
        Players join from the app with join code <b style={{ color: 'var(--cyan)' }}>{game.join_code}</b>.
        Location pings older than <input type="number" min="1" max="90" aria-label="Days to keep location pings" style={{ width: 76 }} defaultValue={game.purge_after_days}
          onBlur={(e) => setRetention(Number(e.target.value))} /> days are deleted automatically.
      </p>
      <TableScroll label="Members table">
      <table className="grid">
        <thead><tr><th>Member</th><th>Role</th><th>Location sharing</th><th>Last seen</th><th>Battery</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.profile_id}>
              <td>{m.profile?.username}{m.profile_id === uid && <span className="hint"> (you)</span>}</td>
              <td>
                <select aria-label={`Role for ${m.profile?.username ?? 'member'}`} value={m.role} disabled={busy === m.profile_id || (m.profile_id === uid && m.role === 'gm' && gmCount === 1)}
                  onChange={(e) => act(m.profile_id, `Role of ${m.profile?.username ?? 'member'} set to ${e.target.value === 'gm' ? 'GM' : 'player'}`, () => setMemberRole(m.profile_id, e.target.value))}>
                  <option value="player">player</option>
                  <option value="gm">GM</option>
                </select>
              </td>
              <td>
                {m.role === 'gm' ? <span className="badge-pill gm">GM</span>
                  : m.sharing_enabled ? <span className="badge-pill on">sharing on</span>
                  : <span className="badge-pill off">sharing off</span>}
              </td>
              <td className="hint">{formatAge(positions[m.profile_id]?.recorded_at) ?? '—'}</td>
              <td className="hint">{positions[m.profile_id]?.battery_pct != null ? Math.round(positions[m.profile_id].battery_pct) + '%' : '—'}</td>
              <td>{m.profile_id !== uid && <button className="danger" aria-label={`Remove ${m.profile?.username ?? 'member'}`} disabled={busy === m.profile_id} onClick={() => remove(m)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
      <Outcome outcome={outcome} onDismiss={clear} />
      {members.length <= 1 && <p className="hint mt">Just you so far. Share the join code with your players.</p>}
    </div>
  )
}
