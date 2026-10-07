import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import * as Location from 'expo-location'

// Foreground-only true-heading subscription shared by the Time Hunt arrow and
// Pirate compass. It never changes the background location tracking profile.
export function useTrueHeading(enabled, minIntervalMs = 0) {
  const [heading, setHeading] = useState(null)
  const lastEmitted = useRef(0)
  useEffect(() => {
    if (!enabled) { setHeading(null); return undefined }
    let subscription = null
    let alive = true
    const stop = () => { subscription?.remove?.(); subscription = null; if (alive) setHeading(null) }
    const start = async () => {
      if (!alive || subscription || AppState.currentState !== 'active') return
      try {
        const sub = await Location.watchHeadingAsync((value) => {
          const now = Date.now()
          if (alive && (minIntervalMs === 0 || now - lastEmitted.current >= minIntervalMs)) {
            lastEmitted.current = now
            setHeading(value)
          }
        })
        if (!alive || AppState.currentState !== 'active') { sub.remove(); return }
        subscription = sub
      } catch { if (alive) setHeading(null) }
    }
    start()
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else stop() })
    return () => { alive = false; appState.remove(); subscription?.remove?.() }
  }, [enabled, minIntervalMs])
  return heading
}
