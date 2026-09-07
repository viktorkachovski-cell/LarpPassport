import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import PlayersPanel from './PlayersPanel'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('shows the age of a GPS fix, not the time an offline backlog was uploaded', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-07T12:00:00Z'))
  render(<PlayersPanel
    members={[{ profile_id: 'p', role: 'player', profile: { username: 'Traveller' } }]}
    positions={{ p: { recorded_at: '2026-09-07T11:50:00Z', updated_at: '2026-09-07T12:00:00Z' } }}
    uid="gm" game={{ purge_after_days: 7 }}
  />)
  expect(screen.getByText('10m ago')).toBeTruthy()
  expect(screen.queryByText('now')).toBeNull()
})
