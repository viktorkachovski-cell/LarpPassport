// Truthful connection/sync wording. Each input is a separate fact:
// last successful authoritative snapshot, last failed request, the Realtime
// socket hint and the browser's online hint. None of them is treated as proof
// of the others.

import { formatAge } from './time'

const NETWORK_FAILURE = /failed to fetch|network ?error|load failed|networkrequestfailed|network request failed|econnrefused|enotfound|timed? ?out|unreachable|offline/i

export function isNetworkFailure(message) {
  return NETWORK_FAILURE.test(String(message ?? ''))
}

export function realtimeStateFromStatus(status) {
  if (status === 'SUBSCRIBED') return 'connected'
  if (status === 'CLOSED') return 'closed'
  if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') return 'reconnecting'
  return 'connecting'
}

export function describeRealtime(state) {
  if (state === 'connected') return 'Live updates on'
  if (state === 'reconnecting') return 'Live updates reconnecting'
  if (state === 'closed') return 'Live updates off'
  return 'Connecting live updates'
}

function failureWording(lastOkAt, lastError, okAge) {
  const network = isNetworkFailure(lastError)
  if (!lastOkAt) {
    return network
      ? { text: 'Cannot reach the server', detail: 'No successful sync yet. Check your connection.' }
      : { text: 'Server request failed', detail: `No successful sync yet. ${String(lastError ?? '')}`.trim() }
  }
  return network
    ? { text: `Server unreachable · showing data from ${okAge}`, detail: 'Retrying automatically.' }
    : { text: `Last refresh failed · showing data from ${okAge}`, detail: String(lastError ?? '') }
}

// online: navigator.onLine hint (false is a strong offline signal; true proves nothing).
// realtime: socket hint, or null for a view that has no live channel and no
// periodic refresh (it must not claim either).
// subject names what the success line reports as updated.
export function describeServerSync({ lastOkAt, lastErrorAt, lastError, realtime, online = true, subject = 'Server', now = Date.now() }) {
  const failedSinceOk = lastErrorAt && (!lastOkAt || new Date(lastErrorAt) > new Date(lastOkAt))
  const okAge = formatAge(lastOkAt, now)
  const live = realtime == null ? null : describeRealtime(realtime)

  if (online === false) {
    return {
      tone: 'error',
      text: lastOkAt ? `Offline · showing data from ${okAge}` : 'Offline · no successful sync yet',
      detail: 'The browser reports no network connection. Changes cannot be saved until it returns.',
      live,
    }
  }
  if (!lastOkAt && !lastErrorAt) {
    return { tone: 'checking', text: 'Checking server', detail: 'No successful sync yet', live }
  }
  if (failedSinceOk) return { tone: 'error', ...failureWording(lastOkAt, lastError, okAge), live }
  const ageMs = now - new Date(lastOkAt).getTime()
  return {
    tone: ageMs > 3 * 60 * 1000 ? 'warning' : 'ok',
    text: `${subject} updated ${okAge}`,
    detail: live == null ? 'Use Refresh to update' : realtime === 'connected' ? live : `${live} · refreshing every minute`,
    live,
  }
}
