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

export default function GameScreen({ gameId, session: auth, onBack }) {
  const syncLog = useSyncLog()
  const { data: pirate, error: pirateError, load: loadPirate } = useGameRpc('get_pirate_state', gameId, syncLog)
  const session = useGameSession({ gameId, uid: auth.user.id, syncLog, loadMode: loadPirate })
  const [selectedTab, setTab] = useState('sites')
  const { sendNow } = session
  // Sends queued positions, then asks the server which site this is.
  const checkSpot = useCallback(async () => { await sendNow(); await loadPirate() }, [sendNow, loadPirate])
  const modeTabs = pirate?.is_captain ? CAPTAIN_TABS : CREW_TABS
  const tab = selectedTab === 'compass' && !pirate?.is_captain ? 'sites' : selectedTab

  const phase = pirate?.phase ?? session.game?.phase ?? ''
  const state = pirate ?? (phase ? { phase } : null)
  const name = phaseName(phase)
  const phaseColor = pirate?.paused ? C.red : phase === 'finished' ? C.muted : C.amber
  const hint = phaseHint(state)

  return (
    <GameFrame
      session={session} onBack={onBack} tab={tab} setTab={setTab}
      modeTabs={modeTabs} eventsLabel="Log" sheetTab={null} shareTab={null} gpsInHeader
      phase={phase} phaseLabel={pirate?.paused ? 'Paused' : name.short} phaseColor={phaseColor}
      phaseHint={hint ? `${name.long}. ${hint}` : name.long}
      cells={<>
        <StateCell value={pirate?.shards ?? '--'} label="Shards" />
        <StateCell value={pirate?.doubloons ?? '--'} label="Doubloons" color={C.brassLight} bordered />
        <StateCell value={pirate ? `${(pirate.oath ?? []).length}/4` : '--'} label="Oath words" />
      </>}
    >
      {(tab === 'sites' || tab === 'compass') && (
        <PiratePanel mode={tab} state={pirate} error={pirateError}
          gameId={gameId} refresh={loadPirate} sharing={session.sharing} checkSpot={checkSpot} />
      )}
      {tab === 'parley' && <ParleyPanel state={pirate} error={pirateError} gameId={gameId} refresh={loadPirate} />}
      {tab === 'hold' && <HoldPanel state={pirate} error={pirateError} session={session} />}
    </GameFrame>
  )
}
