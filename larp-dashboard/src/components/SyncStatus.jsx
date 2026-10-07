import { describeServerSync } from '../lib/syncStatus'
import { useNow } from '../lib/useNow'

// Self-ticking so the age stays honest without re-rendering the parent. The
// age text is not a live region (it would announce every tick); only a failure
// detail is announced.
export default function SyncStatus({ sync, realtime, online, onRetry, label = 'Server' }) {
  const now = useNow(10000)
  const status = describeServerSync({ ...sync, realtime, online, subject: label, now })
  return (
    <div className={`sync-status tone-${status.tone}`} title={status.detail}>
      <span className="sync-text">{status.text}</span>
      <span className="sync-detail" role={status.tone === 'error' ? 'alert' : undefined}>{status.detail}</span>
      {status.tone === 'error' && onRetry && (
        <button type="button" className="ghost sync-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
