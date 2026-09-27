import { useMemo, useState } from 'react'
import { eventInfo, eventKind } from '../lib/events'
import { formatAge } from '../lib/time'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'

export default function EventsPanel({ events, pendingEvents = [], loadOlder, hasMore, historyBusy, members, usernameOf, zoneNameOf, confirmEvent, dismissEvent, broadcast, onOpenHunt }) {
  const [filter, setFilter] = useState('all')
  const [target, setTarget] = useState('all')
  const [message, setMessage] = useState('')
  const composer = useAction()
  const ruling = useAction()

  const shown = useMemo(
    () => filter === 'pending' ? pendingEvents : events,
    [events, pendingEvents, filter],
  )

  function send() {
    if (!message.trim()) return
    const players = members.filter((member) => member.role === 'player').map((member) => member.profile_id)
    const targets = target === 'all' ? players : [target]
    if (targets.length === 0) { composer.setOutcome({ tone: 'error', text: 'No players to message yet.' }); return }
    composer.run(() => broadcast(targets, message.trim()), {
      success: `Sent to ${targets.length} player${targets.length === 1 ? '' : 's'}.`,
      failure: (reason) => `Not sent: ${reason}`,
      onSuccess: () => setMessage(''),
    })
  }

  function decide(event, action) {
    const who = event.profile_id ? usernameOf(event.profile_id) : 'System'
    const what = eventInfo(event.type).breach ? 'breach' : 'event'
    ruling.run(() => (action === 'confirm' ? confirmEvent(event) : dismissEvent(event)), {
      key: event.id,
      success: `${what === 'breach' ? 'Breach' : 'Event'} ${action === 'confirm' ? 'confirmed' : 'dismissed'} for ${who}.`,
      failure: (reason) => `Could not ${action} the ${what} for ${who}: ${reason}`,
    })
  }

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
          <button className="primary" disabled={!message.trim() || composer.busy} onClick={send}>{composer.busy ? 'Sending…' : 'Send message'}</button>
        </div>
        <Outcome outcome={composer.outcome} onDismiss={composer.clear} />
      </section>

      <Outcome outcome={ruling.outcome} onDismiss={ruling.clear} />

      <div className="event-toolbar">
        <div><span className="micro-label">EVENT LOG</span><h2>Events</h2></div>
        <div className="filter-group" role="group" aria-label="Event filter">
          <button className={filter === 'all' ? 'primary' : 'ghost'} aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
          <button className={filter === 'pending' ? 'primary' : 'ghost'} aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>Pending</button>
        </div>
      </div>

      <div className="event-card-list">
        {shown.map((event) => {
          const { describe, tone, breach, quotesMessage, echoesPayload } = eventInfo(event.type)
          const actor = event.profile_id ? usernameOf(event.profile_id) : 'System'
          return (
            <article key={event.id} className={`timeline-event-card ${breach ? 'breach-card' : ''} ${quotesMessage ? 'player-message-card' : ''}`}>
              <div className="event-card-top">
                <span className={`event-kind ${tone}`}>{eventKind(event)}</span>
                <time>{formatAge(event.created_at)} // {new Date(event.created_at).toLocaleTimeString()}</time>
              </div>
              <h3>{quotesMessage ? <><b>{actor}</b>: "{event.payload?.message ?? ''}"</> : <><b>{actor}</b> {describe(event, zoneNameOf)}</>}</h3>
              {breach && <p>Claims made before the recorded exit may have been rejected. Review the sample time and GPS drift before ruling.</p>}
              {event.payload?.message && echoesPayload && <p>Player message: "{event.payload.message}"</p>}
              {event.status === 'pending' && (
                <div className="event-actions">
                  <button className="primary" aria-label={`${breach ? 'Confirm breach' : 'Confirm'} for ${actor}`} disabled={ruling.busy === event.id} onClick={() => decide(event, 'confirm')}>{breach ? 'Confirm breach' : 'Confirm'}</button>
                  <button className="ghost" aria-label={`Dismiss event for ${actor}`} disabled={ruling.busy === event.id} onClick={() => decide(event, 'dismiss')}>Dismiss</button>
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
