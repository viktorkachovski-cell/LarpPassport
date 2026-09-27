import { useCallback, useRef, useState } from 'react'

// Busy flag and a dismissible outcome for a panel's GM actions. Actions throw
// on failure. The outcome ({ tone, text }) stays until dismissed or the next
// action starts; dismissing it changes no game state. `busy` is false or the
// key of the running action, and only one action runs at a time.
export function useAction() {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState(null)
  const running = useRef(false)
  const clear = useCallback(() => setOutcome(null), [])

  const run = useCallback(async (action, { key = true, success, failure = (message) => message, onSuccess } = {}) => {
    if (running.current) return false
    running.current = true
    setBusy(key)
    setOutcome(null)
    try {
      await action()
      if (success) setOutcome({ tone: 'ok', text: success })
      onSuccess?.()
      return true
    } catch (error) {
      setOutcome({ tone: 'error', text: failure(error?.message ?? String(error)) })
      return false
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])

  return { busy, outcome, setOutcome, clear, run }
}
