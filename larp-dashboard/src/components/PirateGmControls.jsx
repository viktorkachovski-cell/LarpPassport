import { useRef, useState } from 'react'

function CrewSelect({ id, label, value, onChange, crews }) {
  return <div className="field"><label htmlFor={id}>{label}</label>
    <select id={id} value={crews.some((crew) => crew.id === value) ? value : ''} required onChange={(event) => onChange(event.target.value)}>
      <option value="">Choose crew</option>
      {crews.map((crew) => <option key={crew.id} value={crew.id}>{crew.name}</option>)}
    </select></div>
}

function Reason({ id, label, value, onChange }) {
  return <div className="field"><label htmlFor={id}>{label}</label>
    <input id={id} value={value} required minLength={3} maxLength={300} onChange={(event) => onChange(event.target.value)} /></div>
}

export default function PirateGmControls({ gameId, state, busy, run, rpc, refresh }) {
  const crews = state.crews ?? []
  const [claimCrew, setClaimCrew] = useState('')
  const [siteId, setSiteId] = useState('')
  const [claimReason, setClaimReason] = useState('')
  const pendingClaim = useRef(null)
  const [mercyCrew, setMercyCrew] = useState('')
  const [minutes, setMinutes] = useState('15')
  const [mercyReason, setMercyReason] = useState('')
  const [captainCrew, setCaptainCrew] = useState('')
  const [captain, setCaptain] = useState('')
  const [captainReason, setCaptainReason] = useState('')
  const captainTarget = crews.find((crew) => crew.id === captainCrew)
  const riddles = (state.sites ?? []).filter((site) => site.kind === 'riddle')
  const validReason = (reason) => reason.trim().length >= 3
  const hasCrew = (id) => crews.some((crew) => crew.id === id)
  const mercyMinutes = Number(minutes)

  function claim(event) {
    event.preventDefault()
    if (!window.confirm('Grant this crew the normal next-rank riddle rewards without GPS, answer or phase checks?')) return
    const signature = JSON.stringify([gameId, claimCrew, siteId, claimReason.trim()])
    if (pendingClaim.current?.signature !== signature) pendingClaim.current = { signature, idem: crypto.randomUUID() }
    const idem = pendingClaim.current.idem
    run(async () => {
      await rpc('gm_claim_for', { g: gameId, crew: claimCrew, zone_id: siteId, reason: claimReason.trim(), idem }, ['ok', 'already_claimed'])
      pendingClaim.current = null // retain only on an uncertain network result
      setClaimReason('')
      refresh()
    }, { success: 'Claim checked: normal rewards recorded once, or the crew already holds this riddle.' })
  }

  function mercy(event) {
    event.preventDefault()
    if (!window.confirm(mercyMinutes === 0 ? 'Clear this crew’s current Mercy?' : 'Replace this crew’s current Mercy with the selected duration?')) return
    run(async () => {
      await rpc('gm_set_mercy', { g: gameId, crew: mercyCrew, minutes: mercyMinutes, reason: mercyReason })
      setMercyReason('')
      refresh()
    }, { success: 'Mercy updated with a recorded reason.' })
  }

  function replaceCaptain(event) {
    event.preventDefault()
    if (!window.confirm('Give this player the crew’s compass and existing readings? The former captain will lose app access to them.')) return
    run(async () => {
      await rpc('gm_replace_captain', { g: gameId, crew: captainCrew, captain, reason: captainReason, expected_captain: captainTarget.captain_id ?? null })
      setCaptainReason('')
      refresh()
    }, { success: 'Captain replaced; crew readings and resources are preserved.' })
  }

  return <>
    <section className="command-card pirate-section">
      <h3>Grant a riddle claim</h3>
      <p className="hint">GM recovery for a verified solve or an outage. Bypasses GPS, answer, pause and phase checks, including after finishing. Grants the normal current-rank reward once; a reason identifies the GM.</p>
      <form onSubmit={claim} className="pirate-form-grid">
        <CrewSelect id="gm-claim-crew" label="Claim for crew" value={claimCrew} onChange={setClaimCrew} crews={crews} />
        <div className="field"><label htmlFor="gm-claim-site">Riddle</label>
          <select id="gm-claim-site" value={riddles.some((site) => site.zone_id === siteId) ? siteId : ''} required onChange={(event) => setSiteId(event.target.value)}>
            <option value="">Choose riddle</option>
            {riddles.map((site) => <option key={site.zone_id} value={site.zone_id}>{site.name}{!site.active && ' (inactive)'}</option>)}
          </select></div>
        <Reason id="gm-claim-reason" label="GM claim reason" value={claimReason} onChange={setClaimReason} />
        <button type="submit" disabled={!!busy || !hasCrew(claimCrew) || !riddles.some((site) => site.zone_id === siteId) || !validReason(claimReason)}>Grant claim</button>
      </form>
    </section>
    <section className="command-card pirate-section">
      <h3>Set Davy’s Mercy</h3>
      <p className="hint">Replace the crew’s current immunity with 0–120 minutes. Zero clears it. Voiding an older Parley cannot erase this manual override.</p>
      <form onSubmit={mercy} className="pirate-form-grid">
        <CrewSelect id="gm-mercy-crew" label="Mercy for crew" value={mercyCrew} onChange={setMercyCrew} crews={crews} />
        <div className="field"><label htmlFor="gm-mercy-minutes">Mercy minutes</label>
          <input id="gm-mercy-minutes" type="number" min="0" max="120" step="1" required value={minutes} onChange={(event) => setMinutes(event.target.value)} /></div>
        <Reason id="gm-mercy-reason" label="Mercy change reason" value={mercyReason} onChange={setMercyReason} />
        <button type="submit" disabled={!!busy || !hasCrew(mercyCrew) || minutes === '' || !Number.isInteger(mercyMinutes) || mercyMinutes < 0 || mercyMinutes > 120 || !validReason(mercyReason)}>Set Mercy</button>
      </form>
    </section>
    <section className="command-card pirate-section">
      <h3>Replace the captain</h3>
      <p className="hint">Available in every unfinished phase. The new captain inherits existing crew readings. Previously copied notes cannot be withdrawn.</p>
      <form onSubmit={replaceCaptain} className="pirate-form-grid">
        <CrewSelect id="gm-captain-crew" label="Captain’s crew" value={captainCrew} onChange={(value) => { setCaptainCrew(value); setCaptain('') }} crews={crews} />
        <div className="field"><label htmlFor="gm-replacement-captain">New captain</label>
          <select id="gm-replacement-captain" value={captainTarget?.members?.some((member) => member.profile_id === captain) ? captain : ''} required onChange={(event) => setCaptain(event.target.value)}>
            <option value="">Choose player</option>
            {(captainTarget?.members ?? []).map((member) => <option key={member.profile_id} value={member.profile_id}>{member.name}</option>)}
          </select></div>
        <Reason id="gm-captain-reason" label="Captain replacement reason" value={captainReason} onChange={setCaptainReason} />
        <button type="submit" disabled={!!busy || state.phase === 'finished' || !captainTarget?.members?.some((member) => member.profile_id === captain) || captain === captainTarget?.captain_id || !validReason(captainReason)}>Replace captain</button>
      </form>
    </section>
  </>
}
