import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { ErrorBoundary } from '@sentry/react'
import { GAME_COLUMNS, supabase } from '../lib/supabase'
import { unwrap } from '../lib/unwrap'
import { eventInfo } from '../lib/events'
import { PIRATE_MODE, ruledInModeTab } from '../lib/gameModes'
import { useGameData } from '../lib/useGameData'
import CharactersPanel from './CharactersPanel'
import TemplatePanel from './TemplatePanel'
import EventsPanel from './EventsPanel'
import PlayersPanel from './PlayersPanel'
import HuntPanel from './HuntPanel'
import PiratePanel from './PiratePanel'
import SyncStatus from './SyncStatus'

const MapPanel = lazy(() => import('./MapPanel'))

const ZONE_FIELDS = [
  'name', 'zone_type', 'trigger_mode', 'dwell_seconds', 'exit_buffer_m', 'one_shot', 'active',
  'radius_m', 'warning_distance_m', 'payload',
]

// The database keeps a game 'active' and GM-only for as long as its hunt
// round is active (protect_active_hunt_game), draft after a reset and
// finished with the round.
const GAME_FOR_HUNT_PHASE = {
  not_started: { status: 'draft' },
  active: { status: 'active', location_visibility: 'gm_only' },
  finished: { status: 'finished' },
}

function GameTopbar({ game, mode, onBack, refresh, update }) {
  const [copied, setCopied] = useState(false)
  function copyCode() {
    if (!game.join_code) return
    navigator.clipboard?.writeText(game.join_code)
    setCopied(true); setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="topbar">
      <button className="ghost back-control" onClick={onBack} aria-label="Back to games">←</button>
      <span className="title display">{game.name}</span>
      <button className="code-chip" onClick={copyCode} title="Copy join code" aria-label={game.join_code ? `Join code ${game.join_code.split('').join(' ')}, copy to clipboard` : 'Join code not loaded'} aria-live="polite">{copied ? 'COPIED' : game.join_code ?? '········'}</button>
      <span className="spacer" />
      <div className="topbar-control">
        <span className="control-label">STATUS</span>
        <select className={`status-select status-${game.status}`} aria-label="Game status" value={game.status}
          disabled={mode.statusFollowsPhase} title={mode.statusFollowsPhase ? 'Pirate status follows the phase controls' : undefined}
          onChange={(e) => update({ status: e.target.value })}>
          <option value="draft">DRAFT</option>
          <option value="active">ACTIVE</option>
          <option value="finished">FINISHED</option>
        </select>
      </div>
      <div className="topbar-control">
        <span className="control-label">WHO SEES POSITIONS</span>
        <select aria-label="Position visibility" value={game.location_visibility} onChange={(e) => update({ location_visibility: e.target.value })}>
          <option value="gm_only">GMs only</option>
          <option value="faction">Same faction</option>
          <option value="all">Everyone</option>
        </select>
      </div>
      {mode.directionControl && <div className="topbar-control">
        <span className="control-label">HUNTER DIRECTION</span>
        <select aria-label="Hunter direction to target" title="On: living hunters see a true-north bearing to their target and only the distance band. Off: rounded metres, no bearing."
          value={game.direction_enabled ? 'on' : 'off'} onChange={(e) => update({ direction_enabled: e.target.value === 'on' })}>
          <option value="off">Off (bands + metres)</option>
          <option value="on">On (bearing + bands)</option>
        </select>
      </div>}
      <button className="ghost" onClick={refresh}>Refresh</button><span className="gm-chip">GM</span>
    </div>
  )
}

function PendingDecisions({ decisions, tabs, activeTab, setTab }) {
  if (decisions.length === 0) return null
  return (
    <div className="pending-decisions" role="region" aria-label="Pending decisions" aria-live="polite">
      <b>{decisions.length} DECISION{decisions.length === 1 ? '' : 'S'} WAITING</b>
      {tabs.map((target) => {
        const items = decisions.filter((item) => item.tab === target)
        if (items.length === 0) return null
        return (
          <span key={target} className="row">
            <span>{items.map((item) => item.text).join(' · ')}</span>
            {activeTab !== target && <button type="button" className="ghost" onClick={() => setTab(target)}>Open {target[0].toUpperCase() + target.slice(1)}</button>}
          </span>
        )
      })}
    </div>
  )
}

// The screen before the dashboard: loading, a failed first load, or no GM access.
function GameGate({ game, loadError, refresh, onBack }) {
  if (loadError && !game) return <div className="center-screen"><p className="error" role="alert">{loadError}</p><button onClick={refresh}>Retry</button><button onClick={onBack}>Back</button></div>
  if (!game) return <div className="center-screen"><p className="hint" role="status">Loading game…</p></div>
  return (
    <div className="center-screen">
      <div className="card access-card">
        <h2 className="display">GM access required</h2>
        <p className="hint">This dashboard controls the live game. Players should use the LARP Passport mobile app.</p>
        <button onClick={onBack}>Back to games</button>
      </div>
    </div>
  )
}

// The mode tab until the GM picks another tab this mode has.
const activeTabOf = (mode, tab) => (mode?.tabs.includes(tab) ? tab : mode?.key)

// Mounted on first use and kept mounted (hidden) so the map keeps its state.
function MapTab({ visible, ...props }) {
  return (
    <div style={{ display: visible ? 'block' : 'none', height: '100%' }}>
      <ErrorBoundary fallback={
        <div className="panel-pad" role="alert">
          <p>The map could not load. Check your connection and reload to try again.</p>
          <button onClick={() => window.location.reload()}>Reload dashboard</button>
        </div>
      }>
        <Suspense fallback={<p className="hint" role="status">Loading map…</p>}>
          <MapPanel active={visible} {...props} />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default function GameView({ gameId, session, onBack }) {
  const uid = session.user.id
  const [actionError, setActionError] = useState('')
  const data = useGameData(gameId, uid, setActionError)
  const { game, setGame, members, zones, positions, characters, factions, pendingEvents, modeState, isGm, mode, refresh } = data
  const [tab, setTab] = useState(null)
  const [mapOpened, setMapOpened] = useState(false)
  // Bumped to ask the map to fly to the Pirate treasure point.
  const [treasureFocus, setTreasureFocus] = useState(0)
  const activeTab = activeTabOf(mode, tab)
  const pirateState = mode === PIRATE_MODE ? modeState : null
  const openTab = (next) => { if (next === 'map') setMapOpened(true); setTab(next) }

  // Failures of writes that no panel reports itself go to the banner.
  const reportFailure = useCallback((promise) => promise.catch((error) => setActionError(error.message)), [])

  const usernameOf = useCallback((profileId) => {
    const m = members.find((x) => x.profile_id === profileId)
    return m?.profile?.username ?? positions[profileId]?.username ?? 'unknown'
  }, [members, positions])

  const zoneNameOf = useCallback((zoneId) => zones.find((z) => z.id === zoneId)?.name ?? 'a zone', [zones])

  // Pending events the Events tab and map rule on; Parley disputes are ruled
  // on in the Pirate tab.
  const eventQueue = useMemo(() => pendingEvents.filter((event) => !ruledInModeTab(event)), [pendingEvents])

  // Pending GM decisions, derived from authoritative state only: the mode
  // state and the fully paginated pending-event query, never the capped
  // history page.
  const decisions = useMemo(() => {
    if (!mode) return []
    const breaches = eventQueue.filter((event) => eventInfo(event.type).breach).length
    const triggers = eventQueue.length - breaches
    return [
      ...mode.decisions(modeState).map((item) => ({ ...item, tab: mode.key })),
      breaches && { key: 'breach', tab: 'events', text: `${breaches} boundary breach${breaches === 1 ? '' : 'es'} to review` },
      triggers && { key: 'trigger', tab: 'events', text: `${triggers} zone trigger${triggers === 1 ? '' : 's'} to confirm` },
    ].filter(Boolean)
  }, [mode, modeState, eventQueue])

  // Every GM write discards any snapshot still in flight and clears the
  // banner once it succeeds. Failures throw to the panel that started the
  // write, which reports them. RLS and the RPCs are the access check.
  const gmWrite = (write) => async (...args) => {
    data.invalidate()
    const result = await write(...args)
    setActionError('')
    return result
  }

  // Hunt RPCs return the new admin state; the game row follows its phase.
  const huntRpc = (name, argsOf) => gmWrite(async (...args) => {
    const state = unwrap(await supabase.rpc(name, argsOf(...args)))
    data.setModeState(state)
    setGame((current) => ({ ...current, ...GAME_FOR_HUNT_PHASE[state.phase] }))
  })

  const resolveEvent = (patch) => gmWrite(async (ev) => {
    data.putEvent(unwrap(await supabase.from('game_events')
      .update({ ...patch, resolved_at: new Date().toISOString(), resolved_by: uid }).eq('id', ev.id).select().single()))
  })

  const updateGame = gmWrite(async (patch) => {
    const row = unwrap(await supabase.from('games').update(patch).eq('id', gameId).select(GAME_COLUMNS).single())
    setGame((current) => ({ ...row, join_code: current?.join_code }))
  })
  const confirmEvent = resolveEvent({ status: 'confirmed', player_visible: true })
  const dismissEvent = resolveEvent({ status: 'dismissed' })
  const saveZone = gmWrite(async (draft) => {
    const fields = Object.fromEntries(ZONE_FIELDS.map((key) => [key, draft[key]]))
    unwrap(draft.id
      ? await supabase.from('zones').update(fields).eq('id', draft.id)
      : await supabase.from('zones').insert({ ...fields, game_id: gameId, shape: draft.shape, geog: draft.geog }))
    await data.loadZones()
  })
  const deleteZone = gmWrite(async (id) => {
    unwrap(await supabase.from('zones').delete().eq('id', id))
    await data.loadZones()
  })
  const saveCharacter = gmWrite(async (id, patch) => unwrap(await supabase.from('characters').update(patch).eq('id', id)))
  const addNpc = gmWrite(async (name) => unwrap(await supabase.from('characters').insert({ game_id: gameId, user_id: uid, name, is_npc: true })))
  const deleteCharacter = gmWrite(async (id) => unwrap(await supabase.from('characters').delete().eq('id', id)))
  const addFaction = gmWrite(async (name, color) => {
    const row = unwrap(await supabase.from('factions').insert({ game_id: gameId, name, color }).select().single())
    data.setFactions((prev) => [...prev, row])
  })
  const broadcast = gmWrite(async (targetProfileIds, message) => unwrap(await supabase.from('game_events').insert(
    targetProfileIds.map((pid) => ({
      game_id: gameId, profile_id: pid, type: 'gm_note', status: 'confirmed', player_visible: true,
      payload: { message },
    })),
  )))
  const memberWrite = (write) => gmWrite(async (profileId, ...args) => {
    unwrap(await write(supabase.from('game_players'), ...args).eq('game_id', gameId).eq('profile_id', profileId))
    await data.loadMembers()
  })
  const setMemberRole = memberWrite((table, role) => table.update({ role }))
  const removeMember = memberWrite((table) => table.delete())

  if (!game || !isGm) return <GameGate game={game} loadError={data.loadError} refresh={refresh} onBack={onBack} />

  return (
    <div className="game-shell">
      <GameTopbar game={game} mode={mode} onBack={onBack} refresh={refresh} update={(patch) => reportFailure(updateGame(patch))} />
      <SyncStatus sync={data.sync} realtime={data.realtime} online={data.online} onRetry={refresh} />
      <PendingDecisions decisions={decisions} tabs={[mode.key, 'events']} activeTab={activeTab} setTab={setTab} />
      <div className="tabs" role="tablist" aria-label="Game sections">
        {mode.tabs.map((t) => (
          <button key={t} role="tab" aria-selected={activeTab === t} className={activeTab === t ? 'active' : ''} onClick={() => openTab(t)}>
            {t.toUpperCase()}
            {t === 'events' && eventQueue.length > 0 && <span className="badge" aria-label={`${eventQueue.length} pending`}>{eventQueue.length}</span>}
          </button>
        ))}
      </div>
      {actionError && (
        <div className="action-error" role="alert">
          <span>{actionError}</span>
          <button className="ghost" onClick={() => setActionError('')}>Dismiss</button>
        </div>
      )}
      <div className={`tab-body ${activeTab === 'map' ? 'no-scroll' : ''}`}>
        {activeTab === 'pirate' && <PiratePanel game={game} state={pirateState} zones={zones}
          refresh={refresh} onShowTreasure={() => { openTab('map'); setTreasureFocus((count) => count + 1) }} />}
        {activeTab === 'hunt' && (
          <HuntPanel
            hunt={modeState}
            members={members}
            characters={characters}
            startHunt={huntRpc('start_hunt', () => ({ g: gameId }))}
            resetHunt={huntRpc('reset_hunt', () => ({ g: gameId }))}
            resolveClaim={huntRpc('gm_resolve_elimination', (claimId, confirmed) => ({ claim_id: claimId, confirm_elimination: confirmed }))}
            eliminatePlayer={huntRpc('gm_eliminate_player', (profileId) => ({ g: gameId, victim_id: profileId }))}
            restorePlayer={huntRpc('gm_restore_player', (profileId) => ({ g: gameId, profile_id: profileId }))}
            saveChain={huntRpc('gm_set_hunt_chain', (profileIds) => ({ g: gameId, player_ids: profileIds }))}
            assignNextTarget={huntRpc('gm_assign_next_target', (profileId) => ({ g: gameId, hunter_id: profileId }))}
            refresh={refresh}
          />
        )}
        {mapOpened && <MapTab visible={activeTab === 'map'}
          zones={zones} positions={positions} members={members} characters={characters} factions={factions}
          pendingEvents={eventQueue} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
          saveZone={saveZone} deleteZone={deleteZone} confirmEvent={confirmEvent} dismissEvent={dismissEvent}
          treasure={pirateState?.treasure} treasureFocus={treasureFocus} />}
        {activeTab === 'characters' && (
          <CharactersPanel game={game} characters={characters} factions={factions}
            usernameOf={usernameOf} saveCharacter={saveCharacter} addNpc={addNpc} deleteCharacter={deleteCharacter}
            addFaction={addFaction} />
        )}
        {activeTab === 'template' && <TemplatePanel game={game} hasCharacters={characters.length > 0} updateGame={updateGame} />}
        {activeTab === 'events' && (
          <EventsPanel events={data.history} pendingEvents={eventQueue} loadOlder={data.loadOlder} hasMore={data.hasMore} historyBusy={data.historyBusy} members={members} usernameOf={usernameOf} zoneNameOf={zoneNameOf}
            confirmEvent={confirmEvent} dismissEvent={dismissEvent} broadcast={broadcast} onOpenHunt={() => setTab('hunt')} />
        )}
        {activeTab === 'players' && (
          <PlayersPanel members={members} positions={positions} uid={uid} game={game}
            setMemberRole={setMemberRole} removeMember={removeMember} updateGame={updateGame} />
        )}
      </div>
    </div>
  )
}
