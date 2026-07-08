import { Fragment, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/geo'

export default function CharactersPanel({ game, characters, members, factions, usernameOf, saveCharacter, addNpc, deleteCharacter, addFaction }) {
  const stats = game.template?.stats ?? []
  const [drafts, setDrafts] = useState({})
  const [npcName, setNpcName] = useState('')
  const [facName, setFacName] = useState('')
  const [facColor, setFacColor] = useState('#c9a227')
  const [auditFor, setAuditFor] = useState(null)
  const [audit, setAudit] = useState([])
  const [error, setError] = useState('')

  const draftOf = (c) => drafts[c.id] ?? { name: c.name, faction_id: c.faction_id ?? '', fields: { ...(c.fields ?? {}) } }
  const isDirty = (c) => {
    const d = drafts[c.id]
    if (!d) return false
    return d.name !== c.name || (d.faction_id || null) !== (c.faction_id ?? null) || JSON.stringify(d.fields) !== JSON.stringify(c.fields ?? {})
  }
  const patchDraft = (c, patch) => setDrafts((prev) => ({ ...prev, [c.id]: { ...draftOf(c), ...patch } }))
  const patchField = (c, key, value) => patchDraft(c, { fields: { ...draftOf(c).fields, [key]: value } })

  async function save(c) {
    setError('')
    const d = draftOf(c)
    const fields = { ...d.fields }
    for (const s of stats) {
      if (s.type === 'number' && fields[s.key] !== undefined) {
        const n = Number(fields[s.key])
        fields[s.key] = Number.isFinite(n) ? n : (s.default ?? 0)
      }
    }
    const err = await saveCharacter(c.id, { name: d.name.trim() || c.name, faction_id: d.faction_id || null, fields })
    if (err) { setError(`${c.name}: ${err.message}`); return }
    setDrafts((prev) => { const n = { ...prev }; delete n[c.id]; return n })
  }

  async function showAudit(c) {
    if (auditFor === c.id) { setAuditFor(null); return }
    const { data } = await supabase.from('character_changes').select('*').eq('character_id', c.id)
      .order('changed_at', { ascending: false }).limit(25)
    setAudit(data ?? [])
    setAuditFor(c.id)
  }

  function diffText(row) {
    const parts = []
    if (row.old_name !== row.new_name) parts.push(`name: ${row.old_name} → ${row.new_name}`)
    const keys = new Set([...Object.keys(row.old_fields ?? {}), ...Object.keys(row.new_fields ?? {})])
    for (const k of keys) {
      const a = JSON.stringify(row.old_fields?.[k])
      const b = JSON.stringify(row.new_fields?.[k])
      if (a !== b) parts.push(`${k}: ${a ?? '—'} → ${b ?? '—'}`)
    }
    return parts.join(' · ') || 'no visible change'
  }

  async function createNpc() {
    if (!npcName.trim()) return
    const err = await addNpc(npcName.trim())
    if (err) setError(err.message); else setNpcName('')
  }

  async function createFaction() {
    if (!facName.trim()) return
    const err = await addFaction(facName.trim(), facColor)
    if (err) setError(err.message); else setFacName('')
  }

  return (
    <div className="panel-pad">
      <table className="grid">
        <thead>
          <tr>
            <th>Character</th><th>Player</th><th>Faction</th>
            {stats.map((s) => <th key={s.key}>{s.label || s.key}</th>)}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {characters.map((c) => {
            const d = draftOf(c)
            return (
              <Fragment key={c.id}>
                <tr>
                  <td><input type="text" value={d.name} onChange={(e) => patchDraft(c, { name: e.target.value })} /></td>
                  <td>{c.is_npc ? <span className="badge-pill">NPC</span> : usernameOf(c.user_id)}</td>
                  <td>
                    <select value={d.faction_id} onChange={(e) => patchDraft(c, { faction_id: e.target.value })}>
                      <option value="">—</option>
                      {factions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </td>
                  {stats.map((s) => (
                    <td key={s.key}>
                      {s.type === 'number' ? (
                        <input type="number" min={s.min} max={s.max} value={d.fields[s.key] ?? ''} onChange={(e) => patchField(c, s.key, e.target.value)} />
                      ) : (
                        <input type="text" value={d.fields[s.key] ?? ''} onChange={(e) => patchField(c, s.key, e.target.value)} />
                      )}
                    </td>
                  ))}
                  <td>
                    <div className="row">
                      <button className="primary" disabled={!isDirty(c)} onClick={() => save(c)}>Save</button>
                      <button className="ghost" onClick={() => showAudit(c)}>History</button>
                      {c.is_npc && <button className="danger" onClick={() => deleteCharacter(c.id)}>×</button>}
                    </div>
                  </td>
                </tr>
                {auditFor === c.id && (
                  <tr>
                    <td colSpan={4 + stats.length}>
                      {audit.length === 0 && <span className="hint">No changes recorded yet.</span>}
                      {audit.map((row) => (
                        <div key={row.id} className="hint" style={{ padding: '2px 0' }}>
                          {timeAgo(row.changed_at)} · {row.changed_by ? usernameOf(row.changed_by) : 'system'} · {diffText(row)}
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
      {characters.length === 0 && <p className="hint mt">No characters yet. Players create theirs in the app after joining with the game code.</p>}

      <div className="row mt">
        <input placeholder="NPC name" value={npcName} onChange={(e) => setNpcName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createNpc()} />
        <button onClick={createNpc}>Add NPC</button>
      </div>

      <h3 className="mt" style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Factions</h3>
      <div className="row mt">
        {factions.map((f) => (
          <span key={f.id} className="badge-pill" style={{ borderColor: f.color, color: f.color }}>{f.name}</span>
        ))}
        <input placeholder="New faction" value={facName} onChange={(e) => setFacName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createFaction()} />
        <input type="color" value={facColor} onChange={(e) => setFacColor(e.target.value)} style={{ width: 44, padding: 2 }} />
        <button onClick={createFaction}>Add faction</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
