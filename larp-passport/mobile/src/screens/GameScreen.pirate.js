import { useState } from 'react'
import { C } from '../lib/theme'
import { ParleyPanel } from '../pirate/ParleyPanel'
import { PiratePanel } from '../pirate/PiratePanel'
import { GameFrame, StateCell } from './game/GameFrame'
import { useGameRpc, useGameSession, useSyncLog } from './game/session'

const MODE_TABS = [['chart', 'CHART'], ['compass', 'COMPASS'], ['parley', 'PARLEY']]

export default function GameScreen({ gameId, session: auth, onBack }) {
  const syncLog = useSyncLog()
  const { data: pirate, error: pirateError, load: loadPirate } = useGameRpc('get_pirate_state', gameId, syncLog)
  const session = useGameSession({ gameId, uid: auth.user.id, syncLog, loadMode: loadPirate })
  const [tab, setTab] = useState('chart')

  const phase = pirate?.phase ?? session.game?.phase ?? ''
  const phaseColor = pirate?.paused ? C.red : phase === 'finished' ? C.muted : C.amber

  return (
    <GameFrame
      session={session} onBack={onBack} tab={tab} setTab={setTab}
      modeTabs={MODE_TABS} eventsLabel="LOGBOOK" scrollTabs
      phase={phase} phaseLabel={phase.toUpperCase()} phaseColor={phaseColor}
      cells={<>
        <StateCell value={pirate?.shards ?? '--'} label="BEARING SHARDS" />
        <StateCell value={pirate?.doubloons ?? '--'} label="DOUBLOONS" color={C.amber} bordered />
        <StateCell value={pirate?.paused ? 'PAUSED' : phase.toUpperCase()} label="THE TIDE" color={pirate?.paused ? C.red : C.cyan} />
      </>}
    >
      {(tab === 'chart' || tab === 'compass') && (
        <PiratePanel mode={tab} state={pirate} error={pirateError} gameId={gameId} refresh={loadPirate} />
      )}
      {tab === 'parley' && <ParleyPanel state={pirate} error={pirateError} gameId={gameId} refresh={loadPirate} />}
    </GameFrame>
  )
}
