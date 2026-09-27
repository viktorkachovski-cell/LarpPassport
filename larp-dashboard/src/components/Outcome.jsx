// Result of the last consequential action, from useAction. Errors are
// announced as alerts; successes as status.
export default function Outcome({ outcome, onDismiss }) {
  if (!outcome) return null
  const error = outcome.tone === 'error'
  return (
    <div className={`outcome ${error ? 'outcome-error' : 'outcome-ok'}`} role={error ? 'alert' : 'status'}>
      <span>{outcome.text}</span>
      <button type="button" className="ghost" onClick={onDismiss} aria-label="Dismiss message">Dismiss</button>
    </div>
  )
}
