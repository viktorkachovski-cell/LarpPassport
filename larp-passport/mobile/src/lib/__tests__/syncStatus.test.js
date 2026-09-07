import {
  describeRealtime, describeServerSync, describeSharing, formatAge, isNetworkFailure, realtimeStateFromStatus,
} from '../syncStatus'

const T0 = Date.parse('2026-09-07T12:00:00Z')
const at = (secondsAgo) => new Date(T0 - secondsAgo * 1000).toISOString()

describe('formatAge', () => {
  it('rounds to readable units', () => {
    expect(formatAge(null, T0)).toBeNull()
    expect(formatAge(at(3), T0)).toBe('just now')
    expect(formatAge(at(12), T0)).toBe('12 s ago')
    expect(formatAge(at(190), T0)).toBe('3 min ago')
    expect(formatAge(at(7200), T0)).toBe('2 h ago')
  })
})

describe('realtime hints', () => {
  it('maps channel statuses and never claims sync', () => {
    expect(realtimeStateFromStatus('SUBSCRIBED')).toBe('connected')
    expect(realtimeStateFromStatus('TIMED_OUT')).toBe('reconnecting')
    expect(realtimeStateFromStatus('CHANNEL_ERROR')).toBe('reconnecting')
    expect(realtimeStateFromStatus('CLOSED')).toBe('closed')
    expect(realtimeStateFromStatus(undefined)).toBe('connecting')
    expect(describeRealtime('reconnecting')).toBe('Live updates reconnecting')
  })
})

describe('describeServerSync', () => {
  it('says checking before the first result', () => {
    const s = describeServerSync({ realtime: 'connecting', now: T0 })
    expect(s.tone).toBe('checking')
    expect(s.text).toBe('Checking server')
    expect(s.detail).toMatch(/No successful sync yet/)
  })

  it('reports a successful snapshot age and the live hint separately', () => {
    const s = describeServerSync({ lastOkAt: at(12), realtime: 'connected', now: T0 })
    expect(s.tone).toBe('ok')
    expect(s.text).toBe('Server updated 12 s ago')
    expect(s.detail).toBe('Live updates on')
  })

  it('does not claim synchronized data when the socket is up but the snapshot failed', () => {
    const s = describeServerSync({ lastOkAt: at(120), lastErrorAt: at(5), lastError: 'permission denied', realtime: 'connected', now: T0 })
    expect(s.tone).toBe('error')
    expect(s.text).toBe('Last refresh failed · showing data from 2 min ago')
    expect(s.detail).toBe('permission denied')
  })

  it('only says offline when the failure looks like a network failure', () => {
    const offline = describeServerSync({ lastOkAt: at(30), lastErrorAt: at(1), lastError: 'Network request failed', realtime: 'reconnecting', now: T0 })
    expect(offline.text).toBe('Offline or unreachable · showing data from 30 s ago')
    const first = describeServerSync({ lastErrorAt: at(1), lastError: 'TypeError: Network request failed', realtime: 'connecting', now: T0 })
    expect(first.text).toBe('Cannot reach the server')
    expect(isNetworkFailure('JWT expired')).toBe(false)
  })

  it('treats an old but successful snapshot as a warning, not an error', () => {
    const s = describeServerSync({ lastOkAt: at(400), realtime: 'closed', now: T0 })
    expect(s.tone).toBe('warning')
    expect(s.text).toBe('Server updated 6 min ago')
    expect(s.detail).toBe('Live updates off · refreshing periodically')
  })

  it('never claims live or periodic refresh for a view without either', () => {
    const s = describeServerSync({ lastOkAt: at(5), realtime: null, now: T0 })
    expect(s.detail).toBe('Pull down to refresh')
    expect(s.live).toBeNull()
  })

  it('recovers to ok once a newer success lands after a failure', () => {
    const s = describeServerSync({ lastOkAt: at(2), lastErrorAt: at(40), lastError: 'boom', realtime: 'connected', now: T0 })
    expect(s.tone).toBe('ok')
  })
})

describe('describeSharing', () => {
  const granted = { foreground: 'granted', background: 'granted' }

  it('distinguishes sharing off from a permission problem', () => {
    expect(describeSharing({ sharing: false, permission: granted, now: T0 })).toEqual({ tone: 'muted', text: 'Location sharing off', lines: [] })
    const denied = describeSharing({ sharing: false, permission: { foreground: 'denied', background: 'denied' }, now: T0 })
    expect(denied.tone).toBe('warning')
    expect(denied.lines).toEqual(['Location permission needed'])
    const bgOnly = describeSharing({ sharing: false, permission: { foreground: 'granted', background: 'denied' }, now: T0 })
    expect(bgOnly.lines[0]).toMatch(/Background location permission/)
  })

  it('keeps sharing off wording even when old updates are queued', () => {
    const s = describeSharing({ sharing: false, permission: granted, queued: 3, now: T0 })
    expect(s.text).toBe('Location sharing off')
    expect(s.lines).toEqual(['3 earlier updates still queued'])
  })

  it('reports GPS age, queue and rejected counts as separate facts', () => {
    const s = describeSharing({ sharing: true, permission: granted, lastFixAt: at(8), queued: 3, failed: 2, lastError: 'bad point', now: T0 })
    expect(s.text).toBe('Location sharing on')
    expect(s.lines).toEqual(['GPS fix just now', '3 updates queued', '2 updates rejected by the server: bad point'])
    expect(s.tone).toBe('warning')
  })

  it('flags a stale fix and a missing first fix', () => {
    expect(describeSharing({ sharing: true, permission: granted, lastFixAt: at(200), now: T0 }).lines).toEqual(['GPS fix is stale (3 min ago)'])
    expect(describeSharing({ sharing: true, permission: granted, now: T0 }).lines).toEqual(['Waiting for the first GPS fix'])
  })

  it('flags revoked permission while sharing is still recorded as on', () => {
    const s = describeSharing({ sharing: true, permission: { foreground: 'denied', background: 'denied' }, lastFixAt: at(5), now: T0 })
    expect(s.tone).toBe('error')
    expect(s.lines[0]).toMatch(/permission was revoked/)
  })

  it('does not claim a permission problem before permissions were queried', () => {
    expect(describeSharing({ sharing: false, permission: null, now: T0 }).lines).toEqual([])
  })
})
