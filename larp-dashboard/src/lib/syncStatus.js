// Truthful connection/sync wording (U01). Each input is a separate fact:
// last successful authoritative snapshot, last failed request, the Realtime
// socket hint and the browser's online hint. None of them is treated as proof
// of the others.

const NETWORK_FAILURE = /failed to fetch|network ?error|load failed|networkrequestfailed|network request failed|econnrefused|enotfound|timed? ?out|unreachable|offline/i

export function isNetworkFailure(message) {
  return NETWORK_FAILURE.test(String(message ?? ''))
}

export function formatAge(timestamp, now = Date.now()) {
  if (!timestamp) return null
  const seconds = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
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

// online: navigator.onLine hint (false is a strong offline signal; true proves nothing).
export function describeServerSync({ lastOkAt, lastErrorAt, lastError, realtime, online = true, now = Date.now() }) {
  const failedSinceOk = lastErrorAt && (!lastOkAt || new Date(lastErrorAt) > new Date(lastOkAt))
  const network = online === false || (failedSinceOk && isNetworkFailure(lastError))
  const okAge = formatAge(lastOkAt, now)
  const live = describeRealtime(realtime)

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
  if (!lastOkAt) {
    return {
      tone: 'error',
      text: network ? 'Cannot reach the server' : 'Server request failed',
      detail: network ? 'No successful sync yet. Check your connection.' : `No successful sync yet. ${String(lastError ?? '')}`.trim(),
      live,
    }
  }
  if (failedSinceOk) {
    return {
      tone: 'error',
      text: network ? `Server unreachable · showing data from ${okAge}` : `Last refresh failed · showing data from ${okAge}`,
      detail: network ? 'Retrying automatically.' : String(lastError ?? ''),
      live,
    }
  }
  const ageMs = now - new Date(lastOkAt).getTime()
  return {
    tone: ageMs > 3 * 60 * 1000 ? 'warning' : 'ok',
    text: `Server updated ${okAge}`,
    detail: realtime === 'connected' ? live : `${live} · refreshing every minute`,
    live,
  }
}
