import { useMemo, useState } from 'react'
import { timeAgo } from '../lib/geo'

export default function EventsPanel({ events, pendingEvents = [], loadOlder, hasMore, historyBusy, members, usernameOf, zoneNameOf, confirmEvent, dismissEvent, broadcast, onOpenHunt }) {
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('all')
  const [message, setMessage] = useState('')
  // Outcomes stay visible until dismissed or superseded by the next action.
  const [sendState, setSendState] = useState(null) // { tone, text }
  const [sending, setSending] = useState(false)
  const [decision, setDecision] = useState(null) // { tone, text }
  const [busyEvent, setBusyEvent] = useState(null)

  const shown = useMemo(
    () => filter === 'pending' ? pendingEvents : events,
    [events, pendingEvents, filter],
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
    if (!message.trim() || sending) return
    const players = members.filter((member) => member.role === 'player').map((member) => member.profile_id)
    const targets = target === 'all' ? players : [target]
    if (targets.length === 0) { setSendState({ tone: 'error', text: 'No players to message yet.' }); return }
    setSending(true); setSendState(null)
    try {
      const error = await broadcast(targets, message.trim())
      if (error) { setSendState({ tone: 'error', text: `Not sent: ${error.message}` }); return }
      setSendState({ tone: 'ok', text: `Sent to ${targets.length} player${targets.length === 1 ? '' : 's'}.` })
      setMessage('')
    } catch (error) {
      setSendState({ tone: 'error', text: `Not sent: ${error.message}` })
    } finally { setSending(false) }
  }

  async function decide(event, action) {
    if (busyEvent) return
    setBusyEvent(event.id); setDecision(null)
    const who = event.profile_id ? usernameOf(event.profile_id) : 'System'
    const what = event.type === 'zone_boundary_exit' ? 'breach' : 'event'
    try {
      const error = await (action === 'confirm' ? confirmEvent(event) : dismissEvent(event))
      if (error) { setDecision({ tone: 'error', text: `Could not ${action} the ${what} for ${who}: ${error.message}` }); return }
      setDecision({ tone: 'ok', text: action === 'confirm' ? `${what === 'breach' ? 'Breach' : 'Event'} confirmed for ${who}.` : `${what === 'breach' ? 'Breach' : 'Event'} dismissed for ${who}.` })
    } catch (error) {
      setDecision({ tone: 'error', text: `Could not ${action} the ${what} for ${who}: ${error.message}` })
    } finally { setBusyEvent(null) }
  }

  const outcome = (state, clear) => state && (
    <div className={`outcome ${state.tone === 'error' ? 'outcome-error' : 'outcome-ok'}`} role={state.tone === 'error' ? 'alert' : 'status'}>
      <span>{state.text}</span>
      <button type="button" className="ghost" onClick={clear} aria-label="Dismiss message">Dismiss</button>
    </div>
  )

  return (
    <div className="panel-pad events-panel">
      <section className="command-card event-composer">
        <div>
          <span className="micro-label">MESSAGE PLAYERS</span>
          <h3>Message players</h3>
        </div>
        <div className="broadcast-controls">
          <select aria-label="Message recipients" value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="all">All players</option>
            {members.filter((member) => member.role === 'player').map((member) => (
              <option key={member.profile_id} value={member.profile_id}>{member.profile?.username}</option>
            ))}
          </select>
          <input aria-label="Message to players" placeholder="Message to players - appears in their app" value={message}
            onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} />
          <button className="primary" disabled={!message.trim() || sending} onClick={send}>{sending ? 'Sending…' : 'Send message'}</button>
        </div>
        {outcome(sendState, () => setSendState(null))}
      </section>

      {outcome(decision, () => setDecision(null))}

      <div className="event-toolbar">
        <div><span className="micro-label">EVENT LOG</span><h2>Events</h2></div>
        <div className="filter-group" role="group" aria-label="Event filter">
          <button className={filter === 'all' ? 'primary' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'pending' ? 'primary' : 'ghost'} aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>Pending</button>
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
              {breach && <p>Claims made before the recorded exit may have been rejected. Review the sample time and GPS drift before ruling.</p>}
              {event.payload?.message && event.type === 'zone_enter' && <p>Player message: "{event.payload.message}"</p>}
              {event.status === 'pending' && (
                <div className="event-actions">
                  <button className="primary" aria-label={`${breach ? 'Confirm breach' : 'Confirm'} for ${actor}`} disabled={busyEvent === event.id} onClick={() => decide(event, 'confirm')}>{breach ? 'Confirm breach' : 'Confirm'}</button>
                  <button className="ghost" aria-label={`Dismiss event for ${actor}`} disabled={busyEvent === event.id} onClick={() => decide(event, 'dismiss')}>Dismiss</button>
                  {breach && <button className="danger" onClick={() => onOpenHunt?.()}>Eliminate via Hunt</button>}
                </div>
              )}
            </article>
          )
        })}
      </div>
      {filter === 'all' && hasMore && <button disabled={historyBusy} onClick={loadOlder}>{historyBusy ? 'Loading...' : 'Load older events'}</button>}
      {shown.length === 0 && <p className="hint empty-state">No events match this filter.</p>}
    </div>
  )
}
