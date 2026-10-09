import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

// UI clocks run only in the foreground and catch up immediately on return.
// An optional end time stops countdown ticks after expiry. Neither affects GPS.
export function useNow(intervalMs, until = null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!intervalMs) return undefined
    const deadline = until == null ? Infinity : new Date(until).getTime()
    let timer = null
    const stop = () => { clearInterval(timer); timer = null }
    const update = () => {
      const time = Date.now()
      setNow(time)
      if (time >= deadline) stop()
    }
    const start = () => {
      if (AppState.currentState !== 'active' || timer !== null) return
      update()
      if (Date.now() < deadline) timer = setInterval(update, intervalMs)
    }
    start()
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') start(); else stop()
    })
    return () => { stop(); subscription.remove() }
  }, [intervalMs, until])
  return now
}
