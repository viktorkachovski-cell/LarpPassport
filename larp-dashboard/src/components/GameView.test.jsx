import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  channel: vi.fn(),
  from: vi.fn(),
  mapError: null,
  subscribed: null,
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

vi.mock('./MapPanel', () => ({ default: () => {
  if (mocks.mapError) throw mocks.mapError
  return <div>Map panel</div>
} }))
vi.mock('./CharactersPanel', () => ({ default: () => <div>Characters panel</div> }))
vi.mock('./TemplatePanel', () => ({ default: () => <div>Template panel</div> }))
vi.mock('./EventsPanel', () => ({ default: ({ pendingEvents }) => <div>Events panel {pendingEvents.map((e) => <span key={e.id}>{e.id}</span>)}</div> }))
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
  let pending = false
  const builder = {
    delete() {
      operation = 'delete'
      return builder
    },
    eq(key, value) {
      if (key === 'status' && value === 'pending') pending = true
      return builder
    },
    lt() { return builder },
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
      return Promise.resolve(resultFor(pending ? `${table}_pending` : table, operation))
    },
    then(resolve, reject) {
      return Promise.resolve(resultFor(pending ? `${table}_pending` : table, operation)).then(resolve, reject)
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
  mocks.mapError = null
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
  realtimeChannel.subscribe.mockImplementation((cb) => { mocks.subscribed = cb; return realtimeChannel })
  mocks.channel.mockReturnValue(realtimeChannel)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GameView access and mutation errors', () => {
  it('keeps the hunt usable when the map fails to initialize', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mocks.mapError = new Error('WebGL unavailable')
      mocks.queryResults.games = { data: game(), error: null }
      render(<GameView gameId="game-1" session={{ user: { id: 'gm-user' } }} onBack={() => {}} />)
      await screen.findByText('Test game')
      fireEvent.click(screen.getByRole('button', { name: 'MAP', exact: true }))
      await screen.findByText('The map could not load. Check your connection and reload to try again.')
      fireEvent.click(screen.getByRole('button', { name: 'HUNT', exact: true }))
      expect(screen.getByText('Hunt panel')).toBeTruthy()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('loads the map on first use and keeps it mounted between tabs', async () => {
    mocks.queryResults.games = { data: game(), error: null }
    render(<GameView gameId="game-1" session={{ user: { id: 'gm-user' } }} onBack={() => {}} />)
    await screen.findByText('Test game')
    expect(screen.queryByText('Map panel')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'MAP', exact: true }))
    await screen.findByText('Map panel')
    fireEvent.click(screen.getByRole('button', { name: 'HUNT', exact: true }))
    expect(screen.getByText('Map panel')).toBeTruthy()
  })

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

describe('GameView authoritative recovery', () => {
  it('keeps an unresolved event independently of 300 newer timeline entries', async () => {
    mocks.queryResults.games = { data: game(), error: null }
    mocks.queryResults.game_events = { data: Array.from({ length: 300 }, (_, i) => ({ id: `new-${i}`, seq: 400-i, status: 'confirmed' })), error: null }
    mocks.queryResults.game_events_pending = { data: [{ id: 'old-pending', seq: 1, status: 'pending' }], error: null }
    render(<GameView gameId="game-1" session={{ user: { id: 'gm-user' } }} onBack={() => {}} />)
    await screen.findByText('Hunt panel')
    fireEvent.click(screen.getByRole('button', { name: /EVENTS/ }))
    expect(await screen.findByText('old-pending')).toBeTruthy()
  })

  it('refreshes game status after reconnect and recovers a failed request on retry', async () => {
    mocks.queryResults.games = { data: null, error: { message: 'Network unavailable' } }
    render(<GameView gameId="game-1" session={{ user: { id: 'gm-user' } }} onBack={() => {}} />)
    await screen.findByText('Network unavailable')
    mocks.queryResults.games = { data: game(), error: null }
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await screen.findByText('Hunt panel')
    mocks.queryResults.games = { data: { ...game(), status: 'finished' }, error: null }
    act(() => mocks.subscribed('SUBSCRIBED'))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Game status' }).value).toBe('finished'))
  })

  it('ignores an older snapshot that finishes after a newer refresh', async () => {
    let resolveOld
    mocks.queryResults.games = new Promise((resolve) => { resolveOld = resolve })
    render(<GameView gameId="game-1" session={{ user: { id: 'gm-user' } }} onBack={() => {}} />)
    mocks.queryResults.games = { data: { ...game(), status: 'finished' }, error: null }
    act(() => window.dispatchEvent(new Event('focus')))
    await screen.findByText('Hunt panel')
    await act(async () => resolveOld({ data: game(), error: null }))
    expect(screen.getByRole('combobox', { name: 'Game status' }).value).toBe('finished')
  })
})
