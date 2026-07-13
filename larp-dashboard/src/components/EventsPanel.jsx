import { useMemo, useState } from 'react'
import { timeAgo } from '../lib/geo'

export default function EventsPanel({ events, members, usernameOf, zoneNameOf, confirmEvent, dismissEvent, broadcast, onOpenHunt }) {
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('all')
  const [message, setMessage] = useState('')
  const [sendState, setSendState] = useState('')

  const shown = useMemo(
    () => filter === 'pending' ? events.filter((event) => event.status === 'pending') : events,
    [events, filter],
  )

  function describe(event) {
    if (event.type === 'zone_enter') return `entered ${zoneNameOf(event.zone_id)}`
    if (event.type === 'zone_exit') return `left ${zoneNameOf(event.zone_id)}`
    if (event.type === 'gm_note') return `received GM message: "${event.payload?.message ?? ''}"`
    if (event.type === 'consent_granted') return 'started sharing location'
    if (event.type === 'consent_revoked') return 'stopped sharing location'
    if (event.type === 'hunt_started') return 'received a secret target'
    if (event.type === 'elimination_requested') return 'was asked to confirm an elimination'
    if (event.type === 'elimination_claimed') return 'submitted an elimination claim'
    if (event.type === 'elimination_rejected') return 'received an elimination rejection'
    if (event.type === 'elimination_confirmed') return 'confirmed an elimination and is awaiting the next GM assignment'
    if (event.type === 'eliminated') return 'was eliminated from the hunt'
    if (event.type === 'hunt_finished') return `was notified that ${event.payload?.winner ?? 'a traveller'} won the hunt`
    if (event.type === 'hunt_player_restored') return 'was notified that the GM restored a traveller'
    if (event.type === 'hunt_chain_changed') return 'received a corrected target assignment from the GM'
    if (event.type === 'hunt_target_assigned') return 'received their next target from the GM'
    if (event.type === 'player_message') return `sent the GM: "${event.payload?.message ?? ''}"`
    if (event.type === 'zone_boundary_warning') return `neared the boundary of ${zoneNameOf(event.zone_id)}`
    if (event.type === 'zone_boundary_exit') return `left ${zoneNameOf(event.zone_id)}`
    return event.type
  }

  async function send() {
    if (!message.trim()) return
    const players = members.filter((member) => member.role === 'player').map((member) => member.profile_id)
    const targets = target === 'all' ? players : [target]
    if (targets.length === 0) { setSendState('No players to message yet.'); return }
    const error = await broadcast(targets, message.trim())
    setSendState(error ? error.message : `Sent to ${targets.length} player${targets.length === 1 ? '' : 's'}.`)
    if (!error) setMessage('')
    setTimeout(() => setSendState(''), 2500)
  }

  return (
    <div className="panel-pad events-panel">
      <section className="command-card event-composer">
        <div>
          <span className="micro-label">FIELD BROADCAST</span>
          <h3>Message players</h3>
        </div>
        <div className="broadcast-controls">
          <select aria-label="Message recipients" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="all">All players</option>
            {members.filter((member) => member.role === 'player').map((member) => (
              <option key={member.profile_id} value={member.profile_id}>{member.profile?.username}</option>
            ))}
          </select>
          <input placeholder="Message players - appears in their app instantly" value={message}
            onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} />
          <button className="primary" disabled={!message.trim()} onClick={send}>Send broadcast</button>
        </div>
        {sendState && <span className="notice inline-notice">{sendState}</span>}
      </section>

      <div className="event-toolbar">
        <div><span className="micro-label">EVENT STREAM</span><h2>Timeline activity</h2></div>
        <div className="filter-group">
          <button className={filter === 'all' ? 'primary' : 'ghost'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'pending' ? 'primary' : 'ghost'} onClick={() => setFilter('pending')}>Pending</button>
        </div>
      </div>

      <div className="event-card-list">
        {shown.map((event) => {
          const breach = event.type === 'zone_boundary_exit'
          const playerMessage = event.type === 'player_message'
          const boundary = breach || event.type === 'zone_boundary_warning'
          const actor = event.profile_id ? usernameOf(event.profile_id) : 'System'
          const kind = playerMessage ? 'PLAYER MESSAGE' : breach ? `BREACH${event.status === 'pending' ? ' // PENDING' : ''}` : boundary ? 'BOUNDARY' : event.type.replaceAll('_', ' ').toUpperCase()
          return (
            <article key={event.id} className={`timeline-event-card ${breach ? 'breach-card' : ''} ${playerMessage ? 'player-message-card' : ''}`}>
              <div className="event-card-top">
                <span className={`event-kind ${breach ? 'critical' : playerMessage ? 'cyan' : boundary ? 'warning' : ''}`}>{kind}</span>
                <time>{timeAgo(event.created_at)} // {new Date(event.created_at).toLocaleTimeString()}</time>
              </div>
              <h3>{playerMessage ? <><b>{actor}</b>: "{event.payload?.message ?? ''}"</> : <><b>{actor}</b> {describe(event)}</>}</h3>
              {breach && <p>Any pending claim was rejected automatically. Review GPS drift before making an elimination ruling.</p>}
              {event.payload?.message && event.type === 'zone_enter' && <p>Player message: "{event.payload.message}"</p>}
              {event.status === 'pending' && (
                <div className="event-actions">
                  <button className="primary" onClick={() => confirmEvent(event)}>{breach ? 'Confirm breach' : 'Confirm'}</button>
                  <button className="ghost" onClick={() => dismissEvent(event)}>Dismiss</button>
                  {breach && <button className="danger" onClick={() => onOpenHunt?.()}>Eliminate via Hunt</button>}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {shown.length === 0 && <p className="hint empty-state">No events match this filter.</p>}
    </div>
  )
}
