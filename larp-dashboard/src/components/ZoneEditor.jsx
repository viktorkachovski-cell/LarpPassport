import { pointEwkt, polygonEwkt } from '../lib/geo'
import Outcome from './Outcome'

export const NEW_ZONE = {
  name: '', zone_type: 'event', warning_distance_m: 50, trigger_mode: 'gm_confirm',
  dwell_seconds: 0, exit_buffer_m: 15, one_shot: false, active: true, message: '',
}

// Editor form state for a saved zone.
export function editorFor(zone) {
  return {
    id: zone.id, shape: zone.shape, name: zone.name, trigger_mode: zone.trigger_mode,
    dwell_seconds: zone.dwell_seconds, exit_buffer_m: zone.exit_buffer_m,
    one_shot: zone.one_shot, active: zone.active, radius_m: zone.radius_m ?? undefined,
    message: zone.payload?.message ?? '', zone_type: zone.zone_type ?? 'event',
    warning_distance_m: zone.warning_distance_m ?? 50,
  }
}

// The row saveZone writes. A play area is always silent, immediate and repeatable.
export function zoneFromEditor(editing) {
  const playArea = editing.zone_type === 'play_area'
  const message = editing.message?.trim()
  const zone = {
    id: editing.id,
    name: editing.name.trim() || 'Unnamed zone',
    zone_type: editing.zone_type,
    warning_distance_m: Math.max(5, Number(editing.warning_distance_m) || 50),
    trigger_mode: playArea ? 'silent' : editing.trigger_mode,
    dwell_seconds: playArea ? 0 : Number(editing.dwell_seconds) || 0,
    exit_buffer_m: Number(editing.exit_buffer_m) || 0,
    one_shot: !playArea && !!editing.one_shot,
    active: !!editing.active,
    radius_m: editing.shape === 'circle' ? Math.max(1, Number(editing.radius_m) || 1) : null,
    payload: message ? { message } : {},
    shape: editing.shape,
  }
  if (!editing.id) zone.geog = editing.shape === 'circle' ? pointEwkt(editing.center.lng, editing.center.lat) : polygonEwkt(editing.points)
  return zone
}

function NumberField({ id, label, value, onChange, min, max }) {
  return <div className="field" style={{ flex: 1 }}><label htmlFor={id}>{label}</label>
    <input id={id} type="number" min={min} max={max} style={{ width: '100%' }} value={value} onChange={onChange} /></div>
}

export function ZoneEditor({ editing, setEditing, saving, outcome, clear, onSave, onClose, onDelete }) {
  const set = (key) => (e) => setEditing({ ...editing, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const event = editing.zone_type === 'event'
  return (
    <div className="side-section">
      <h3>{editing.id ? 'Edit zone' : 'New zone'}</h3>
      <div className="field"><label htmlFor="zone-name">Name</label>
        <input id="zone-name" style={{ width: '100%' }} value={editing.name} onChange={set('name')} /></div>
      <div className="field"><label htmlFor="zone-purpose">Purpose</label>
        <select id="zone-purpose" style={{ width: '100%' }} value={editing.zone_type} onChange={set('zone_type')}>
          <option value="event">Event trigger zone</option>
          <option value="play_area">Time anomaly play area</option>
        </select></div>
      {event && (
        <div className="field"><label htmlFor="zone-trigger">When a player enters</label>
          <select id="zone-trigger" style={{ width: '100%' }} value={editing.trigger_mode} onChange={set('trigger_mode')}>
            <option value="auto">Notify the player automatically</option>
            <option value="gm_confirm">Ask a GM to confirm first</option>
            <option value="silent">Log silently for GMs</option>
          </select></div>
      )}
      <div className="row">
        {event && <NumberField id="zone-dwell" label="Dwell (s)" min="0" value={editing.dwell_seconds} onChange={set('dwell_seconds')} />}
        {editing.zone_type === 'play_area'
          && <NumberField id="zone-warning" label="Edge warning (m)" min="5" max="5000" value={editing.warning_distance_m} onChange={set('warning_distance_m')} />}
        <NumberField id="zone-exit-buffer" label="Exit buffer (m)" min="0" value={editing.exit_buffer_m} onChange={set('exit_buffer_m')} />
        {editing.shape === 'circle' && <NumberField id="zone-radius" label="Radius (m)" min="1" value={editing.radius_m} onChange={set('radius_m')} />}
      </div>
      <div className="row mb">
        {event && <label className="inline"><input type="checkbox" checked={editing.one_shot} onChange={set('one_shot')} /> One-shot per player</label>}
        <label className="inline"><input type="checkbox" checked={editing.active} onChange={set('active')} /> Active</label>
      </div>
      {event && <div className="field"><label htmlFor="zone-message">Message to the player (payload)</label>
        <textarea id="zone-message" rows="2" style={{ width: '100%' }} value={editing.message} onChange={set('message')} /></div>}
      <div className="row">
        <button className="primary" disabled={saving} onClick={onSave}>{saving ? 'Saving…' : editing.id ? 'Save zone' : 'Create zone'}</button>
        <button className="ghost" disabled={saving} onClick={onClose}>Close</button>
        {editing.id && <button className="danger" disabled={saving} onClick={onDelete}>Delete</button>}
      </div>
      {outcome?.tone === 'error' && <Outcome outcome={outcome} onDismiss={clear} />}
    </div>
  )
}
