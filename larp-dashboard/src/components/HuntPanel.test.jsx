import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HuntPanel from './HuntPanel'

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

function recoveryProps() {
  return {
    assignNextTarget: vi.fn().mockResolvedValue(null),
    eliminatePlayer: vi.fn().mockResolvedValue(null),
    resolveClaim: vi.fn().mockResolvedValue(null),
    restorePlayer: vi.fn().mockResolvedValue(null),
    saveChain: vi.fn().mockResolvedValue(null),
  }
}

describe('HuntPanel', () => {
  it('starts a ready hunt after GM confirmation', async () => {
    const startHunt = vi.fn().mockResolvedValue(null)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <HuntPanel
        hunt={{ phase: 'not_started' }}
        members={members}
        characters={characters}
        startHunt={startHunt}
        resetHunt={vi.fn()}
        refresh={vi.fn()}
        {...recoveryProps()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start hunt' }))

    await waitFor(() => expect(startHunt).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('2 players'))
  })

  it('shows the GM target chain, cloak state, claims, and winner', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    render(
      <HuntPanel
        hunt={{
          phase: 'finished',
          winner: { character_name: 'Ariadne' },
          players: [
            {
              character_name: 'Ariadne',
              eliminated_at: null,
              hidden_until: future,
              profile_id: 'player-1',
              state: 'alive',
              target_name: null,
              username: 'ariadne',
            },
            {
              character_name: 'Chronos',
              eliminated_at: new Date().toISOString(),
              hidden_until: null,
              profile_id: 'player-2',
              state: 'eliminated',
              target_name: null,
              username: 'chronos',
            },
          ],
          claims: [
            {
              hunter_name: 'Ariadne',
              id: 'claim-1',
              requested_at: new Date().toISOString(),
              status: 'confirmed',
              victim_name: 'Chronos',
            },
          ],
        }}
        members={members}
        characters={characters}
        startHunt={vi.fn()}
        resetHunt={vi.fn()}
        refresh={vi.fn()}
        {...recoveryProps()}
      />,
    )

    expect(screen.getByText('Winner: Ariadne')).toBeTruthy()
    expect(screen.getByText(/cloaked 10m/)).toBeTruthy()
    expect(screen.getByText(/claimed/).textContent).toContain('Chronos')
  })

  it('lets a GM override claims, restore players, eliminate players, and replace the chain', async () => {
    const recovery = recoveryProps()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <HuntPanel
        hunt={{
          phase: 'active',
          winner: null,
          players: [
            {
              character_name: 'Ariadne', profile_id: 'player-1', state: 'alive',
              target_name: 'Chronos', target_profile_id: 'player-2', username: 'ariadne',
            },
            {
              character_name: 'Chronos', profile_id: 'player-2', state: 'alive',
              target_name: 'Ariadne', target_profile_id: 'player-1', username: 'chronos',
            },
            {
              character_name: 'Kairos', eliminated_at: new Date().toISOString(),
              profile_id: 'player-3', state: 'eliminated', username: 'kairos',
            },
          ],
          claims: [
            {
              hunter_name: 'Ariadne', id: 'claim-1', requested_at: new Date().toISOString(),
              status: 'pending', victim_name: 'Chronos',
            },
          ],
        }}
        members={members}
        characters={characters}
        startHunt={vi.fn()}
        resetHunt={vi.fn()}
        refresh={vi.fn()}
        {...recovery}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Force reject' }))
    await waitFor(() => expect(recovery.resolveClaim).toHaveBeenCalledWith('claim-1', false))

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(recovery.restorePlayer).toHaveBeenCalledWith('player-3'))

    const eliminateButtons = screen.getAllByRole('button', { name: 'Eliminate' })
    fireEvent.click(eliminateButtons[0])
    await waitFor(() => expect(recovery.eliminatePlayer).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: 'Edit target chain' }))
    const downButtons = screen.getAllByRole('button', { name: 'Down' })
    fireEvent.click(downButtons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Apply chain' }))
    await waitFor(() => expect(recovery.saveChain).toHaveBeenCalledWith(['player-2', 'player-1']))
  })

  it('requires the GM to assign a target after a confirmed non-final kill', async () => {
    const recovery = recoveryProps()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <HuntPanel
        hunt={{
          phase: 'active',
          players: [
            {
              character_name: 'Ariadne', profile_id: 'player-1', state: 'alive',
              target_name: null, target_profile_id: null, username: 'ariadne',
            },
            {
              character_name: 'Chronos', profile_id: 'player-2', state: 'alive',
              target_name: 'Ariadne', target_profile_id: 'player-1', username: 'chronos',
            },
          ],
          claims: [],
        }}
        members={members}
        characters={characters}
        startHunt={vi.fn()}
        resetHunt={vi.fn()}
        refresh={vi.fn()}
        {...recovery}
      />,
    )

    expect(screen.getByText('Awaiting GM assignment')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Assign target' }))
    await waitFor(() => expect(recovery.assignNextTarget).toHaveBeenCalledWith('player-1'))
  })
})
