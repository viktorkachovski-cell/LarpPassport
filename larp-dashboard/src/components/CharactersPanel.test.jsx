import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CharactersPanel from './CharactersPanel'

const mocks = vi.hoisted(() => ({ result: { data: [], error: null } }))

vi.mock('../lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => Promise.resolve(mocks.result),
  }
  return { supabase: { from: () => query } }
})

function renderPanel() {
  render(<CharactersPanel
    game={{ template: { stats: [] } }}
    characters={[{ id: 'c1', name: 'Ariadne', user_id: 'p1', is_npc: false, faction_id: null, fields: {} }]}
    members={[]}
    factions={[]}
    usernameOf={() => 'ariadne'}
    saveCharacter={vi.fn()}
    addNpc={vi.fn()}
    deleteCharacter={vi.fn()}
    addFaction={vi.fn()}
  />)
  return screen.getByRole('button', { name: 'History for Ariadne' })
}

afterEach(cleanup)

describe('CharactersPanel history', () => {
  it('reports a failed history load instead of showing an empty history', async () => {
    mocks.result = { data: null, error: { message: 'permission denied' } }
    const history = renderPanel()
    fireEvent.click(history)
    expect((await screen.findByRole('alert')).textContent).toContain('History for Ariadne failed to load: permission denied')
    expect(history.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('No changes recorded yet.')).toBeNull()
  })

  it('opens the history when the load succeeds', async () => {
    mocks.result = { data: [], error: null }
    const history = renderPanel()
    fireEvent.click(history)
    expect(await screen.findByText('No changes recorded yet.')).toBeTruthy()
    expect(history.getAttribute('aria-expanded')).toBe('true')
  })
})
