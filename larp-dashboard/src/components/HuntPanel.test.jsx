import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HuntPanel from './HuntPanel'

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const members = [
  { profile_id: 'player-1', role: 'player' },
  { profile_id: 'player-2', role: 'player' },
  { profile_id: 'gm-1', role: 'gm' },
]
const characters = [
  { id: 'char-1', is_npc: false, user_id: 'player-1' },
  { id: 'char-2', is_npc: false, user_id: 'player-2' },
]
const player = (n, name, extra) => ({ character_name: name, profile_id: `player-${n}`, state: 'alive', username: name.toLowerCase(), ...extra })
const claim = (status) => ({ hunter_name: 'Ariadne', id: 'claim-1', requested_at: new Date().toISOString(), status, victim_name: 'Chronos' })
const ring = [
  player(1, 'Ariadne', { target_name: 'Chronos', target_profile_id: 'player-2' }),
  player(2, 'Chronos', { target_name: 'Ariadne', target_profile_id: 'player-1' }),
]

function mount(hunt, overrides = {}) {
  const props = {
    assignNextTarget: vi.fn().mockResolvedValue(null), eliminatePlayer: vi.fn().mockResolvedValue(null),
    resolveClaim: vi.fn().mockResolvedValue(null), restorePlayer: vi.fn().mockResolvedValue(null),
    saveChain: vi.fn().mockResolvedValue(null), startHunt: vi.fn(), resetHunt: vi.fn(), refresh: vi.fn(), ...overrides,
  }
  render(<HuntPanel hunt={hunt} members={members} characters={characters} {...props} />)
  return props
}

describe('HuntPanel', () => {
  it('starts a ready hunt after GM confirmation', async () => {
    const { startHunt } = mount({ phase: 'not_started' }, { startHunt: vi.fn().mockResolvedValue(null) })
    fireEvent.click(screen.getByRole('button', { name: 'Start hunt' }))
    await waitFor(() => expect(startHunt).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 players'))
  })

  it('shows the GM target chain, cloak state, claims, and winner', () => {
    mount({
      phase: 'finished',
      winner: { character_name: 'Ariadne' },
      players: [
        player(1, 'Ariadne', { hidden_until: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
        player(2, 'Chronos', { state: 'eliminated', eliminated_at: new Date().toISOString() }),
      ],
      claims: [claim('confirmed')],
    })
    expect(screen.getByText('Winner: Ariadne')).toBeTruthy()
    expect(screen.getByText(/cloaked 10m/)).toBeTruthy()
    expect(screen.getByText(/claimed/).textContent).toContain('Chronos')
  })

  it('lets a GM override claims, restore players, eliminate players, and replace the chain', async () => {
    const recovery = mount({
      phase: 'active',
      players: [...ring, player(3, 'Kairos', { state: 'eliminated', eliminated_at: new Date().toISOString() })],
      claims: [claim('pending')],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Force reject' }))
    await waitFor(() => expect(recovery.resolveClaim).toHaveBeenCalledWith('claim-1', false))
    fireEvent.click(screen.getByRole('button', { name: 'Restore Kairos' }))
    await waitFor(() => expect(recovery.restorePlayer).toHaveBeenCalledWith('player-3'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Eliminate / })[0])
    await waitFor(() => expect(recovery.eliminatePlayer).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Edit target chain' }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Move .* down$/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Apply chain' }))
    await waitFor(() => expect(recovery.saveChain).toHaveBeenCalledWith(['player-2', 'player-1']))
  })

  it('requires the GM to assign a target after a confirmed non-final kill', async () => {
    const { assignNextTarget } = mount({ phase: 'active', players: [player(1, 'Ariadne'), ring[1]], claims: [] })
    expect(screen.getByText('Waiting for GM target assignment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Assign target to Ariadne' }))
    await waitFor(() => expect(assignNextTarget).toHaveBeenCalledWith('player-1'))
  })

  it('keeps a ruling outcome visible until dismissed and blocks double submission', async () => {
    let resolveClaim
    const recovery = mount({ phase: 'active', players: ring, claims: [claim('pending')] },
      { resolveClaim: vi.fn(() => new Promise((resolve) => { resolveClaim = resolve })) })
    fireEvent.click(screen.getByRole('button', { name: 'Force confirm' }))
    fireEvent.click(screen.getByRole('button', { name: 'Force confirm' }))
    expect(recovery.resolveClaim).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Force confirm' }).disabled).toBe(true)
    await act(async () => resolveClaim(null))
    expect(await screen.findByRole('status')).toBeTruthy()
    expect(screen.getByText('Claim confirmed: Chronos is eliminated.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('Claim confirmed: Chronos is eliminated.')).toBeNull()
    expect(recovery.resolveClaim).toHaveBeenCalledOnce()
  })
})
