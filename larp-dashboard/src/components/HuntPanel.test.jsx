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
      />,
    )

    expect(screen.getByText('Winner: Ariadne')).toBeTruthy()
    expect(screen.getByText(/cloaked 10m/)).toBeTruthy()
    expect(screen.getByText(/claimed/).textContent).toContain('Chronos')
  })
})
