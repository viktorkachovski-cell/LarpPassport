// Truthful connection/sync wording (U01). Every input is a separate fact that
// can disagree with the others; nothing here collapses them into one "online"
// flag. The functions are pure so the screens only decide *when* to compute.

const NETWORK_FAILURE = /network request failed|failed to fetch|network ?error|load failed|econnrefused|enotfound|etimedout|timed? ?out|unreachable|offline/i

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

// Supabase channel statuses -> a small vocabulary the UI can label.
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

// lastOkAt: time of the last successful authoritative response.
// lastErrorAt/lastError: the most recent failed authoritative request.
// A socket status is only a hint; it never upgrades the wording to "synced".
export function describeServerSync({ lastOkAt, lastErrorAt, lastError, realtime, now = Date.now() }) {
  const failedSinceOk = lastErrorAt && (!lastOkAt || new Date(lastErrorAt) > new Date(lastOkAt))
  const network = failedSinceOk && isNetworkFailure(lastError)
  const okAge = formatAge(lastOkAt, now)
  const live = describeRealtime(realtime)

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
      text: network ? `Offline or unreachable · showing data from ${okAge}` : `Last refresh failed · showing data from ${okAge}`,
      detail: network ? 'Retrying automatically.' : String(lastError ?? ''),
      live,
    }
  }
  const ageMs = now - new Date(lastOkAt).getTime()
  return {
    tone: ageMs > 3 * 60 * 1000 ? 'warning' : 'ok',
    text: `Server updated ${okAge}`,
    detail: realtime === 'connected' ? live : `${live} · refreshing periodically`,
    live,
  }
}

export const GPS_STALE_MS = 2 * 60 * 1000

// sharing: native tracking actually running for this game and account.
// permission: { foreground, background } from a query, never a prompt.
// lastFixAt: last local GPS capture for this owner scope.
export function describeSharing({ sharing, permission, lastFixAt, queued = 0, failed = 0, lastError, now = Date.now() }) {
  const fg = permission?.foreground
  const bg = permission?.background
  const permissionMissing = fg != null && (fg !== 'granted' || bg !== 'granted')
  const lines = []

  if (!sharing) {
    if (permissionMissing) {
      lines.push(fg !== 'granted' ? 'Location permission needed' : 'Background location permission needed ("Allow all the time")')
    }
    if (queued > 0) lines.push(`${queued} earlier update${queued === 1 ? '' : 's'} still queued`)
    return { tone: permissionMissing ? 'warning' : 'muted', text: 'Location sharing off', lines }
  }

  let tone = 'ok'
  if (permissionMissing) {
    tone = 'error'
    lines.push('Location permission was revoked. Sharing cannot continue until it is granted again.')
  }
  if (!lastFixAt) {
    lines.push('Waiting for the first GPS fix')
    if (tone === 'ok') tone = 'warning'
  } else if (now - new Date(lastFixAt).getTime() > GPS_STALE_MS) {
    lines.push(`GPS fix is stale (${formatAge(lastFixAt, now)})`)
    if (tone === 'ok') tone = 'warning'
  } else {
    lines.push(`GPS fix ${formatAge(lastFixAt, now)}`)
  }
  if (queued > 0) lines.push(`${queued} update${queued === 1 ? '' : 's'} queued`)
  if (failed > 0) {
    lines.push(`${failed} update${failed === 1 ? '' : 's'} rejected by the server${lastError ? `: ${lastError}` : ''}`)
    if (tone === 'ok') tone = 'warning'
  }
  return { tone, text: 'Location sharing on', lines }
}
