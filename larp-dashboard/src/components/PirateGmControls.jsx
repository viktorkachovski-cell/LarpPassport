import { useRef, useState } from 'react'
import { CrewSelect, Reason, validReason } from './pirateCommon'

const hasCrew = (crews, id) => crews.some((crew) => crew.id === id)

function GrantClaim({ gameId, state, busy, run, rpc, refresh }) {
  const crews = state.crews ?? []
  const riddles = (state.sites ?? []).filter((site) => site.kind === 'riddle')
  const [crew, setCrew] = useState('')
  const [siteId, setSiteId] = useState('')
  const [reason, setReason] = useState('')
  const pending = useRef(null)
  const validSite = riddles.some((site) => site.zone_id === siteId)

  function claim(event) {
    event.preventDefault()
    if (!window.confirm('Grant this crew the normal next-rank riddle rewards without GPS, answer or phase checks?')) return
    // Retrying an uncertain result reuses its request ID, so the claim lands once.
    const signature = JSON.stringify([gameId, crew, siteId, reason.trim()])
    if (pending.current?.signature !== signature) pending.current = { signature, idem: crypto.randomUUID() }
    const { idem } = pending.current
    run(async () => {
      await rpc('gm_claim_for', { g: gameId, crew, zone_id: siteId, reason: reason.trim(), idem }, ['ok', 'already_claimed'])
      pending.current = null
      setReason('')
      refresh()
    }, { success: 'Claim checked: normal rewards recorded once, or the crew already holds this riddle.' })
  }

  return <section className="command-card pirate-section">
    <h3>Grant a riddle claim</h3>
    <p className="hint">GM recovery for a verified solve or an outage. Bypasses GPS, answer, pause and phase checks, including after finishing. Grants the normal current-rank reward once; a reason identifies the GM.</p>
    <form onSubmit={claim} className="pirate-form-grid">
      <CrewSelect id="gm-claim-crew" label="Claim for crew" value={crew} onChange={setCrew} crews={crews} />
      <div className="field"><label htmlFor="gm-claim-site">Riddle</label>
        <select id="gm-claim-site" value={validSite ? siteId : ''} required onChange={(event) => setSiteId(event.target.value)}>
          <option value="">Choose riddle</option>
          {riddles.map((site) => <option key={site.zone_id} value={site.zone_id}>{site.name}{!site.active && ' (inactive)'}</option>)}
        </select></div>
      <Reason id="gm-claim-reason" label="GM claim reason" value={reason} onChange={setReason} />
      <button type="submit" disabled={!!busy || !hasCrew(crews, crew) || !validSite || !validReason(reason)}>Grant claim</button>
    </form>
  </section>
}

function SetMercy({ gameId, state, busy, run, rpc, refresh }) {
  const crews = state.crews ?? []
  const [crew, setCrew] = useState('')
  const [minutes, setMinutes] = useState('15')
  const [reason, setReason] = useState('')
  const value = Number(minutes)
  const validMinutes = minutes !== '' && Number.isInteger(value) && value >= 0 && value <= 120

  function mercy(event) {
    event.preventDefault()
    if (!window.confirm(value === 0 ? 'Clear this crew’s current Mercy?' : 'Replace this crew’s current Mercy with the selected duration?')) return
    run(async () => {
      await rpc('gm_set_mercy', { g: gameId, crew, minutes: value, reason })
      setReason('')
      refresh()
    }, { success: 'Mercy updated with a recorded reason.' })
  }

  return <section className="command-card pirate-section">
    <h3>Set Davy’s Mercy</h3>
    <p className="hint">Replace the crew’s current immunity with 0–120 minutes. Zero clears it. Voiding an older Parley cannot erase this manual override.</p>
    <form onSubmit={mercy} className="pirate-form-grid">
      <CrewSelect id="gm-mercy-crew" label="Mercy for crew" value={crew} onChange={setCrew} crews={crews} />
      <div className="field"><label htmlFor="gm-mercy-minutes">Mercy minutes</label>
        <input id="gm-mercy-minutes" type="number" min="0" max="120" step="1" required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></div>
      <Reason id="gm-mercy-reason" label="Mercy change reason" value={reason} onChange={setReason} />
      <button type="submit" disabled={!!busy || !hasCrew(crews, crew) || !validMinutes || !validReason(reason)}>Set Mercy</button>
    </form>
  </section>
}

function ReplaceCaptain({ gameId, state, busy, run, rpc, refresh }) {
  const crews = state.crews ?? []
  const [crewId, setCrewId] = useState('')
  const [captain, setCaptain] = useState('')
  const [reason, setReason] = useState('')
  const crew = crews.find((item) => item.id === crewId)
  const members = crew?.members ?? []
  const isMember = members.some((member) => member.profile_id === captain)

  function replace(event) {
    event.preventDefault()
    if (!window.confirm('Give this player the crew’s compass and existing readings? The former captain will lose app access to them.')) return
    run(async () => {
      await rpc('gm_replace_captain', { g: gameId, crew: crewId, captain, reason, expected_captain: crew.captain_id ?? null })
      setReason('')
      refresh()
    }, { success: 'Captain replaced; crew readings and resources are preserved.' })
  }

  return <section className="command-card pirate-section">
    <h3>Replace the captain</h3>
    <p className="hint">Available in every unfinished phase. The new captain inherits existing crew readings. Previously copied notes cannot be withdrawn.</p>
    <form onSubmit={replace} className="pirate-form-grid">
      <CrewSelect id="gm-captain-crew" label="Captain’s crew" value={crewId} onChange={(value) => { setCrewId(value); setCaptain('') }} crews={crews} />
      <div className="field"><label htmlFor="gm-replacement-captain">New captain</label>
        <select id="gm-replacement-captain" value={isMember ? captain : ''} required onChange={(event) => setCaptain(event.target.value)}>
          <option value="">Choose player</option>
          {members.map((member) => <option key={member.profile_id} value={member.profile_id}>{member.name}</option>)}
        </select></div>
      <Reason id="gm-captain-reason" label="Captain replacement reason" value={reason} onChange={setReason} />
      <button type="submit" disabled={!!busy || state.phase === 'finished' || !isMember || captain === crew.captain_id || !validReason(reason)}>Replace captain</button>
    </form>
  </section>
}

export default function PirateGmControls(props) {
  return <><GrantClaim {...props} /><SetMercy {...props} /><ReplaceCaptain {...props} /></>
}
