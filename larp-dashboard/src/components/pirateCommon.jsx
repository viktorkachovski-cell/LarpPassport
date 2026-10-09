// Inputs and labels shared by the Pirate GM sections. Every audited GM change needs a reason.
export const validReason = (reason) => reason.trim().length >= 3
export const parleyTitle = (parley) => `${parley.target_name} / ${parley.attacker_name ?? 'waiting'}`

export function Reason({ id, label, value, onChange }) {
  return <div className="field"><label htmlFor={id}>{label}</label>
    <input id={id} value={value} required minLength={3} maxLength={300} onChange={(event) => onChange(event.target.value)} /></div>
}

// A crew id that left the list reads as unselected.
export function CrewSelect({ id, label, value, onChange, crews, empty = 'Choose crew', disabled }) {
  return <div className="field"><label htmlFor={id}>{label}</label>
    <select id={id} value={crews.some((crew) => crew.id === value) ? value : ''} disabled={disabled}
      onChange={(event) => onChange(event.target.value)}>
      <option value="">{empty}</option>
      {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
    </select></div>
}
