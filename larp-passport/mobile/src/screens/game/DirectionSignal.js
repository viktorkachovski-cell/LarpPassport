import { useEffect, useRef, useState } from 'react'
import { Animated, AppState, StyleSheet, Text, View } from 'react-native'
import * as Location from 'expo-location'
import { C, F, T } from '../../lib/theme'
import { useNow } from '../../lib/useNow'
import { useReducedMotion } from '../../lib/useReducedMotion'
import { arrowRotation, describeDirection, headingQuality, shortestAngleDelta, usableTrueHeading } from '../../lib/direction'
import { common } from '../../ui/common'

// Foreground-only compass subscription. Active only while an arrow can be
// shown (direction available, app active); removed on background, unmount
// (tab switch, account/game change) and whenever direction goes away. No
// GPS settings are touched here.
function useTrueHeading(enabled) {
  const [heading, setHeading] = useState(null)
  useEffect(() => {
    if (!enabled) { setHeading(null); return undefined }
    let subscription = null
    let alive = true
    const stop = () => { subscription?.remove?.(); subscription = null; if (alive) setHeading(null) }
    const start = async () => {
      if (!alive || subscription || AppState.currentState !== 'active') return
      try {
        const sub = await Location.watchHeadingAsync((value) => { if (alive) setHeading(value) })
        if (!alive || AppState.currentState !== 'active') { sub.remove(); return }
        subscription = sub
      } catch { if (alive) setHeading(null) }
    }
    start()
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') start(); else stop() })
    return () => { alive = false; appState.remove(); subscription?.remove?.() }
  }, [enabled])
  return heading
}

// Direction to the target, north-referenced. The label never assumes the
// screen top points north; the arrow appears only with a usable true heading.
export function DirectionSignal({ proximity }) {
  // Re-checks expiry every 5 s while the signal has a validity window.
  const now = useNow(proximity?.valid_until ? 5000 : null)
  const direction = describeDirection(proximity, now)
  const reduced = useReducedMotion()
  const heading = useTrueHeading(direction.state === 'available')
  const trueHeading = usableTrueHeading(heading)
  const quality = headingQuality(heading)
  const rotation = direction.state === 'available' ? arrowRotation(direction.bearing, trueHeading) : null

  // Visual smoothing only: shortest-angle interpolation across 359/0. It does
  // not extend authorization or freshness; the bearing itself comes untouched
  // from the server.
  const shown = useRef(new Animated.Value(0)).current
  const lastRotation = useRef(0)
  useEffect(() => {
    if (rotation == null) return
    const next = lastRotation.current + shortestAngleDelta(lastRotation.current, rotation)
    lastRotation.current = next
    if (reduced) { shown.setValue(next); return }
    Animated.timing(shown, { toValue: next, duration: 250, useNativeDriver: true }).start()
  }, [rotation, reduced, shown])

  if (direction.state === 'none' || direction.state === 'not_enabled') return null

  if (direction.state === 'expired') {
    return <Text style={[styles.directionNote, common.amberText]}>Direction expired. Waiting for a fresh fix.</Text>
  }
  if (direction.state === 'unavailable') {
    return <Text style={styles.directionNote}>Direction unavailable: both fixes are on the same spot.</Text>
  }

  const spin = shown.interpolate({ inputRange: [-360, 0, 360], outputRange: ['-360deg', '0deg', '360deg'] })
  return (
    <View style={styles.directionRow} accessibilityLabel={`Bearing ${direction.label}, measured from true north`}>
      <View style={styles.directionCopy}>
        <Text style={styles.directionKicker}>BEARING FROM NORTH</Text>
        <Text style={styles.directionValue}>{direction.label}</Text>
        {rotation == null
          ? <Text style={styles.directionNote}>{quality === 'none' && heading ? 'Compass unavailable on this phone. Face ' : 'Face '}{direction.cardinal} ({direction.bearing}° from true north).</Text>
          : <Text style={styles.directionNote}>{quality === 'low' ? 'Compass calibration is low; the arrow is approximate.' : 'Arrow is relative to where your phone points.'}</Text>}
      </View>
      {rotation != null && (
        <View style={styles.compassDial} importantForAccessibility="no-hide-descendants">
          <Animated.Text style={[styles.compassArrow, { transform: [{ rotate: spin }] }]}>▲</Animated.Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  directionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 12, borderTopColor: C.line, borderTopWidth: 1 },
  directionCopy: { flex: 1 },
  directionKicker: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1.1 },
  directionValue: { color: C.text, fontFamily: F.displayBold, fontSize: 24, marginTop: 2 },
  directionNote: { color: C.muted, fontFamily: F.body, fontSize: T.label, lineHeight: T.lineLabel, marginTop: 6 },
  compassDial: { width: 64, height: 64, borderRadius: 32, borderColor: C.lineStrong, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  compassArrow: { color: C.orangeBright, fontSize: 30, lineHeight: 34 },
})
