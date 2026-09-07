import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EventsPanel from './EventsPanel'

const members = [
  { profile_id: 'player-1', profile: { username: 'ariadne' }, role: 'player' },
  { profile_id: 'player-2', profile: { username: 'chronos' }, role: 'player' },
  { profile_id: 'gm-1', profile: { username: 'morgana' }, role: 'gm' },
]

function props(overrides = {}) {
  return {
    broadcast: vi.fn().mockResolvedValue(null),
    confirmEvent: vi.fn(),
    dismissEvent: vi.fn(),
    events: [],
    members,
    onOpenHunt: vi.fn(),
    usernameOf: (profileId) => members.find((member) => member.profile_id === profileId)?.profile.username,
    zoneNameOf: () => 'Northern anomaly',
    ...overrides,
  }
}

afterEach(cleanup)

describe('EventsPanel', () => {
  it('provides the complete GM adjudication flow for a pending boundary breach', async () => {
    const event = {
      created_at: new Date().toISOString(),
      id: 'event-1',
      profile_id: 'player-1',
      status: 'pending',
      type: 'zone_boundary_exit',
      zone_id: 'zone-1',
    }
    const panelProps = props({ events: [event] })

    render(<EventsPanel {...panelProps} />)

    expect(screen.getByText('BREACH // PENDING')).toBeTruthy()
    expect(screen.getByText(/Northern anomaly/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm breach for ariadne' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm breach for ariadne' }))
    await waitFor(() => expect(panelProps.confirmEvent).toHaveBeenCalledWith(event))
    expect(panelProps.confirmEvent).toHaveBeenCalledOnce()
    expect(await screen.findByText('Breach confirmed for ariadne.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss event for ariadne' }))
    await waitFor(() => expect(panelProps.dismissEvent).toHaveBeenCalledWith(event))
    expect(await screen.findByText('Breach dismissed for ariadne.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Eliminate via Hunt' }))
    expect(panelProps.onOpenHunt).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('Breach dismissed for ariadne.')).toBeNull()
    expect(panelProps.dismissEvent).toHaveBeenCalledOnce()
  })

  it('keeps a failed broadcast visible with the draft intact', async () => {
    const panelProps = props({ broadcast: vi.fn().mockResolvedValue(new Error('permission denied')) })
    render(<EventsPanel {...panelProps} />)
    fireEvent.change(screen.getByPlaceholderText(/appears in their app instantly/), { target: { value: 'Regroup.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send broadcast' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('permission denied')
    expect(screen.getByPlaceholderText(/appears in their app instantly/).value).toBe('Regroup.')
  })

  it('broadcasts a GM message only to player profiles', async () => {
    const panelProps = props()
    render(<EventsPanel {...panelProps} />)

    const send = screen.getByRole('button', { name: 'Send broadcast' })
    expect(send.disabled).toBe(true)

    fireEvent.change(screen.getByPlaceholderText(/appears in their app instantly/), {
      target: { value: 'Return to the anomaly center.' },
    })
    fireEvent.click(send)

    await waitFor(() => expect(panelProps.broadcast).toHaveBeenCalledWith(
      ['player-1', 'player-2'],
      'Return to the anomaly center.',
    ))
    expect(await screen.findByText('Sent to 2 players.')).toBeTruthy()
  })
})

it('pending filter uses the independent queue and history can request another page', () => {
  const event = { id: 'old', type: 'zone_boundary_exit', status: 'pending', created_at: new Date().toISOString() }
  const loadOlder = vi.fn()
  render(<EventsPanel {...props({ events: [], pendingEvents: [event], loadOlder, hasMore: true })} />)
  fireEvent.click(screen.getByRole('button', { name: 'Load older events' }))
  expect(loadOlder).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Pending' }))
  expect(screen.getByText('BREACH // PENDING')).toBeTruthy()
})
