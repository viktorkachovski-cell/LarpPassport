import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { unwrap } from '../lib/unwrap'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'
import PirateCrews from './PirateCrews'
import PirateSiteBoard from './PirateSiteBoard'
import PirateGmControls from './PirateGmControls'
import PirateSettings from './PirateSettings'
import PirateHistory, { PirateAlerts } from './PirateHistory'
import { ParleyDisputes, TreasureAward } from './PirateRulings'
import { SiteForm, TreasurePoint } from './PirateSetup'

const PHASES = ['setup', 'charting', 'cursed', 'truce', 'hunt', 'hoard', 'recall', 'finished']
const PHASE_MESSAGES = {
  charting: 'The chart is yours. Seek the shards and words.',
  cursed: 'The curse wakes. Lighthouses and Parley are open.',
  truce: 'The bells call every crew to the Truce.',
  hunt: 'The hunt resumes. Keep your crew together.',
  hoard: 'The hoard has surfaced. Bring the oath to the Ghost Captain.',
  recall: 'The tide turns. Return to the final muster.',
  finished: 'The voyage is over. Gather and count the spoils.',
}

function PhaseControls({ gameId, state, busy, run, rpc, refresh }) {
  const [message, setMessage] = useState('')
  const index = PHASES.indexOf(state.phase)
  const next = PHASES[index + 1]

  function movePhase(target) {
    if (!window.confirm(`Change Pirate phase from ${state.phase} to ${target}? Players will be notified. Earlier phases reopen play without undoing rewards, readings or the frozen hoard value; finished-to-recall also restores active status. Players must re-enable sharing if finishing stopped it.`)) return
    run(async () => {
      await rpc('pirate_set_phase', { g: gameId, next_phase: target, message: message || PHASE_MESSAGES[target] || null })
      setMessage('')
      refresh()
    }, { success: `Phase changed to ${target}.` })
  }

  function toggle(name, field, value) {
    run(async () => { await rpc(name, { g: gameId, [field]: value }); refresh() },
      { success: value ? `${field} enabled.` : `${field} disabled.` })
  }

  return <section className="command-card pirate-section">
    <h3>Phase and safety controls</h3>
    <p className="hint">Previous phase corrects an accidental selection, including finished. It preserves recorded gameplay; players whose tracking stopped on finish must turn sharing back on.</p>
    <div className="row">
      <button type="button" disabled={!!busy || index < 1} onClick={() => movePhase(PHASES[index - 1])}>Previous phase</button>
      <button type="button" disabled={!!busy || index < 0 || !next} onClick={() => movePhase(next)}>Next: {next ?? 'finished'}</button>
      <button type="button" disabled={!!busy} onClick={() => toggle('pirate_set_paused', 'paused', !state.paused)}>
        {state.paused ? 'Resume all play' : 'Pause all play'}</button>
      <button type="button" disabled={!!busy} onClick={() => toggle('pirate_set_pvp', 'enabled', !state.pvp_enabled)}>
        {state.pvp_enabled ? 'Disable Parley' : 'Enable Parley'}</button>
    </div>
    <div className="field"><label htmlFor="pirate-phase-message">Phase announcement</label>
      <input id="pirate-phase-message" value={message} maxLength={300} onChange={(event) => setMessage(event.target.value)}
        placeholder={PHASE_MESSAGES[next] ?? 'Optional message'} /></div>
  </section>
}

function Readiness({ readiness, busy, onCheck }) {
  return <section className="command-card pirate-section">
    <h3>Readiness</h3><button type="button" disabled={!!busy} onClick={onCheck}>Check setup</button>
    {readiness && <div role="status"><strong>{readiness.ready ? 'Ready to chart' : 'Needs work'}</strong>
      <ul>{readiness.issues?.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      {readiness.warnings?.length > 0 && <>
        <p className="hint">Differs from the event plan (does not block charting):</p>
        <ul className="hint">{readiness.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      </>}</div>}
  </section>
}

export default function PiratePanel({ game, state, zones, refresh, onShowTreasure }) {
  const { busy, outcome, clear, run } = useAction()
  const [readiness, setReadiness] = useState(null)
  const setupChanged = () => setReadiness(null)

  async function rpc(name, args, allowed = ['ok']) {
    const data = unwrap(await supabase.rpc(name, args))
    if (data?.status && !allowed.includes(data.status)) throw new Error(data.status.replaceAll('_', ' '))
    return data
  }

  function enablePirate() {
    if (!window.confirm('Enable Pirate mode for this draft game? The game cannot run a Time Hunt after this.')) return
    run(async () => { await rpc('pirate_enable', { g: game.id }); refresh() }, { success: 'Pirate mode enabled.' })
  }

  function checkReadiness() {
    run(async () => setReadiness(unwrap(await supabase.rpc('pirate_validate', { g: game.id }))), { success: 'Setup checked.' })
  }

  function clearSite(site) {
    if (!window.confirm(`Remove Pirate site ${site.name}? Existing claims or readings prevent removal.`)) return
    run(async () => {
      await rpc('pirate_clear_site', { g: game.id, zone_id: site.zone_id })
      refresh()
      setupChanged()
    }, { success: 'Pirate site removed.' })
  }

  const ctx = { gameId: game.id, state, busy, run, rpc, refresh }
  return <div className="panel-pad pirate-panel">
    <div className="row between mb"><div><h2 className="display">Pirate game</h2>
      <p className="hint">Crew rewards, lighthouse bearings and GM phase control.</p></div>
      {state?.is_pirate && <strong>{state.phase.toUpperCase()}</strong>}
    </div>
    <Outcome outcome={outcome} onDismiss={clear} />
    {!game.phase && <section className="command-card pirate-section">
      <h3>Enable this mode</h3>
      <p className="hint">Set crews and zones using the existing tabs, then configure the Pirate sites here.</p>
      <button type="button" disabled={!!busy || game.status !== 'draft'} onClick={enablePirate}>Enable Pirate mode</button>
      {game.status !== 'draft' && <p className="hint">Only a draft game can be converted.</p>}
    </section>}
    {game.phase && !state && <p role="status">Loading Pirate controls…</p>}
    {state?.is_pirate && <>
      <PhaseControls {...ctx} />
      {state.phase === 'setup' && <SiteForm {...ctx} zones={zones} onChanged={setupChanged} />}
      <TreasurePoint {...ctx} onShowTreasure={onShowTreasure} onChanged={setupChanged} />
      {state.phase === 'setup' && <Readiness readiness={readiness} busy={busy} onCheck={checkReadiness} />}
      <PirateAlerts alerts={state.alerts} />
      <PirateSettings key={`${game.id}-settings`} {...ctx} />
      <PirateGmControls key={`${game.id}-gm`} {...ctx} />
      <PirateHistory key={`${game.id}-history`} {...ctx} />
      <PirateCrews {...ctx} />
      {state.phase === 'hoard' && <TreasureAward {...ctx} />}
      <PirateSiteBoard {...ctx} onRemoveSite={clearSite} />
      <ParleyDisputes {...ctx} />
    </>}
  </div>
}
