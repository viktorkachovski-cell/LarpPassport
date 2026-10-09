import { useState } from 'react'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'
import TableScroll from './TableScroll'

const KEY_RE = /^[a-z0-9_]{1,32}$/
const present = (value) => value !== '' && value !== undefined && value !== null

// A stat as stored: trimmed label, typed default, numeric bounds when given.
function cleanStat(s, key) {
  const out = { key, label: (s.label ?? '').trim() || key, type: s.type, player_editable: !!s.player_editable }
  if (s.type !== 'number') return { ...out, default: String(s.default ?? '') }
  out.default = Number(s.default) || 0
  if (present(s.min)) out.min = Number(s.min)
  if (present(s.max)) out.max = Number(s.max)
  return out
}

export default function TemplatePanel({ game, hasCharacters, updateGame }) {
  const [stats, setStats] = useState((game.template?.stats ?? []).map((s) => ({ ...s })))
  const { busy, outcome, setOutcome, clear, run } = useAction()

  const patch = (i, p) => setStats((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const remove = (i) => setStats((prev) => prev.filter((_, j) => j !== i))
  const add = () => setStats((prev) => [...prev, { key: '', label: '', type: 'number', default: 0, min: 0, max: 10, player_editable: false }])

  function save() {
    if (busy) return
    const invalid = (text) => setOutcome({ tone: 'error', text })
    const keys = new Set()
    const cleaned = []
    for (const s of stats) {
      const key = (s.key ?? '').trim()
      if (!KEY_RE.test(key)) { invalid(`"${key || '(empty)'}" is not a valid key — lowercase letters, digits and _ only.`); return }
      if (keys.has(key)) { invalid(`Duplicate key "${key}".`); return }
      keys.add(key)
      cleaned.push(cleanStat(s, key))
    }
    run(() => updateGame({ template: { stats: cleaned } }), { success: 'Template saved.' })
  }

  return (
    <div className="panel-pad">
      <p className="hint mb">Stats every character in this game will have. Players can only edit fields you mark editable; number fields are clamped to min/max for players.</p>
      {hasCharacters && <p className="hint mb" style={{ color: 'var(--amber)' }}>Characters already exist — renaming a key orphans its stored values. Add new keys instead of renaming when possible.</p>}
      <TableScroll label="Template stats table">
      <table className="grid">
        <thead>
          <tr><th>Key</th><th>Label</th><th>Type</th><th>Default</th><th>Min</th><th>Max</th><th>Player editable</th><th><span className="visually-hidden">Actions</span></th></tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={i}>
              <td><input type="text" aria-label={`Key for stat ${i + 1}`} value={s.key} onChange={(e) => patch(i, { key: e.target.value })} placeholder="notes" /></td>
              <td><input type="text" aria-label={`Label for stat ${s.key || i + 1}`} value={s.label ?? ''} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Notes" /></td>
              <td>
                <select aria-label={`Type for stat ${s.key || i + 1}`} value={s.type} onChange={(e) => patch(i, { type: e.target.value })}>
                  <option value="number">number</option>
                  <option value="text">text</option>
                </select>
              </td>
              <td><input type={s.type === 'number' ? 'number' : 'text'} aria-label={`Default for stat ${s.key || i + 1}`} value={s.default ?? ''} onChange={(e) => patch(i, { default: e.target.value })} /></td>
              <td>{s.type === 'number' ? <input type="number" aria-label={`Minimum for stat ${s.key || i + 1}`} value={s.min ?? ''} onChange={(e) => patch(i, { min: e.target.value })} /> : '—'}</td>
              <td>{s.type === 'number' ? <input type="number" aria-label={`Maximum for stat ${s.key || i + 1}`} value={s.max ?? ''} onChange={(e) => patch(i, { max: e.target.value })} /> : '—'}</td>
              <td><input type="checkbox" aria-label={`Player editable: stat ${s.key || i + 1}`} checked={!!s.player_editable} onChange={(e) => patch(i, { player_editable: e.target.checked })} /></td>
              <td><button className="danger" aria-label={`Remove stat ${s.key || i + 1}`} onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
      <div className="row mt">
        <button onClick={add}>Add stat</button>
        <button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
      <Outcome outcome={outcome} onDismiss={clear} />
    </div>
  )
}
