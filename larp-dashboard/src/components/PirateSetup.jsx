import { useState } from 'react'

// Registers a zone as a riddle or lighthouse site (setup only).
export function SiteForm({ gameId, state, zones, busy, run, rpc, refresh, onChanged }) {
  const [zoneId, setZoneId] = useState('')
  const [kind, setKind] = useState('riddle')
  const [reward, setReward] = useState('bearing')
  const [oathIndex, setOathIndex] = useState('1')
  const [oathWord, setOathWord] = useState('')
  const [prompt, setPrompt] = useState('')
  const [answer, setAnswer] = useState('')
  const payouts = state.settings?.riddle_payouts ?? [20, 15, 10, 5]
  const siteOf = (id) => state.sites?.find((site) => site.zone_id === id)
  const riddle = kind === 'riddle'
  const oath = riddle && reward === 'oath'

  // A registered zone loads its saved settings; a new zone keeps the chosen
  // kind and reward. The answer and oath word are never sent back.
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

  function save(event) {
    event.preventDefault()
    run(async () => {
      await rpc('pirate_set_site', {
        g: gameId, zone_id: zoneId, kind,
        reward: riddle ? reward : null,
        oath_index: oath ? Number(oathIndex) : null,
        oath_word: oath ? oathWord : null,
        prompt: riddle ? prompt : null,
        answer: riddle ? (answer || null) : null,
      })
      setAnswer('')
      refresh()
      onChanged()
    }, { success: 'Site saved. The answer field has been cleared.' })
  }

  return <section className="command-card pirate-section">
    <h3>Register a Pirate site</h3>
    <p className="hint">Create the zone on the map first: an event zone set to "Log silently for GMs", with a dwell time (20 s is a good start). The event plan has 5 bearing riddles, 4 oath riddles and 3 lighthouses, but any number can start a test. Each riddle pays {payouts.join(' / ')} doubloons by rank, then {payouts.at(-1)} for every later crew. Crew count and crew size are uncapped.</p>
    <p className="hint">Players see the prompt in the app's Sites tab once they have stood inside the zone for its dwell time with location sharing on, and type the answer there. The answer is stored only as a hash: it is cleared after saving and never shown again.</p>
    <form onSubmit={save} autoComplete="off">
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
            {['riddle', 'lighthouse'].map((item) => <option key={item} value={item}>{item}</option>)}
          </select></div>
        {riddle && <div className="field"><label htmlFor="pirate-reward">Riddle reward</label>
          <select id="pirate-reward" value={reward} onChange={(event) => setReward(event.target.value)}>
            <option value="bearing">Bearing shard</option><option value="oath">Oath word</option>
          </select></div>}
        {oath && <>
          <div className="field"><label htmlFor="pirate-oath-index">Oath index</label>
            <select id="pirate-oath-index" value={oathIndex} onChange={(event) => setOathIndex(event.target.value)}>
              {[1, 2, 3, 4].map((index) => <option key={index} value={index}>{index}</option>)}
            </select></div>
          <div className="field"><label htmlFor="pirate-oath-word">Oath word</label>
            <input id="pirate-oath-word" value={oathWord} maxLength={40} required
              onChange={(event) => setOathWord(event.target.value)} /></div>
        </>}
        {riddle && <>
          <div className="field"><label htmlFor="pirate-answer">Answer {siteOf(zoneId)?.answer_set ? '(leave blank to keep)' : ''}</label>
            <input id="pirate-answer" name="riddle-answer" type="text" value={answer} maxLength={100}
              onChange={(event) => setAnswer(event.target.value)} autoComplete="off" spellCheck={false}
              data-1p-ignore data-lpignore="true" /></div>
          <div className="field pirate-wide"><label htmlFor="pirate-prompt">Prompt (shown to players at the site)</label>
            <textarea id="pirate-prompt" name="riddle-prompt" rows={3} value={prompt} maxLength={500} required
              onChange={(event) => setPrompt(event.target.value)} autoComplete="off" /></div>
        </>}
      </div>
      <button type="submit" disabled={!!busy || !zoneId}>Save site</button>
    </form>
  </section>
}

// The hoard's coordinates: editable through charting, then shown read-only.
export function TreasurePoint({ gameId, state, busy, run, rpc, refresh, onShowTreasure, onChanged }) {
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const editable = ['setup', 'charting'].includes(state.phase)
  if (!editable && !state.treasure) return null

  function save(event) {
    event.preventDefault()
    run(async () => {
      await rpc('pirate_set_treasure', { g: gameId, lat: Number(lat), lng: Number(lng) })
      setLat('')
      setLng('')
      refresh()
      onChanged()
    }, { success: 'Treasure point saved. It is shown on the map for GMs only.' })
  }

  // Map apps copy a point as "42.1500, 24.7500"; split it into both fields.
  function paste(event) {
    const match = event.clipboardData?.getData('text')
      ?.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
    if (!match) return
    event.preventDefault()
    setLat(match[1])
    setLng(match[2])
  }

  return <section className="command-card pirate-section">
    <h3>Treasure point</h3>
    {state.treasure
      ? <div className="row">
          <span>Saved at {state.treasure.lat.toFixed(6)}, {state.treasure.lng.toFixed(6)}. GMs see it on the map as the treasure marker.</span>
          {onShowTreasure && <button type="button" onClick={onShowTreasure}>Show on map</button>}
        </div>
      : <p className="hint">No treasure point saved yet.</p>}
    {editable && <>
      <p className="hint">Coordinates can be changed through charting. They lock at cursed, or after a reading exists. The treasure's value is set when the hoard opens: {state.settings?.treasure_percent ?? 40}% of the leading crew's doubloons, rounded, with a maximum of 1000 doubloons.</p>
      <form onSubmit={save} className="pirate-form-grid">
        <div className="field"><label htmlFor="pirate-lat">Latitude</label><input id="pirate-lat" type="number" step="any" required min="-90" max="90" value={lat} onChange={(event) => setLat(event.target.value)} onPaste={paste} /></div>
        <div className="field"><label htmlFor="pirate-lng">Longitude</label><input id="pirate-lng" type="number" step="any" required min="-180" max="180" value={lng} onChange={(event) => setLng(event.target.value)} onPaste={paste} /></div>
        <button type="submit" disabled={!!busy}>Save treasure</button>
      </form>
      <p className="hint">Tip: paste "latitude, longitude" copied from a map app into either field.</p>
    </>}
  </section>
}
