import { useEffect, useState } from 'react'
import { Reason, validReason } from './pirateCommon'

export const RULE_FIELDS = [
  ['treasure_percent', 'Treasure percentage (maximum 1000 doubloons)', 40, 0, 100],
  ['yield_percent', 'Yield percentage', 10, 0, 100],
  ['yield_min', 'Yield minimum doubloons', 3, 0, 1000],
  ['fight_percent', 'Fight percentage', 25, 0, 100],
  ['fight_min', 'Fight minimum doubloons', 5, 0, 1000],
  ['mercy_seconds', 'Automatic Mercy seconds', 900, 0, 7200],
  ['pair_cooldown_seconds', 'Crew-pair cooldown seconds', 1800, 0, 7200],
  ['attack_window_seconds', 'Attacking window seconds', 3600, 60, 86400],
  ['attack_limit', 'Attacks allowed in that window', 3, 1, 100],
  ['code_ttl_seconds', 'Code validity seconds', 90, 30, 600],
  ['session_timeout_seconds', 'Parley inactivity seconds', 300, 60, 3600],
  ['answer_lockout_seconds', 'Wrong-answer lockout seconds', 120, 30, 600],
  ['answer_attempt_limit', 'Wrong answers before lockout', 3, 1, 10],
]
const DEFAULTS = Object.fromEntries(RULE_FIELDS.map(([key, , value]) => [key, value]))
DEFAULTS.riddle_payouts = [20, 15, 10, 5]

function makeDraft(settings) {
  return { ...settings, riddle_payouts: settings.riddle_payouts.join(', ') }
}

export default function PirateSettings({ gameId, state, busy, run, rpc, refresh }) {
  const current = { ...DEFAULTS, ...state.settings }
  const currentJson = JSON.stringify(current)
  const [base, setBase] = useState(current)
  const [draft, setDraft] = useState(() => makeDraft(current))
  const [dirty, setDirty] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (dirty) return
    const settings = JSON.parse(currentJson)
    setBase(settings); setDraft(makeDraft(settings))
  }, [currentJson, dirty])

  const payoutTokens = draft.riddle_payouts.split(',').map((value) => value.trim())
  const payouts = payoutTokens.map(Number)
  const validPayouts = payoutTokens.every((value) => value !== '') && payouts.length >= 1 && payouts.length <= 20
    && payouts.every((value) => Number.isInteger(value) && value >= 0 && value <= 1000)
  const validNumbers = RULE_FIELDS.every(([key, , , min, max]) => draft[key] !== ''
    && Number.isInteger(Number(draft[key])) && Number(draft[key]) >= min && Number(draft[key]) <= max)
  const changedElsewhere = dirty && JSON.stringify(base) !== currentJson
  function edit(key, value) { setDirty(true); setDraft((previous) => ({ ...previous, [key]: value })) }
  function discard() { refresh(); setDirty(false); setReason(''); setBase(current); setDraft(makeDraft(current)) }
  function save(event) {
    event.preventDefault()
    if (!window.confirm('Change rules for future claims and new Parleys? Existing encounter terms, rewards and frozen hoard value will stay fixed.')) return
    run(async () => {
      const settings = Object.fromEntries(RULE_FIELDS.map(([key]) => [key, Number(draft[key])]))
      settings.riddle_payouts = payouts
      await rpc('gm_set_pirate_settings', { g: gameId, settings, reason, expected_settings: base })
      setDirty(false); setReason(''); refresh()
    }, { success: 'Rules saved. Existing outcomes and encounter terms are preserved.' })
  }

  return <section className="command-card pirate-section">
    <h3>Payouts and timers</h3>
    <p className="hint">Changes require a reason and apply to new claims and new Parleys. Existing Parleys keep their original terms, and existing Mercy, answer lockouts and pair cooldowns retain their deadlines. Treasure percentage changes apply only before its value is first frozen. GPS freshness and proximity checks remain fixed.</p>
    {changedElsewhere && <p role="alert">Another GM changed the settings. Reload current settings before saving.</p>}
    <form onSubmit={save} className="pirate-form-grid">
      <div className="field pirate-wide"><label htmlFor="pirate-riddle-payouts">Riddle payouts by rank</label>
        <input id="pirate-riddle-payouts" value={draft.riddle_payouts} required onChange={(event) => edit('riddle_payouts', event.target.value)} />
        <p className="hint">Comma-separated whole doubloons, 0–1000 each. The last amount repeats for every later crew.</p>
      </div>
      {RULE_FIELDS.map(([key, label, , min, max]) => <div className="field" key={key}>
        <label htmlFor={'pirate-setting-' + key}>{label}</label>
        <input id={'pirate-setting-' + key} type="number" min={min} max={max} step="1" required value={draft[key]}
          onChange={(event) => edit(key, event.target.value)} />
      </div>)}
      <Reason id="pirate-settings-reason" label="Settings change reason" value={reason} onChange={setReason} />
      <div className="row">
        <button type="submit" disabled={!!busy || state.phase === 'finished' || !dirty || changedElsewhere || !validPayouts || !validNumbers || !validReason(reason)}>Save rules</button>
        <button type="button" disabled={!!busy} onClick={discard}>Reload current settings</button>
      </div>
    </form>
  </section>
}
