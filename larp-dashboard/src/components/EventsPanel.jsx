import { useMemo, useState } from 'react'
import { timeAgo } from '../lib/geo'

export default function EventsPanel({ events, members, usernameOf, zoneNameOf, confirmEvent, dismissEvent, broadcast }) {
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('all')
  const [message, setMessage] = useState('')
  const [sendState, setSendState] = useState('')

  const shown = useMemo(
    () => (filter === 'pending' ? events.filter((e) => e.status === 'pending') : events),
    [events, filter]
  )

  function describe(e) {
    if (e.type === 'zone_enter') return `entered ${zoneNameOf(e.zone_id)}`
    if (e.type === 'zone_exit') return `left ${zoneNameOf(e.zone_id)}`
    if (e.type === 'gm_note') return `GM message: “${e.payload?.message ?? ''}”`
    if (e.type === 'consent_granted') return 'started sharing location'
    if (e.type === 'consent_revoked') return 'stopped sharing location'
    return e.type
  }

  async function send() {
    if (!message.trim()) return
    const players = members.filter((m) => m.role === 'player').map((m) => m.profile_id)
    const targets = target === 'all' ? players : [target]
    if (targets.length === 0) { setSendState('No players to message yet.'); return }
    const err = await broadcast(targets, message.trim())
    setSendState(err ? err.message : `Sent to ${targets.length} player${targets.length === 1 ? '' : 's'}.`)
    if (!err) setMessage('')
    setTimeout(() => setSendState(''), 2500)
  }

  return (
    <div className="panel-pad">
      <div className="row mb">
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="all">All players</option>
          {members.filter((m) => m.role === 'player').map((m) => (
            <option key={m.profile_id} value={m.profile_id}>{m.profile?.username}</option>
          ))}
        </select>
        <input style={{ flex: 1, minWidth: 220 }} placeholder="Message players — appears in their app instantly"
          value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="primary" onClick={send}>Send</button>
        {sendState && <span className="hint">{sendState}</span>}
      </div>

      <div className="row mb">
        <button className={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>All</button>
        <button className={filter === 'pending' ? 'primary' : 'ghost'} onClick={() => setFilter('pending')}>Pending</button>
      </div>

      {shown.map((e) => (
        <div key={e.id} className="event-row">
          <span className="time">{new Date(e.created_at).toLocaleTimeString()}</span>
          <span className={`status ${e.status}`}>{e.status}</span>
          <span style={{ flex: 1 }}>
            <b>{e.profile_id ? usernameOf(e.profile_id) : '—'}</b> {describe(e)}
            {e.payload?.message && e.type === 'zone_enter' ? <span className="hint"> · “{e.payload.message}”</span> : null}
          </span>
          <span className="hint">{timeAgo(e.created_at)}</span>
          {e.status === 'pending' && (
            <span className="row">
              <button className="primary" onClick={() => confirmEvent(e)}>Confirm</button>
              <button className="ghost" onClick={() => dismissEvent(e)}>Dismiss</button>
            </span>
          )}
        </div>
      ))}
      {shown.length === 0 && <p className="hint">No events yet.</p>}
    </div>
  )
}
