import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { unwrap } from '../lib/unwrap'
import { useAction } from '../lib/useAction'
import Outcome from './Outcome'
import PirateCrews from './PirateCrews'
import PirateSiteBoard from './PirateSiteBoard'

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

function ParleyRuling({ gameId, parley, busy, run, rpc, refresh }) {
  const [winner, setWinner] = useState(parley.attacker_faction ?? '')
  const [currency, setCurrency] = useState('doubloon')
  const [reason, setReason] = useState('')
  const canResolve = parley.choice === 'yield' || parley.choice === 'fight'
  function resolve() {
    if (!window.confirm('Resolve this Parley despite the conflicting or missing reports?')) return
    run(async () => {
      await rpc('gm_resolve_parley', {
        g: gameId, parley_id: parley.id,
        winner_faction: parley.choice === 'yield' ? parley.attacker_faction : winner,
        currency: parley.choice === 'yield' ? 'doubloon' : currency, reason,
      })
      setReason('')
      refresh()
    }, { success: 'Parley resolved with a recorded GM ruling.' })
  }
  function voidSession() {
    if (!window.confirm('Void this Parley? Any transfer will be reversed.')) return
    run(async () => {
      await rpc('gm_void_parley', { g: gameId, parley_id: parley.id, reason })
      setReason('')
      refresh()
    }, { success: 'Parley voided with an audit entry.' })
  }
  return <div className="pirate-ruling">
    <p className="hint">Target report: {parley.target_report === parley.target_faction ? parley.target_name : parley.target_report === parley.attacker_faction ? parley.attacker_name : 'missing'} · Attacker report: {parley.attacker_report === parley.target_faction ? parley.target_name : parley.attacker_report === parley.attacker_faction ? parley.attacker_name : 'missing'}</p>
    <div className="pirate-form-grid">
      {parley.choice === 'fight' && <>
        <div className="field"><label htmlFor={`winner-${parley.id}`}>Winner</label>
          <select id={`winner-${parley.id}`} value={winner} onChange={(event) => setWinner(event.target.value)}>
            <option value={parley.target_faction}>{parley.target_name}</option>
            <option value={parley.attacker_faction}>{parley.attacker_name}</option>
          </select></div>
        <div className="field"><label htmlFor={`currency-${parley.id}`}>Plunder</label>
          <select id={`currency-${parley.id}`} value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="doubloon">Doubloons</option><option value="bearing">One bearing shard</option>
          </select></div>
      </>}
      <div className="field"><label htmlFor={`reason-${parley.id}`}>Ruling reason</label>
        <input id={`reason-${parley.id}`} value={reason} minLength={3} maxLength={300}
          onChange={(event) => setReason(event.target.value)} /></div>
    </div>
    <div className="row">
      <button type="button" disabled={!!busy || !canResolve || reason.trim().length < 3}
        onClick={resolve}>Resolve Parley</button>
      <button type="button" disabled={!!busy || reason.trim().length < 3}
        onClick={voidSession}>Void Parley</button>
    </div>
  </div>
}

export default function PiratePanel({ game, state, zones, refresh, onShowTreasure }) {
  const { busy, outcome, clear, run } = useAction()
  const [readiness, setReadiness] = useState(null)
  const [zoneId, setZoneId] = useState('')
  const [kind, setKind] = useState('riddle')
  const [reward, setReward] = useState('bearing')
  const [oathIndex, setOathIndex] = useState('1')
  const [oathWord, setOathWord] = useState('')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [phaseMessage, setPhaseMessage] = useState('')
  const [awardCrew, setAwardCrew] = useState('')
  const [awardReason, setAwardReason] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const phaseIndex = PHASES.indexOf(state?.phase)
  const canSetSite = state?.phase === 'setup'
  const canSetTreasure = ['setup', 'charting'].includes(state?.phase)
  const siteOf = (id) => state?.sites?.find((site) => site.zone_id === id)

  // Choosing a registered zone loads its saved settings for editing; a new
  // zone keeps the chosen kind and reward. The answer and oath word are never
  // sent back, so they start empty.
  function chooseZone(id) {
    const site = siteOf(id)
    setZoneId(id)
    if (site) {
      setKind(site.kind)
      setReward(site.reward ?? 'bearing')
      setOathIndex(String(site.oath_index ?? 1))
    }
    setOathWord('')
    setPrompt(site?.prompt ?? '')
    setAnswer('')
  }

  async function rpc(name, args) {
    const data = unwrap(await supabase.rpc(name, args))
    if (data?.status && data.status !== 'ok') throw new Error(data.status.replaceAll('_', ' '))
    return data
  }

  function checkReadiness() {
    run(async () => setReadiness(unwrap(await supabase.rpc('pirate_validate', { g: game.id }))),
      { success: 'Setup checked.' })
  }

  function enablePirate() {
    if (!window.confirm('Enable Pirate mode for this draft game? The game cannot run a Time Hunt after this.')) return
    run(async () => { await rpc('pirate_enable', { g: game.id }); refresh() },
      { success: 'Pirate mode enabled.' })
  }

  function saveSite(event) {
    event.preventDefault()
    run(async () => {
      await rpc('pirate_set_site', {
        g: game.id, zone_id: zoneId, kind,
        reward: kind === 'riddle' ? reward : null,
        oath_index: kind === 'riddle' && reward === 'oath' ? Number(oathIndex) : null,
        oath_word: kind === 'riddle' && reward === 'oath' ? oathWord : null,
        prompt: kind === 'riddle' ? prompt : null,
        answer: kind === 'riddle' ? (answer || null) : null,
      })
      setAnswer('')
      refresh()
      setReadiness(null)
    }, { success: 'Site saved. The answer field has been cleared.' })
  }

  function saveTreasure(event) {
    event.preventDefault()
    run(async () => {
      await rpc('pirate_set_treasure', {
        g: game.id, lat: Number(lat), lng: Number(lng),
      })
      setLat('')
      setLng('')
      refresh()
      setReadiness(null)
    }, { success: 'Treasure point saved. It is shown on the map for GMs only.' })
  }

  // Map apps copy a point as "42.1500, 24.7500"; split it into both fields.
  function pasteTreasure(event) {
    const match = event.clipboardData?.getData('text')
      ?.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!match) return
    event.preventDefault()
    setLat(match[1])
    setLng(match[2])
  }

  function clearSite(site) {
    if (!window.confirm(`Remove Pirate site ${site.name}? Existing claims or readings prevent removal.`)) return
    run(async () => {
      await rpc('pirate_clear_site', { g: game.id, zone_id: site.zone_id })
      refresh()
      setReadiness(null)
    }, { success: 'Pirate site removed.' })
  }

  function movePhase(next) {
    if (!window.confirm(`Change Pirate phase from ${state.phase} to ${next}? Players will be notified.`)) return
    run(async () => {
      await rpc('pirate_set_phase', { g: game.id, next_phase: next, message: phaseMessage || PHASE_MESSAGES[next] || null })
      setPhaseMessage('')
      refresh()
    }, { success: `Phase changed to ${next}.` })
  }

  function toggle(name, field, next) {
    run(async () => { await rpc(name, { g: game.id, [field]: next }); refresh() },
      { success: next ? `${field} enabled.` : `${field} disabled.` })
  }

  function awardTreasure(event) {
    event.preventDefault()
    if (!window.confirm('Award the hoard to this crew after hearing the oath on site?')) return
    run(async () => {
      await rpc('gm_award_treasure', { g: game.id, faction_id: awardCrew, reason: awardReason })
      setAwardReason('')
      refresh()
    }, { success: 'Treasure awarded and announced to players.' })
  }

  function voidTreasure(event) {
    event.preventDefault()
    if (!window.confirm('Void the current treasure award and reverse its doubloons?')) return
    run(async () => {
      await rpc('gm_void_treasure', { g: game.id, reason: voidReason })
      setVoidReason('')
      refresh()
    }, { success: 'Treasure award voided and reversed.' })
  }

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
      <section className="command-card pirate-section">
        <h3>Phase and safety controls</h3>
        <div className="row">
          <button type="button" disabled={!!busy || phaseIndex < 1 || phaseIndex === PHASES.length - 1}
            onClick={() => movePhase(PHASES[phaseIndex - 1])}>Previous phase</button>
          <button type="button" disabled={!!busy || phaseIndex < 0 || phaseIndex === PHASES.length - 1}
            onClick={() => movePhase(PHASES[phaseIndex + 1])}>Next: {PHASES[phaseIndex + 1] ?? 'finished'}</button>
          <button type="button" disabled={!!busy} onClick={() => toggle('pirate_set_paused', 'paused', !state.paused)}>
            {state.paused ? 'Resume all play' : 'Pause all play'}</button>
          <button type="button" disabled={!!busy} onClick={() => toggle('pirate_set_pvp', 'enabled', !state.pvp_enabled)}>
            {state.pvp_enabled ? 'Disable Parley' : 'Enable Parley'}</button>
        </div>
        <div className="field"><label htmlFor="pirate-phase-message">Phase announcement</label>
          <input id="pirate-phase-message" value={phaseMessage} maxLength={300}
            onChange={(event) => setPhaseMessage(event.target.value)}
            placeholder={PHASE_MESSAGES[PHASES[phaseIndex + 1]] ?? 'Optional message'} /></div>
      </section>
      {canSetSite && <section className="command-card pirate-section">
        <h3>Register a Pirate site</h3>
        <p className="hint">Create the zone on the map first: an event zone set to "Log silently for GMs", with a dwell time (20 s is a good start). The event plan has 5 bearing riddles, 4 oath riddles and 3 lighthouses, but any number can start a test. Each riddle pays 20 / 15 / 10 / 5 / 5 doubloons in the order crews answer it correctly.</p>
        <p className="hint">Players see the prompt in the app's CHART tab once they have stood inside the zone for its dwell time with location sharing on, and type the answer there. The answer is stored only as a hash: it is cleared after saving and never shown again.</p>
        <form onSubmit={saveSite} autoComplete="off">
          <div className="pirate-form-grid">
            <div className="field"><label htmlFor="pirate-zone">Zone</label>
              <select id="pirate-zone" value={zoneId} required onChange={(event) => chooseZone(event.target.value)}>
                <option value="">Choose zone</option>
                {zones.map((zone) => {
                  const site = siteOf(zone.id)
                  return <option key={zone.id} value={zone.id}>
                    {zone.name}{site ? ` (${site.kind === 'riddle' ? `${site.reward} riddle` : site.kind})` : ''}</option>
                })}
              </select></div>
            <div className="field"><label htmlFor="pirate-kind">Site kind</label>
              <select id="pirate-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                {['riddle', 'lighthouse'].map((item) =>
                  <option key={item} value={item}>{item}</option>)}
              </select></div>
            {kind === 'riddle' && <div className="field"><label htmlFor="pirate-reward">Riddle reward</label>
              <select id="pirate-reward" value={reward} onChange={(event) => setReward(event.target.value)}>
                <option value="bearing">Bearing shard</option><option value="oath">Oath word</option>
              </select></div>}
            {kind === 'riddle' && reward === 'oath' && <>
              <div className="field"><label htmlFor="pirate-oath-index">Oath index</label>
                <select id="pirate-oath-index" value={oathIndex} onChange={(event) => setOathIndex(event.target.value)}>
                  {[1, 2, 3, 4].map((index) => <option key={index} value={index}>{index}</option>)}
                </select></div>
              <div className="field"><label htmlFor="pirate-oath-word">Oath word</label>
                <input id="pirate-oath-word" value={oathWord} maxLength={40} required
                  onChange={(event) => setOathWord(event.target.value)} /></div>
            </>}
            {kind === 'riddle' && <div className="field"><label htmlFor="pirate-answer">Answer {siteOf(zoneId)?.answer_set ? '(leave blank to keep)' : ''}</label>
              <input id="pirate-answer" name="riddle-answer" type="text" value={answer} maxLength={100}
                onChange={(event) => setAnswer(event.target.value)} autoComplete="off" spellCheck={false}
                data-1p-ignore data-lpignore="true" /></div>}
            {kind === 'riddle' && <div className="field pirate-wide"><label htmlFor="pirate-prompt">Prompt (shown to players at the site)</label>
              <textarea id="pirate-prompt" name="riddle-prompt" rows={3} value={prompt} maxLength={500} required
                onChange={(event) => setPrompt(event.target.value)} autoComplete="off" /></div>}
          </div>
          <button type="submit" disabled={!!busy || !zoneId}>Save site</button>
        </form>
      </section>}
      {(canSetTreasure || state.treasure) && <section className="command-card pirate-section">
        <h3>Treasure point</h3>
        {state.treasure
          ? <div className="row">
              <span>Saved at {state.treasure.lat.toFixed(6)}, {state.treasure.lng.toFixed(6)}. GMs see it on the map as the treasure marker.</span>
              {onShowTreasure && <button type="button" onClick={onShowTreasure}>Show on map</button>}
            </div>
          : <p className="hint">No treasure point saved yet.</p>}
        {canSetTreasure && <p className="hint">Coordinates can be changed through charting. They lock at cursed, or after a reading exists. The treasure's value is set when the hoard opens: 40% of the leading crew's doubloons, rounded.</p>}
        {canSetTreasure && <form onSubmit={saveTreasure} className="pirate-form-grid">
          <div className="field"><label htmlFor="pirate-lat">Latitude</label><input id="pirate-lat" type="number" step="any" required min="-90" max="90" value={lat} onChange={(event) => setLat(event.target.value)} onPaste={pasteTreasure} /></div>
          <div className="field"><label htmlFor="pirate-lng">Longitude</label><input id="pirate-lng" type="number" step="any" required min="-180" max="180" value={lng} onChange={(event) => setLng(event.target.value)} onPaste={pasteTreasure} /></div>
          <button type="submit" disabled={!!busy}>Save treasure</button>
        </form>}
        {canSetTreasure && <p className="hint">Tip: paste "latitude, longitude" copied from a map app into either field.</p>}
      </section>}
      {state.phase === 'setup' && <section className="command-card pirate-section">
        <h3>Readiness</h3><button type="button" disabled={!!busy} onClick={checkReadiness}>Check setup</button>
        {readiness && <div role="status"><strong>{readiness.ready ? 'Ready to chart' : 'Needs work'}</strong>
          <ul>{readiness.issues?.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          {readiness.warnings?.length > 0 && <>
            <p className="hint">Differs from the event plan (does not block charting):</p>
            <ul className="hint">{readiness.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </>}</div>}
      </section>}
      <PirateCrews gameId={game.id} state={state} busy={busy} run={run} rpc={rpc} refresh={refresh} />
      {state.phase === 'hoard' && <section className="command-card pirate-section">
        <h3>Treasure award</h3>
        {state.treasure?.value != null
          ? <p className="hint">Worth {state.treasure.value} doubloons (40% of the leading {state.treasure.basis}, frozen when the hoard opened).</p>
          : <p className="hint">No value frozen yet. Open the hoard with the phase control to set it.</p>}
        {state.treasure_award ? <>
          <p>{state.treasure_award.crew_name} holds the hoard.</p>
          <form onSubmit={voidTreasure} className="pirate-form-grid">
            <div className="field"><label htmlFor="pirate-void-reason">Correction reason</label>
              <input id="pirate-void-reason" value={voidReason} minLength={3} maxLength={300} required
                onChange={(event) => setVoidReason(event.target.value)} /></div>
            <button type="submit" disabled={!!busy || voidReason.trim().length < 3}>Void treasure award</button>
          </form>
        </> : <form onSubmit={awardTreasure} className="pirate-form-grid">
          <div className="field"><label htmlFor="pirate-award-crew">Crew</label>
            <select id="pirate-award-crew" value={awardCrew} required onChange={(event) => setAwardCrew(event.target.value)}>
              <option value="">Choose crew</option>{(state.crews ?? []).map((crew) =>
                <option key={crew.id} value={crew.id}>{crew.name}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pirate-award-reason">Oath verification note</label>
            <input id="pirate-award-reason" value={awardReason} minLength={3} maxLength={300} required
              onChange={(event) => setAwardReason(event.target.value)} /></div>
          <button type="submit" disabled={!!busy || !awardCrew || awardReason.trim().length < 3}>Award treasure</button>
        </form>}
      </section>}
      <PirateSiteBoard gameId={game.id} state={state} busy={busy} run={run} rpc={rpc} refresh={refresh}
        onRemoveSite={clearSite} />
      <section className="command-card pirate-section">
        <h3>Parley and disputes</h3>
        {(state.parleys ?? []).length === 0 && <p className="hint">No active Parleys.</p>}
        {(state.parleys ?? []).map((parley) => <div key={parley.id} className="pirate-parley-row">
          <strong>{parley.target_name} / {parley.attacker_name ?? 'waiting'} · {parley.state}</strong>
          {parley.far_apart && <span className="hint">The players were far apart at join.</span>}
          {parley.state === 'disputed' && <ParleyRuling gameId={game.id} parley={parley}
            busy={busy} run={run} rpc={rpc} refresh={refresh} />}
        </div>)}
      </section>
    </>}
  </div>
}
