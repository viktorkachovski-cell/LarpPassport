import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  from: vi.fn(),
  mutationPatches: [],
  mutationResults: {},
  queryResults: {},
  removeChannel: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  GAME_COLUMNS:
    'id, gm_id, name, template, location_visibility, status, purge_after_days, created_at',
  supabase: {
    channel: mocks.channel,
    from: mocks.from,
    removeChannel: mocks.removeChannel,
    rpc: mocks.rpc,
  },
}))

vi.mock('./MapPanel', () => ({ default: () => <div>Map panel</div> }))
vi.mock('./CharactersPanel', () => ({ default: () => <div>Characters panel</div> }))
vi.mock('./TemplatePanel', () => ({ default: () => <div>Template panel</div> }))
vi.mock('./EventsPanel', () => ({ default: () => <div>Events panel</div> }))
vi.mock('./PlayersPanel', () => ({ default: () => <div>Players panel</div> }))
vi.mock('./HuntPanel', () => ({ default: () => <div>Hunt panel</div> }))

import GameView from './GameView'

function resultFor(table, operation) {
  if (operation === 'update') {
    return mocks.mutationResults[table] ?? { data: null, error: null }
  }
  return mocks.queryResults[table] ?? { data: [], error: null }
}

function queryBuilder(table) {
  let operation = 'select'
  const builder = {
    delete() {
      operation = 'delete'
      return builder
    },
    eq() {
      return builder
    },
    insert() {
      operation = 'insert'
      return builder
    },
    limit() {
      return builder
    },
    order() {
      return builder
    },
    select() {
      return builder
    },
    single() {
      return Promise.resolve(resultFor(table, operation))
    },
    then(resolve, reject) {
      return Promise.resolve(resultFor(table, operation)).then(resolve, reject)
    },
    update(patch) {
      operation = 'update'
      mocks.mutationPatches.push({ patch, table })
      return builder
    },
  }
  return builder
}

function game(gmId = 'gm-user') {
  return {
    gm_id: gmId,
    id: 'game-1',
    join_code: 'ABCDEFGH',
    location_visibility: 'gm_only',
    name: 'Test game',
    status: 'draft',
  }
}

beforeEach(() => {
  mocks.mutationPatches.length = 0
  mocks.mutationResults = {}
  mocks.queryResults = {}
  mocks.from.mockImplementation((table) => queryBuilder(table))
  mocks.rpc.mockImplementation((fn) => Promise.resolve(
    fn === 'gm_get_join_code'
      ? { data: 'ABCDEFGH', error: null }
      : { data: { claims: [], phase: 'not_started', players: [] }, error: null },
  ))

  const realtimeChannel = {
    on: vi.fn(),
    subscribe: vi.fn(),
  }
  realtimeChannel.on.mockReturnValue(realtimeChannel)
  realtimeChannel.subscribe.mockReturnValue(realtimeChannel)
  mocks.channel.mockReturnValue(realtimeChannel)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GameView access and mutation errors', () => {
  it('does not fetch dashboard data or subscribe for a non-GM', async () => {
    mocks.queryResults = {
      game_players: {
        data: [{ profile_id: 'player-user', profile: { username: 'player' }, role: 'player' }],
        error: null,
      },
      games: { data: game(), error: null },
    }

    render(
      <GameView
        gameId="game-1"
        session={{ user: { id: 'player-user' } }}
        onBack={() => {}}
      />
    )

    await screen.findByText('GM access required')

    expect(mocks.from.mock.calls.map(([table]) => table).sort()).toEqual(['game_players', 'games'])
    expect(mocks.channel).not.toHaveBeenCalled()
  })

  it('shows a database error when a GM mutation fails', async () => {
    mocks.queryResults = {
      characters: { data: [], error: null },
      factions: { data: [], error: null },
      game_events: { data: [], error: null },
      game_players: {
        data: [{ profile_id: 'gm-user', profile: { username: 'gm' }, role: 'gm' }],
        error: null,
      },
      games: { data: game(), error: null },
      player_positions_view: { data: [], error: null },
      zones_view: { data: [], error: null },
    }
    mocks.mutationResults = {
      games: { data: null, error: new Error('permission denied') },
    }

    render(
      <GameView
        gameId="game-1"
        session={{ user: { id: 'gm-user' } }}
        onBack={() => {}}
      />
    )

    await screen.findByText('Test game')
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'active' } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('permission denied')
    expect(mocks.mutationPatches).toEqual([{ patch: { status: 'active' }, table: 'games' }])
  })
})
