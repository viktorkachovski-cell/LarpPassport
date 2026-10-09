// Truthful connection/sync wording. Every input is a separate fact that
// can disagree with the others; nothing here collapses them into one "online"
// flag. The functions are pure so the screens only decide *when* to compute.

import { formatAge } from './time'

const NETWORK_FAILURE = /network request failed|failed to fetch|network ?error|load failed|econnrefused|enotfound|etimedout|timed? ?out|unreachable|offline/i

export function isNetworkFailure(message) {
  return NETWORK_FAILURE.test(String(message ?? ''))
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

function failureWording(lastOkAt, lastError, okAge) {
  const network = isNetworkFailure(lastError)
  if (!lastOkAt) {
    return network
      ? { text: 'Cannot reach the server', detail: 'No successful sync yet. Check your connection.' }
      : { text: 'Server request failed', detail: `No successful sync yet. ${String(lastError ?? '')}`.trim() }
  }
  return network
    ? { text: `Offline or unreachable · showing data from ${okAge}`, detail: 'Retrying automatically.' }
    : { text: `Last refresh failed · showing data from ${okAge}`, detail: String(lastError ?? '') }
}

// lastOkAt: time of the last successful authoritative response.
// lastErrorAt/lastError: the most recent failed authoritative request.
// A socket status is only a hint; it never upgrades the wording to "synced".
// subject names what the success line reports as updated.
export function describeServerSync({ lastOkAt, lastErrorAt, lastError, realtime, subject = 'Server', now = Date.now() }) {
  const failedSinceOk = lastErrorAt && (!lastOkAt || new Date(lastErrorAt) > new Date(lastOkAt))
  const okAge = formatAge(lastOkAt, now)
  const live = realtime == null ? null : describeRealtime(realtime)

  if (!lastOkAt && !lastErrorAt) {
    return { tone: 'checking', text: 'Checking server', detail: 'No successful sync yet', live }
  }
  if (failedSinceOk) return { tone: 'error', ...failureWording(lastOkAt, lastError, okAge), live }
  const ageMs = now - new Date(lastOkAt).getTime()
  return {
    tone: ageMs > 3 * 60 * 1000 ? 'warning' : 'ok',
    text: `${subject} updated ${okAge}`,
    detail: live == null ? 'Pull down to refresh' : realtime === 'connected' ? live : `${live} · refreshing periodically`,
    live,
  }
}

export const GPS_STALE_MS = 2 * 60 * 1000

// sharing: native tracking actually running for this game and account.
// permission: { foreground, background } from a query, never a prompt.
// lastFixAt: last local GPS capture for this owner scope.
const plural = (n) => (n === 1 ? '' : 's')

function sharingOff(fg, permissionMissing, queued) {
  const lines = []
  if (permissionMissing) lines.push(fg !== 'granted' ? 'Location permission needed' : 'Background location permission needed ("Allow all the time")')
  if (queued > 0) lines.push(`${queued} earlier update${plural(queued)} still queued`)
  return { tone: permissionMissing ? 'warning' : 'muted', text: 'Location sharing off', lines }
}

// The GPS fix line; a missing or stale fix downgrades the status to a warning.
function fixLine(lastFixAt, now) {
  if (!lastFixAt) return { line: 'Waiting for the first GPS fix', warn: true }
  const age = formatAge(lastFixAt, now)
  if (now - new Date(lastFixAt).getTime() > GPS_STALE_MS) return { line: `GPS fix is stale (${age})`, warn: true }
  return { line: `GPS fix ${age}`, warn: false }
}

export function describeSharing({ sharing, permission, lastFixAt, queued = 0, failed = 0, lastError, now = Date.now() }) {
  const fg = permission?.foreground
  const permissionMissing = fg != null && (fg !== 'granted' || permission.background !== 'granted')
  if (!sharing) return sharingOff(fg, permissionMissing, queued)

  const fix = fixLine(lastFixAt, now)
  const lines = permissionMissing ? ['Location permission was revoked. Sharing cannot continue until it is granted again.'] : []
  lines.push(fix.line)
  if (queued > 0) lines.push(`${queued} update${plural(queued)} queued`)
  if (failed > 0) lines.push(`${failed} update${plural(failed)} rejected by the server${lastError ? `: ${lastError}` : ''}`)
  const tone = permissionMissing ? 'error' : fix.warn || failed > 0 ? 'warning' : 'ok'
  return { tone, text: 'Location sharing on', lines }
}
