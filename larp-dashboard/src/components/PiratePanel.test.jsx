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
  fireEvent.change(screen.getByLabelText(/^Prompt/), { target: { value: 'What is the tide?' } })
  fireEvent.change(screen.getByLabelText('Answer'), { target: { value: 'Black Tide' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save site' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('pirate_set_site',
    expect.objectContaining({ answer: 'Black Tide', zone_id: 'zone-1' })))
  await waitFor(() => expect(screen.getByLabelText('Answer').value).toBe(''))
  expect(screen.queryByText('Black Tide')).toBeNull()
  expect(refresh).toHaveBeenCalled()
})

it('keeps the riddle fields visible and out of password autofill', () => {
  render(<PiratePanel game={game} state={state} zones={[]} refresh={() => {}} />)
  const answer = screen.getByLabelText('Answer')
  const prompt = screen.getByLabelText(/^Prompt/)
  expect(answer.type).toBe('text')
  expect(answer.getAttribute('autocomplete')).toBe('off')
  expect(prompt.tagName).toBe('TEXTAREA')
  expect(prompt.value).toBe('')
  expect(document.querySelector('input[type="password"]')).toBeNull()
})

it('loads a registered site for editing without its answer', () => {
  render(<PiratePanel game={game} state={{ ...state, sites: [
    { zone_id: 'zone-1', name: 'Cove', kind: 'riddle', reward: 'oath', oath_index: 2,
      prompt: 'Who keeps the light?', answer_set: true, claims: [] },
  ] }} zones={[{ id: 'zone-1', name: 'Cove' }, { id: 'zone-2', name: 'Pier' }]} refresh={() => {}} />)
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-1' } })
  expect(screen.getByLabelText(/^Prompt/).value).toBe('Who keeps the light?')
  expect(screen.getByLabelText('Riddle reward').value).toBe('oath')
  expect(screen.getByLabelText('Oath index').value).toBe('2')
  expect(screen.getByLabelText(/^Answer/).value).toBe('')
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-2' } })
  expect(screen.getByLabelText(/^Prompt/).value).toBe('')
})

it('lists event-plan differences as warnings that do not block', async () => {
  rpc.mockResolvedValue({ data: { ready: true, issues: [],
    warnings: ['Lighthouses: 1 of the 3 planned'] }, error: null })
  render(<PiratePanel game={game} state={state} zones={[]} refresh={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: 'Check setup' }))
  expect(await screen.findByText('Lighthouses: 1 of the 3 planned')).toBeTruthy()
  expect(screen.getByText('Ready to chart')).toBeTruthy()
})

it('shows the saved treasure point and splits pasted coordinates', async () => {
  rpc.mockResolvedValue({ data: { status: 'ok' }, error: null })
  const onShowTreasure = vi.fn()
  render(<PiratePanel game={game} state={{ ...state, treasure: { lat: 42.15, lng: 24.75 } }}
    zones={[]} refresh={() => {}} onShowTreasure={onShowTreasure} />)
  expect(screen.getByText(/Saved at 42\.150000, 24\.750000/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Show on map' }))
  expect(onShowTreasure).toHaveBeenCalled()
  fireEvent.paste(screen.getByLabelText('Latitude'),
    { clipboardData: { getData: () => '42.1432, 24.7493' } })
  expect(screen.getByLabelText('Latitude').value).toBe('42.1432')
  expect(screen.getByLabelText('Longitude').value).toBe('24.7493')
  fireEvent.click(screen.getByRole('button', { name: 'Save treasure' }))
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('pirate_set_treasure',
    { g: 'game-1', lat: 42.1432, lng: 24.7493 }))
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

it('keeps the chosen site kind when the GM picks another new zone', () => {
  render(<PiratePanel game={game} state={state}
    zones={[{ id: 'zone-1', name: 'Cove' }, { id: 'zone-2', name: 'Pier' }]} refresh={() => {}} />)
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-1' } })
  fireEvent.change(screen.getByLabelText('Site kind'), { target: { value: 'lighthouse' } })
  fireEvent.change(screen.getByLabelText('Zone'), { target: { value: 'zone-2' } })
  expect(screen.getByLabelText('Site kind').value).toBe('lighthouse')
})

it('lets the GM captain a crew left without one after charting, and no other', () => {
  render(<PiratePanel game={{ ...game, phase: 'cursed' }} state={{ ...state, phase: 'cursed', crews: [
    { id: 'crew-1', name: 'Black Crew', captain_id: null,
      members: [{ profile_id: 'p-1', name: 'Anne' }, { profile_id: 'p-2', name: 'Mary' }] },
    { id: 'crew-2', name: 'Gold Crew', captain_id: 'p-3',
      members: [{ profile_id: 'p-3', name: 'Jack' }, { profile_id: 'p-4', name: 'Read' }] },
  ] }} zones={[]} refresh={() => {}} />)
  expect(screen.getByLabelText('Captain of Black Crew')).toBeTruthy()
  expect(screen.queryByLabelText('Captain of Gold Crew')).toBeNull()
  expect(screen.getByText('Jack')).toBeTruthy()
})
