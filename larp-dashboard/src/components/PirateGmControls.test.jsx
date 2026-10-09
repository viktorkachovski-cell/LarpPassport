import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))
import PiratePanel from './PiratePanel'
const game = { id: 'game-1', phase: 'cursed', status: 'active' }
const state = { is_pirate: true, phase: 'cursed', crews: [{ id: 'crew-1', name: 'Black Crew', captain_id: 'p-1', members: [{ profile_id: 'p-1', name: 'Anne' }, { profile_id: 'p-2', name: 'Mary' }] }], sites: [{ zone_id: 'zone-1', name: 'Cove', kind: 'riddle', active: true }] }
beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true); rpc.mockResolvedValue({ data: { status: 'ok' }, error: null }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); rpc.mockReset() })
function mount(props = {}) { return render(<PiratePanel game={game} state={state} zones={[]} refresh={() => {}} {...props} />) }
function change(label, value) { fireEvent.change(screen.getByLabelText(label), { target: { value } }) }
it('retries an uncertain GM claim with the original request ID', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { message: 'Connection lost' } })
  mount(); change('Claim for crew', 'crew-1'); change('Riddle', 'zone-1'); change('GM claim reason', 'Witnessed answer')
  fireEvent.click(screen.getByRole('button', { name: 'Grant claim' }))
  await screen.findByText('Connection lost')
  const first = rpc.mock.calls[0][1]
  fireEvent.click(screen.getByRole('button', { name: 'Grant claim' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
  expect(rpc.mock.calls[1]).toEqual(['gm_claim_for', first])
  expect(first).toMatchObject({ crew: 'crew-1', zone_id: 'zone-1', reason: 'Witnessed answer' })
  expect(first.idem).toMatch(/^[0-9a-f-]{36}$/)
  await waitFor(() => expect(screen.getByLabelText('GM claim reason').value).toBe(''))
})
it('accepts an already-held GM claim without presenting an error', async () => {
  rpc.mockResolvedValue({ data: { status: 'already_claimed' }, error: null })
  mount(); change('Claim for crew', 'crew-1'); change('Riddle', 'zone-1'); change('GM claim reason', 'Verified answer')
  fireEvent.click(screen.getByRole('button', { name: 'Grant claim' }))
  await screen.findByText(/normal rewards recorded once/)
})
it('bounds Mercy and permits a reasoned zero to clear it', async () => {
  mount(); change('Mercy for crew', 'crew-1'); change('Mercy change reason', 'Correct immunity'); change('Mercy minutes', '121')
  expect(screen.getByRole('button', { name: 'Set Mercy' }).disabled).toBe(true)
  change('Mercy minutes', '0'); fireEvent.click(screen.getByRole('button', { name: 'Set Mercy' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_set_mercy', { g: 'game-1', crew: 'crew-1', minutes: 0, reason: 'Correct immunity' }))
})
it('replaces a valid captain after charting with a stale-update guard', async () => {
  mount(); change('Captain’s crew', 'crew-1'); change('New captain', 'p-2'); change('Captain replacement reason', 'Captain phone died')
  fireEvent.click(screen.getByRole('button', { name: 'Replace captain' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_replace_captain', { g: 'game-1', crew: 'crew-1', captain: 'p-2', reason: 'Captain phone died', expected_captain: 'p-1' }))
})
it('validates payout lists and saves future rules with the original snapshot', async () => {
  mount(); change('Riddle payouts by rank', '50,'); change('Settings change reason', 'Rebalance event')
  expect(screen.getByRole('button', { name: 'Save rules' }).disabled).toBe(true)
  change('Riddle payouts by rank', '50, 0'); change('Code validity seconds', '30')
  fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('gm_set_pirate_settings', expect.objectContaining({ settings: expect.objectContaining({ riddle_payouts: [50, 0], code_ttl_seconds: 30 }), expected_settings: expect.objectContaining({ riddle_payouts: [20, 15, 10, 5], code_ttl_seconds: 90 }) })))
})
it('preserves a dirty settings draft but blocks overwriting another GM', () => {
  const view = mount(); change('Yield percentage', '20'); change('Settings change reason', 'Rebalance event')
  view.rerender(<PiratePanel game={game} state={{ ...state, settings: { yield_percent: 30 } }} zones={[]} refresh={() => {}} />)
  expect(screen.getByLabelText('Yield percentage').value).toBe('20')
  expect(screen.getByRole('button', { name: 'Save rules' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Reload current settings' }))
  expect(screen.getByLabelText('Yield percentage').value).toBe('30')
})
it('loads older history with the returned cursor', async () => {
  const cursor = { at: '2026-10-09T12:00:00Z', id: '1' }
  rpc.mockResolvedValueOnce({ data: { items: [{ id: '1', crew_name: 'Black Crew', currency: 'doubloon', delta: 20, source: 'riddle' }], next_cursor: cursor }, error: null })
    .mockResolvedValueOnce({ data: { items: [{ id: '2', crew_name: 'Black Crew', currency: 'doubloon', delta: -5, source: 'parley' }], next_cursor: null }, error: null })
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Load history' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Load older entries' }))
  await waitFor(() => expect(rpc).toHaveBeenLastCalledWith('gm_pirate_history', { g: 'game-1', kind: 'ledger', crew: null, page_cursor: cursor, page_size: 50 }))
  await screen.findByText(/-5 doubloons/); expect(screen.getByText(/\+20 doubloons/)).toBeTruthy()
})
it('ignores history from an earlier filter after its request finishes', async () => {
  let resolve; rpc.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Load history' })); change('History', 'claims')
  rpc.mockResolvedValueOnce({ data: { items: [], next_cursor: null }, error: null })
  fireEvent.click(screen.getByRole('button', { name: 'Load history' }))
  await screen.findByText('No entries in this history.')
  resolve({ data: { items: [{ id: 'old', crew_name: 'Wrong history' }], next_cursor: null }, error: null })
  await waitFor(() => expect(screen.queryByText('Wrong history')).toBeNull())
})
it('reverses an accidental finish to recall without deleting gameplay', async () => {
  mount({ game: { ...game, phase: 'finished', status: 'finished' }, state: { ...state, phase: 'finished' } })
  fireEvent.click(screen.getByRole('button', { name: 'Previous phase' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('pirate_set_phase', expect.objectContaining({ g: 'game-1', next_phase: 'recall' })))
  expect(screen.getByRole('button', { name: 'Replace captain' }).disabled).toBe(true)
})
it('shows crew location warnings without altering game rules', () => {
  mount({ state: { ...state, alerts: [{ crew_id: 'crew-1', crew_name: 'Black Crew', spread_m: 200, stale_players: [{ profile_id: 'p-1', name: 'Anne', sharing_enabled: false }] }] } })
  expect(screen.getByText('Fresh locations are up to 200 m apart.')).toBeTruthy()
  expect(screen.getByText('Anne: sharing is off')).toBeTruthy()
})
