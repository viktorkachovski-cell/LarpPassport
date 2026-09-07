import { useEffect, useState } from 'react'
import { describeServerSync } from '../lib/syncStatus'

// Self-ticking so the age stays honest without re-rendering the parent. The
// age text is not a live region (it would announce every tick); only a failure
// detail is announced.
export default function SyncStatus({ sync, realtime, online, onRetry, label = 'Server' }) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 10000)
    return () => clearInterval(timer)
  }, [])
  const status = describeServerSync({ ...sync, realtime, online, now: tick })
  const text = label === 'Server' ? status.text : status.text.replace('Server updated', `${label} updated`)
  return (
    <div className={`sync-status tone-${status.tone}`} title={status.detail}>
      <span className="sync-text">{text}</span>
      <span className="sync-detail" role={status.tone === 'error' ? 'alert' : undefined}>{status.detail}</span>
      {status.tone === 'error' && onRetry && (
        <button type="button" className="ghost sync-retry" onClick={onRetry}>Retry</button>
      )}
    </div>
  )
}
