import { describe, expect, it } from 'vitest'
import { describeServerSync, formatAge, isNetworkFailure, realtimeStateFromStatus } from './syncStatus'

const T0 = Date.parse('2026-09-07T12:00:00Z')
const at = (secondsAgo) => new Date(T0 - secondsAgo * 1000).toISOString()

describe('syncStatus', () => {
  it('formats ages', () => {
    expect(formatAge(at(4), T0)).toBe('just now')
    expect(formatAge(at(45), T0)).toBe('45 s ago')
    expect(formatAge(at(125), T0)).toBe('2 min ago')
    expect(formatAge(null, T0)).toBeNull()
  })

  it('maps realtime statuses to hints', () => {
    expect(realtimeStateFromStatus('SUBSCRIBED')).toBe('connected')
    expect(realtimeStateFromStatus('CHANNEL_ERROR')).toBe('reconnecting')
    expect(realtimeStateFromStatus('CLOSED')).toBe('closed')
  })

  it('starts with checking, then reports the snapshot age', () => {
    expect(describeServerSync({ realtime: 'connecting', now: T0 }).text).toBe('Checking server')
    const ok = describeServerSync({ lastOkAt: at(15), realtime: 'connected', now: T0 })
    expect(ok).toMatchObject({ tone: 'ok', text: 'Server updated 15 s ago', detail: 'Live updates on' })
  })

  it('does not let a connected socket hide a failed snapshot', () => {
    const s = describeServerSync({ lastOkAt: at(90), lastErrorAt: at(2), lastError: 'JWT expired', realtime: 'connected', now: T0 })
    expect(s.tone).toBe('error')
    expect(s.text).toBe('Last refresh failed · showing data from 1 min ago')
    expect(s.detail).toBe('JWT expired')
  })

  it('reports offline only from the browser hint or a network failure', () => {
    expect(describeServerSync({ lastOkAt: at(30), realtime: 'connected', online: false, now: T0 }).text).toBe('Offline · showing data from 30 s ago')
    expect(describeServerSync({ lastOkAt: at(30), lastErrorAt: at(1), lastError: 'TypeError: Failed to fetch', realtime: 'reconnecting', now: T0 }).text)
      .toBe('Server unreachable · showing data from 30 s ago')
    expect(isNetworkFailure('permission denied')).toBe(false)
  })

  it('never claims live or periodic refresh for a view without either', () => {
    const s = describeServerSync({ lastOkAt: at(5), realtime: null, now: T0 })
    expect(s.detail).toBe('Use Refresh to update')
    expect(s.live).toBeNull()
  })

  it('warns when the last success is old even if nothing failed', () => {
    const s = describeServerSync({ lastOkAt: at(600), realtime: 'closed', now: T0 })
    expect(s.tone).toBe('warning')
    expect(s.detail).toBe('Live updates off · refreshing every minute')
  })
})
