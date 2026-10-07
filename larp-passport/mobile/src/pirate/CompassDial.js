import { memo, useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg'
import { cardinalLabel, headingQuality, usableTrueHeading } from '../lib/direction'
import { arcPath, bearingRangeLabel, smoothHeading } from '../lib/pirateCompass'
import { C, F, T } from '../lib/theme'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useTrueHeading } from '../lib/useTrueHeading'

const SIZE = 200
const CENTRE = SIZE / 2
const ARC_RADIUS = 76

// The SVG is rebuilt only for a new reading. Heading samples rotate its native
// wrapper at at most 15 Hz; they never redraw the vector paths.
export const CompassDial = memo(function CompassDial({ reading, active = true }) {
  const heading = useTrueHeading(active && !!reading, 66)
  const quality = headingQuality(heading)
  const trueHeading = usableTrueHeading(heading)
  const reduced = useReducedMotion()
  const rotation = useRef(new Animated.Value(0)).current
  const lastHeading = useRef(null)
  const range = reading && bearingRangeLabel(reading.centre_deg, reading.half_width_deg)
  const cardinal = reading ? cardinalLabel(reading.centre_deg) : null

  useEffect(() => {
    if (!active || trueHeading == null) {
      lastHeading.current = null
      rotation.setValue(0)
      return undefined
    }
    const next = smoothHeading(lastHeading.current, trueHeading)
    lastHeading.current = next
    if (reduced) {
      rotation.setValue(-next)
      return undefined
    }
    const animation = Animated.timing(rotation, { toValue: -next, duration: 80, useNativeDriver: true })
    animation.start()
    return () => animation.stop()
  }, [active, trueHeading, reduced, rotation])

  const rose = useMemo(() => {
    if (!reading) return null
    const wedge = arcPath(reading.centre_deg, reading.half_width_deg, ARC_RADIUS, CENTRE, CENTRE)
    const radians = reading.centre_deg * Math.PI / 180
    const endX = CENTRE + ARC_RADIUS * Math.sin(radians)
    const endY = CENTRE - ARC_RADIUS * Math.cos(radians)
    return (
      <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <Circle cx={CENTRE} cy={CENTRE} r={88} fill={C.panel} stroke={C.lineStrong} strokeWidth={2} />
        {wedge && <Path d={wedge} fill={C.amber} opacity={0.35} />}
        <Circle cx={CENTRE} cy={CENTRE} r={ARC_RADIUS} fill="none" stroke={C.line} strokeWidth={1} />
        <Line x1={CENTRE} y1={CENTRE} x2={endX} y2={endY} stroke={C.orangeBright} strokeWidth={3} />
        <Circle cx={CENTRE} cy={CENTRE} r={4} fill={C.orangeBright} />
        <SvgText x={CENTRE} y={22} fill={C.text} fontSize={15} textAnchor="middle">N</SvgText>
        <SvgText x={CENTRE} y={191} fill={C.text} fontSize={15} textAnchor="middle">S</SvgText>
        <SvgText x={185} y={105} fill={C.text} fontSize={15} textAnchor="middle">E</SvgText>
        <SvgText x={15} y={105} fill={C.text} fontSize={15} textAnchor="middle">W</SvgText>
      </Svg>
    )
  }, [reading?.centre_deg, reading?.half_width_deg])

  if (!reading || !range) return <Text style={styles.note}>Take a reading inside a lighthouse.</Text>
  const spin = rotation.interpolate({
    inputRange: [-360, 0, 360], outputRange: ['-360deg', '0deg', '360deg'], extrapolate: 'extend',
  })
  return (
    <View style={styles.root} accessibilityLabel={`Compass arc ${range}, centred ${cardinal} from true north`}>
      <Animated.View style={{ opacity: quality === 'ok' ? 1 : 0.6, transform: [{ rotate: spin }] }}>
        {rose}
      </Animated.View>
      <Text style={styles.range}>{range}</Text>
      <Text style={styles.note}>Centre {cardinal} · {reading.half_width_deg}° either side</Text>
      {quality !== 'ok' && <Text style={styles.warning}>Wave the phone in a figure-8 to calibrate. Use the printed bearing meanwhile.</Text>}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 6 },
  range: { color: C.text, fontFamily: F.displayBold, fontSize: T.title },
  note: { color: C.muted, fontFamily: F.body, fontSize: T.body, textAlign: 'center' },
  warning: { color: C.amber, fontFamily: F.bodyMedium, fontSize: T.label, lineHeight: T.lineLabel, textAlign: 'center' },
})
