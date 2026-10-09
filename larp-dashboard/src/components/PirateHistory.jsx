import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { unwrap } from '../lib/unwrap'
import { RULE_FIELDS } from './PirateSettings'

const KINDS = [['ledger', 'Ledger'], ['claims', 'Claims'], ['readings', 'Readings'], ['parleys', 'Parleys'], ['audit', 'GM changes']]
const labelOf = (key) => RULE_FIELDS.find(([field]) => field === key)?.[1] ?? {
  riddle_payouts: 'Riddle payouts', captain: 'Captain', phase: 'Phase', until: 'Mercy until',
  rank: 'Rank', doubloons: 'Doubloons', reward: 'Reward', amount: 'Amount', site_name: 'Site',
}[key]
const when = (value) => value ? new Date(value).toLocaleString() : 'not recorded'

function AuditDetails({ row, crews }) {
  function describe(value, key) {
    if (Array.isArray(value)) return value.join(' / ')
    if (key === 'captain') return crews.flatMap((crew) => crew.members ?? []).find((member) => member.profile_id === value)?.name ?? 'previous player'
    if (key === 'until') return when(value)
    return String(value ?? 'none')
  }
  return <details><summary>Before and after</summary>
    {[['Before', row.before], ['After', row.after]].map(([title, snapshot]) => <div key={title}>
      <strong>{title}</strong>
      <dl>{Object.entries(snapshot ?? {}).filter(([key]) => labelOf(key)).map(([key, value]) =>
        <div key={key}><dt>{labelOf(key)}</dt><dd>{describe(value, key)}</dd></div>)}</dl>
    </div>)}
  </details>
}

function HistoryRow({ kind, row, crews }) {
  return <>
    <strong>{row.crew_name ?? (kind === 'parleys' ? row.target_name + ' / ' + (row.attacker_name ?? 'waiting') : row.action)}</strong>
    <p className="hint">{when(row.at)}{row.actor_name ? ' · ' + row.actor_name : ''}</p>
    {kind === 'ledger' && <p>{row.delta > 0 ? '+' : ''}{row.delta} {row.currency === 'bearing' ? 'bearing shards' : 'doubloons'} · {row.source}</p>}
    {kind === 'claims' && <p>{row.site_name} · rank {row.rank ?? 'unrecorded'} · {row.via_gm ? 'GM claim' : 'player solve'}{row.voided_at && ' · voided'}</p>}
    {kind === 'readings' && <p>{row.site_name} · {row.shards} shards · {row.centre_deg}° ±{row.half_width_deg}°{row.voided_at && ' · voided'}</p>}
    {kind === 'parleys' && <>
      <p>{row.state} · {row.choice ?? 'no exchange'}{row.winner_name && ' · winner: ' + row.winner_name}{row.plunder && ' · ' + row.transferred + ' ' + (row.plunder === 'bearing' ? 'shards' : 'doubloons')}</p>
      <p className="hint">Target report: {crews.find((crew) => crew.id === row.target_report)?.name ?? (row.target_report ? 'reported crew' : 'missing')} · Attacker report: {crews.find((crew) => crew.id === row.attacker_report)?.name ?? (row.attacker_report ? 'reported crew' : 'missing')}</p>
    </>}
    {kind === 'parleys' && row.rules && <details><summary>Encounter terms</summary><dl>
      {RULE_FIELDS.filter(([key]) => key in row.rules && !key.startsWith('answer_') && key !== 'treasure_percent').map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd>{row.rules[key]}</dd></div>)}
    </dl></details>}
    {row.reason && <p>Reason: {row.reason}</p>}
    {kind === 'audit' && <AuditDetails row={row} crews={crews} />}
  </>
}

export function PirateAlerts({ alerts = [] }) {
  return <section className="command-card pirate-section">
    <h3>Crew alerts</h3>
    <p className="hint">As of the latest dashboard refresh. GPS becomes stale after 120 seconds; crew spread warns above 150 m using fresh, shared positions only. These alerts do not change gameplay.</p>
    {alerts.length === 0 && <p>No current crew alerts.</p>}
    {alerts.map((alert) => <div key={alert.crew_id ?? 'unassigned'} className="pirate-parley-row">
      <strong>{alert.crew_name}</strong>
      {alert.spread_m > 150 && <p>Fresh locations are up to {alert.spread_m} m apart.</p>}
      {(alert.stale_players ?? []).map((player) => <p key={player.profile_id}>
        {player.name}: {player.sharing_enabled ? player.last_fix_at ? 'stale GPS; last fix ' + when(player.last_fix_at) : 'no GPS fix' : 'sharing is off'}
      </p>)}
    </div>)}
  </section>
}

export default function PirateHistory({ gameId, state, busy: actionBusy, run, rpc, refresh }) {
  const [kind, setKind] = useState('ledger')
  const [crew, setCrew] = useState('')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [voiding, setVoiding] = useState(null)
  const [reason, setReason] = useState('')
  const request = useRef(0)
  const crews = state.crews ?? []
  useEffect(() => {
    ++request.current
    setItems([]); setCursor(null); setLoaded(false); setError(''); setBusy(false); setVoiding(null)
    return () => { ++request.current }
  }, [gameId, kind, crew])

  async function load(next = null) {
    const version = ++request.current
    setBusy(true); setError('')
    try {
      const page = unwrap(await supabase.rpc('gm_pirate_history', { g: gameId, kind, crew: crew || null, page_cursor: next, page_size: 50 }))
      if (version !== request.current) return
      setItems((previous) => next ? [...previous, ...page.items] : page.items)
      setCursor(page.next_cursor); setLoaded(true)
    } catch (failure) {
      if (version === request.current) setError(failure.message)
    } finally { if (version === request.current) setBusy(false) }
  }

  function voidParley(event) {
    event.preventDefault()
    if (!window.confirm('Void this historical Parley and reverse its transfers? It may fail if a crew has already spent the reward.')) return
    run(async () => {
      await rpc('gm_void_parley', { g: gameId, parley_id: voiding.id, reason })
      setVoiding(null); setReason(''); refresh()
      await load()
    }, { success: 'Parley voided with compensating ledger entries.' })
  }

  return <section className="command-card pirate-section">
    <h3>GM history</h3>
    <div className="pirate-form-grid">
      <div className="field"><label htmlFor="pirate-history-kind">History</label>
        <select id="pirate-history-kind" disabled={!!actionBusy} value={kind} onChange={(event) => setKind(event.target.value)}>
          {KINDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></div>
      <div className="field"><label htmlFor="pirate-history-crew">History crew</label>
        <select id="pirate-history-crew" disabled={!!actionBusy} value={crew} onChange={(event) => setCrew(event.target.value)}>
          <option value="">All crews</option>
          {crews.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></div>
      <button type="button" disabled={busy || !!actionBusy} onClick={() => load()}>{loaded ? 'Refresh history' : 'Load history'}</button>
    </div>
    {busy && <p role="status">Loading history…</p>}
    {error && <p role="alert">{error}</p>}
    {loaded && !busy && items.length === 0 && <p>No entries in this history.</p>}
    {items.map((row) => <article key={row.id} className="pirate-parley-row">
      <HistoryRow kind={kind} row={row} crews={crews} />
      {kind === 'parleys' && ['resolved', 'disputed'].includes(row.state) && !row.voided_at
        && <button type="button" disabled={!!actionBusy || busy} onClick={() => { setVoiding(row); setReason('') }}>Void historical Parley</button>}
    </article>)}
    {cursor && <button type="button" disabled={busy || !!actionBusy} onClick={() => load(cursor)}>Load older entries</button>}
    {voiding && <form onSubmit={voidParley} className="pirate-form-grid">
      <p>Void {voiding.target_name} / {voiding.attacker_name ?? 'waiting'}.</p>
      <div className="field"><label htmlFor="pirate-history-void-reason">Historical Parley correction reason</label>
        <input id="pirate-history-void-reason" value={reason} required minLength={3} maxLength={300} onChange={(event) => setReason(event.target.value)} /></div>
      <button type="submit" disabled={!!actionBusy || reason.trim().length < 3}>Confirm historical void</button>
      <button type="button" onClick={() => setVoiding(null)}>Cancel historical void</button>
    </form>}
  </section>
}
