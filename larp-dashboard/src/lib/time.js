// The one relative-age wording ("just now", "45s ago", "5m ago", "2h ago",
// "3d ago"). null without a timestamp so each caller picks its placeholder.
export function formatAge(timestamp, now = Date.now()) {
  if (!timestamp) return null
  const seconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
