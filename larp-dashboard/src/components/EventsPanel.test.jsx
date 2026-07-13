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
  it('provides the complete GM adjudication flow for a pending boundary breach', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Confirm breach' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    fireEvent.click(screen.getByRole('button', { name: 'Eliminate via Hunt' }))

    expect(panelProps.confirmEvent).toHaveBeenCalledWith(event)
    expect(panelProps.dismissEvent).toHaveBeenCalledWith(event)
    expect(panelProps.onOpenHunt).toHaveBeenCalledOnce()
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
