import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

// Tracks the OS reduce-motion preference, including changes while the app is
// open. Defaults to "reduce" until the first query answers, so nothing loops
// before we know.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(true)
  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (alive) setReduced(!!value) }).catch(() => { if (alive) setReduced(false) })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { if (alive) setReduced(!!value) })
    return () => { alive = false; sub?.remove?.() }
  }, [])
  return reduced
}
