import { useCallback, useState } from 'react'
import { C } from '../lib/theme'
import { HoldPanel } from '../pirate/HoldPanel'
import { ParleyPanel } from '../pirate/ParleyPanel'
import { PiratePanel } from '../pirate/PiratePanel'
import { phaseHint, phaseName } from '../pirate/phases'
import { GameFrame, StateCell } from './game/GameFrame'
import { useGameRpc, useGameSession, useSyncLog } from './game/session'

// Only the crew's captain carries the compass. The player's own pirate lives
// in the Hold; location sharing opens from the GPS button in the header.
const CREW_TABS = [['sites', 'Sites'], ['parley', 'Parley'], ['hold', 'Hold']]
const CAPTAIN_TABS = [['sites', 'Sites'], ['compass', 'Compass'], ['parley', 'Parley'], ['hold', 'Hold']]

// The header follows the game row until the first Pirate state arrives.
function phaseHeader(pirate, game) {
  const phase = pirate?.phase ?? game?.phase ?? ''
  const name = phaseName(phase)
  const hint = phaseHint(pirate ?? (phase ? { phase } : null))
  return {
    phase,
    phaseLabel: pirate?.paused ? 'Paused' : name.short,
    phaseColor: pirate?.paused ? C.red : phase === 'finished' ? C.muted : C.amber,
    phaseHint: hint ? `${name.long}. ${hint}` : name.long,
  }
}

function PirateCells({ pirate }) {
  return <>
    <StateCell value={pirate?.shards ?? '--'} label="Shards" />
    <StateCell value={pirate?.doubloons ?? '--'} label="Doubloons" color={C.brassLight} bordered />
    <StateCell value={pirate ? `${(pirate.oath ?? []).length}/4` : '--'} label="Oath lines" />
  </>
}

export default function GameScreen({ gameId, session: auth, onBack }) {
  const syncLog = useSyncLog()
  const { data: pirate, error: pirateError, load: loadPirate } = useGameRpc('get_pirate_state', gameId, syncLog)
  const session = useGameSession({ gameId, uid: auth.user.id, syncLog, loadMode: loadPirate })
  const [selectedTab, setTab] = useState('sites')
  const { sendNow } = session
  // Sends queued positions, then asks the server which site this is.
  const checkSpot = useCallback(async () => { await sendNow(); await loadPirate() }, [sendNow, loadPirate])
  const captain = !!pirate?.is_captain
  const tab = selectedTab === 'compass' && !captain ? 'sites' : selectedTab
  const panel = { state: pirate, error: pirateError, gameId, refresh: loadPirate }

  return (
    <GameFrame
      session={session} onBack={onBack} tab={tab} setTab={setTab}
      modeTabs={captain ? CAPTAIN_TABS : CREW_TABS} eventsLabel="Log" sheetTab={null} shareTab={null} gpsInHeader
      {...phaseHeader(pirate, session.game)} cells={<PirateCells pirate={pirate} />}
    >
      {(tab === 'sites' || tab === 'compass') && <PiratePanel mode={tab} sharing={session.sharing} checkSpot={checkSpot} {...panel} />}
      {tab === 'parley' && <ParleyPanel {...panel} />}
      {tab === 'hold' && <HoldPanel state={pirate} error={pirateError} session={session} />}
    </GameFrame>
  )
}
