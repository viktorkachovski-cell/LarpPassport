import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))
import PiratePanel from './PiratePanel'

afterEach(() => { cleanup(); rpc.mockReset() })

const game = { id: 'game-1', phase: 'setup', status: 'draft' }
const state = { is_pirate: true, phase: 'setup', paused: false, pvp_enabled: false,
  crews: [], sites: [] }

it('clears the write-only answer after saving a site', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  const refresh = vi.fn()
  render(<PiratePanel game={game} state={state} zones={[{ id: 'zone-1', name: 'Cove' }]} refresh={refresh} />)
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-1' } })
  fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'What is the tide?' } })
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'Black Tide' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('pirate_set_site',
    expect.objectContaining({ answer: 'Black Tide', zone_id: 'zone-1' })))
  await waitFor(() => expect(screen.getByLabelText('Answer').value).toBe(''))
  expect(screen.queryByText('Black Tide')).toBeNull()
  expect(refresh).toHaveBeenCalled()
})

it('shows every readiness failure from the server', async () => {
  rpc.mockResolvedValue({ data: { ready: false, issues: ['Four crews are required'] }, error: null })
  render(<PiratePanel game={game} state={state} zones={[]} refresh={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Check setup' }))
  expect(await screen.findByText('Four crews are required')).toBeTruthy()
  expect(screen.getByText('Needs work')).toBeTruthy()
})

it('keeps treasure award disabled until a crew and reason are supplied', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render(<PiratePanel game={{ ...game, phase: 'hoard' }}
      state={{ ...state, phase: 'hoard', crews: [{ id: 'crew-1', name: 'Black Crew' }] }}
      zones={[]} refresh={() => {}} />)
    const award = screen.getByRole('button', { name: 'Award treasure' })
    expect(award.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Crew'), { target: { value: 'crew-1' } })
    fireEvent.change(screen.getByLabelText('Oath verification note'), { target: { value: 'Oath heard' } })
    expect(award.disabled).toBe(false)
    fireEvent.click(award)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_award_treasure',
      { g: 'game-1', faction_id: 'crew-1', reason: 'Oath heard' }))
  } finally { confirm.mockRestore() }
})

it('requires a reason before the GM can resolve a disputed Parley', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render(<PiratePanel game={{ ...game, phase: 'cursed' }}
      state={{ ...state, phase: 'cursed', parleys: [{ id: 'parley-1', state: 'disputed',
        choice: 'fight', target_faction: 'crew-1', target_name: 'Black Crew',
        attacker_faction: 'crew-2', attacker_name: 'Gold Crew',
        target_report: 'crew-1', attacker_report: 'crew-2' }] }}
      zones={[]} refresh={() => {}} />)
    const resolve = screen.getByRole('button', { name: 'Resolve Parley' })
    expect(resolve.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Ruling reason'), { target: { value: 'Witness account' } })
    expect(resolve.disabled).toBe(false)
    fireEvent.click(resolve)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_resolve_parley', {
      g: 'game-1', parley_id: 'parley-1', winner_faction: 'crew-2',
      currency: 'doubloon', reason: 'Witness account',
    }))
  } finally { confirm.mockRestore() }
})

it('lets the GM choose a captain for a larger crew during setup', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  render(<PiratePanel game={game} state={{ ...state, crews: [
    { id: 'crew-1', name: 'Black Crew', captain_id: null,
      members: [{ profile_id: 'p-1', name: 'Anne' }, { profile_id: 'p-2', name: 'Mary' }] },
    { id: 'crew-2', name: 'Gold Crew', captain_id: 'p-3', members: [{ profile_id: 'p-3', name: 'Jack' }] },
  ] }} zones={[]} refresh={() => {}} />)
  expect(screen.getByText('Jack')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Captain of Black Crew'), { target: { value: 'p-2' } })
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('pirate_set_captain',
    { g: 'game-1', crew: 'crew-1', captain: 'p-2' }))
})

it('voids a riddle claim only with a reason', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  try {
    render(<PiratePanel game={{ ...game, phase: 'charting' }} state={{ ...state, phase: 'charting', sites: [
      { zone_id: 'zone-1', name: 'Cove', kind: 'riddle', reward: 'bearing', answer_set: true, active: true,
        claims: [{ id: 'claim-1', crew_name: 'Black Crew', claimed_by_name: 'Anne', rank: 1 }] },
    ] }} zones={[]} refresh={() => {}} />)
    expect(screen.queryByLabelText('Captain of Black Crew')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Void' }))
    const submit = screen.getByRole('button', { name: 'Void claim' })
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Answer phoned in' } })
    fireEvent.click(submit)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_void_claim',
      { g: 'game-1', claim_id: 'claim-1', reason: 'Answer phoned in' }))
  } finally { confirm.mockRestore() }
})
