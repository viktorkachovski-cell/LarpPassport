import { useEffect, useState } from 'react'

// Current time, refreshed every `intervalMs` (no timer when it is falsy), so a
// component re-renders relative times on its own instead of its parent.
export function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!intervalMs) return undefined
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
