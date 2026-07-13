import { useState } from 'react'

const KEY_RE = /^[a-z0-9_]{1,32}$/

export default function TemplatePanel({ game, hasCharacters, updateGame }) {
  const [stats, setStats] = useState((game.template?.stats ?? []).map((s) => ({ ...s })))
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const patch = (i, p) => setStats((prev) => prev.map((s, j) => (j === i ? { ...s, ...p } : s)))
  const remove = (i) => setStats((prev) => prev.filter((_, j) => j !== i))
  const add = () => setStats((prev) => [...prev, { key: '', label: '', type: 'number', default: 0, min: 0, max: 10, player_editable: false }])

  async function save() {
    setError(''); setSaved(false)
    const keys = new Set()
    const cleaned = []
    for (const s of stats) {
      const key = (s.key ?? '').trim()
      if (!KEY_RE.test(key)) { setError(`"${key || '(empty)'}" is not a valid key — lowercase letters, digits and _ only.`); return }
      if (keys.has(key)) { setError(`Duplicate key "${key}".`); return }
      keys.add(key)
      const out = { key, label: (s.label ?? '').trim() || key, type: s.type, player_editable: !!s.player_editable }
      if (s.type === 'number') {
        out.default = Number(s.default) || 0
        if (s.min !== '' && s.min !== undefined && s.min !== null) out.min = Number(s.min)
        if (s.max !== '' && s.max !== undefined && s.max !== null) out.max = Number(s.max)
      } else {
        out.default = String(s.default ?? '')
      }
      cleaned.push(out)
    }
    const err = await updateGame({ template: { stats: cleaned } })
    if (err) setError(err.message)
    else { setSaved(true); setTimeout(() => setSaved(false), 1600) }
  }

  return (
    <div className="panel-pad">
      <p className="hint mb">Stats every character in this game will have. Players can only edit fields you mark editable; number fields are clamped to min/max for players.</p>
      {hasCharacters && <p className="hint mb" style={{ color: 'var(--amber)' }}>Characters already exist — renaming a key orphans its stored values. Add new keys instead of renaming when possible.</p>}
      <table className="grid">
        <thead>
          <tr><th>Key</th><th>Label</th><th>Type</th><th>Default</th><th>Min</th><th>Max</th><th>Player editable</th><th></th></tr>
        </thead>
        <tbody>
          {stats.map((s, i) => (
            <tr key={i}>
              <td><input type="text" value={s.key} onChange={(e) => patch(i, { key: e.target.value })} placeholder="hp" /></td>
              <td><input type="text" value={s.label ?? ''} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Hit points" /></td>
              <td>
                <select value={s.type} onChange={(e) => patch(i, { type: e.target.value })}>
                  <option value="number">number</option>
                  <option value="text">text</option>
                </select>
              </td>
              <td><input type={s.type === 'number' ? 'number' : 'text'} value={s.default ?? ''} onChange={(e) => patch(i, { default: e.target.value })} /></td>
              <td>{s.type === 'number' ? <input type="number" value={s.min ?? ''} onChange={(e) => patch(i, { min: e.target.value })} /> : '—'}</td>
              <td>{s.type === 'number' ? <input type="number" value={s.max ?? ''} onChange={(e) => patch(i, { max: e.target.value })} /> : '—'}</td>
              <td><input type="checkbox" checked={!!s.player_editable} onChange={(e) => patch(i, { player_editable: e.target.checked })} /></td>
              <td><button className="danger" onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row mt">
        <button onClick={add}>Add stat</button>
        <button className="primary" onClick={save}>Save template</button>
        {saved && <span className="notice" style={{ margin: 0 }}>Saved</span>}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
