import { memo, useEffect, useMemo, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg'
import { cardinalLabel, formatBearing, headingQuality, usableTrueHeading } from '../lib/direction'
import { arcPath, bearingRangeLabel, smoothHeading } from '../lib/pirateCompass'
import { C, F } from '../lib/theme'
import { useReducedMotion } from '../lib/useReducedMotion'
import { useTrueHeading } from '../lib/useTrueHeading'

// A brass ship's compass. The bezel, lubber mark and hub stay fixed; only the
// parchment card turns (by -heading), so the lamp-lit bearing wedge swings
// under the lubber mark when the phone faces the bearing.
const WIDTH = 280
const HEIGHT = 300
const CX = 140
const CY = 165
const CARD = 112 // card radius; the card is drawn in its own 224 x 224 box
const BOX = CARD * 2
const C0 = CARD // card centre inside its box

function polar(deg, r) {
  const t = deg * Math.PI / 180
  return [C0 + r * Math.sin(t), C0 - r * Math.cos(t)]
}

function rosePoint(deg, length, width, light, dark, key) {
  const [tx, ty] = polar(deg, length)
  const [lx, ly] = polar(deg - 90, width)
  const [rx, ry] = polar(deg + 90, width)
  return [
    <Path key={`${key}l`} d={`M${C0} ${C0}L${tx} ${ty}L${lx} ${ly}Z`} fill={light} stroke={C.sheetInk} strokeWidth={0.75} />,
    <Path key={`${key}d`} d={`M${C0} ${C0}L${tx} ${ty}L${rx} ${ry}Z`} fill={dark} stroke={C.sheetInk} strokeWidth={0.75} />,
  ]
}

// Static bezel behind the card. Drawn once.
const Bezel = memo(function Bezel() {
  return (
    <Svg width={WIDTH} height={HEIGHT} style={StyleSheet.absoluteFill}>
      <Circle cx={CX} cy={CY} r={128} fill={C.brass} stroke={C.woodSeam} strokeWidth={2} />
      <Circle cx={CX} cy={CY} r={125} fill="none" stroke={C.brassLight} strokeWidth={1.5} />
      <Circle cx={CX} cy={CY} r={114} fill="none" stroke={C.brassDeep} strokeWidth={3} />
    </Svg>
  )
})

// Static hub and lubber mark above the card. Drawn once.
const Lubber = memo(function Lubber() {
  return (
    <Svg width={WIDTH} height={HEIGHT} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Circle cx={CX} cy={CY} r={9} fill={C.brass} stroke={C.woodSeam} strokeWidth={2} />
      <Path d="M130 26L150 26L140 50Z" fill={C.brassLight} stroke={C.woodSeam} strokeWidth={1.5} />
    </Svg>
  )
})

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

  const card = useMemo(() => {
    if (!reading) return null
    const centre = reading.centre_deg
    const half = reading.half_width_deg
    const wedge = arcPath(centre, half, CARD, C0, C0)
    const [a0x, a0y] = polar(centre - half, CARD)
    const [a1x, a1y] = polar(centre + half, CARD)
    const [bx, by] = polar(centre, CARD - 4)
    const ticks = []
    const numbers = []
    for (let deg = 0; deg < 360; deg += 5) {
      const major = deg % 30 === 0
      const [x1, y1] = polar(deg, CARD)
      const [x2, y2] = polar(deg, major ? 98 : 105)
      ticks.push(<Line key={`t${deg}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.sheetInk} strokeWidth={major ? 2 : 1} />)
      if (major && deg % 90 !== 0) {
        const [nx, ny] = polar(deg, 86)
        numbers.push(
          <SvgText key={`n${deg}`} x={nx} y={ny + 4} fill={C.sheetMuted} fontSize={11} fontWeight="bold"
            fontFamily={F.numeric} textAnchor="middle" transform={`rotate(${deg} ${nx} ${ny})`}>{deg}</SvgText>,
        )
      }
    }
    const letters = [['N', 0], ['E', 90], ['S', 180], ['W', 270]].map(([label, deg]) => {
      const [lx, ly] = polar(deg, 86)
      return (
        <SvgText key={label} x={lx} y={ly + 8} fill={deg === 0 ? C.blood : C.sheetInk} fontSize={22}
          fontFamily={F.mono} textAnchor="middle" transform={`rotate(${deg} ${lx} ${ly})`}>{label}</SvgText>
      )
    })
    return (
      <Svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`}>
        <Circle cx={C0} cy={C0} r={CARD} fill={C.sheet} />
        <Circle cx={C0} cy={C0} r={101} fill="none" stroke={C.sheetShade} strokeWidth={22} />
        {wedge && <Path d={wedge} fill={C.lampGlow} opacity={0.4} />}
        <Path d={`M${C0} ${C0}L${a0x} ${a0y}M${C0} ${C0}L${a1x} ${a1y}`} stroke={C.lamp} strokeWidth={1.5} fill="none" />
        <G>{ticks}</G>
        <G>{numbers}</G>
        {[45, 135, 225, 315].flatMap((deg) => rosePoint(deg, 50, 9, C.sheetShade, C.sheetMuted, `i${deg}`))}
        {[90, 180, 270].flatMap((deg) => rosePoint(deg, 74, 13, C.sheetShade, C.sheetMuted, `c${deg}`))}
        {rosePoint(0, 74, 13, C.blood, C.sheetMuted, 'north')}
        <Line x1={C0} y1={C0} x2={bx} y2={by} stroke={C.lamp} strokeWidth={3} strokeLinecap="round" />
        {letters}
      </Svg>
    )
  }, [reading?.centre_deg, reading?.half_width_deg])

  if (!reading || !range) return <Text style={styles.note}>Take a reading inside a lighthouse.</Text>
  const spin = rotation.interpolate({
    inputRange: [-360, 0, 360], outputRange: ['-360deg', '0deg', '360deg'], extrapolate: 'extend',
  })
  return (
    <View style={styles.root} accessibilityLabel={`Compass arc ${range}, centred ${cardinal} from true north`}>
      <View style={styles.dial}>
        <Bezel />
        <Animated.View style={[styles.card, { opacity: quality === 'ok' ? 1 : 0.6, transform: [{ rotate: spin }] }]}>
          {card}
        </Animated.View>
        <Lubber />
        <View style={styles.headingTag} importantForAccessibility="no-hide-descendants">
          <Text style={styles.headingText}>HDG {trueHeading == null ? '---' : formatBearing(trueHeading)}</Text>
        </View>
      </View>
      <Text style={styles.range}>{range}</Text>
      <Text style={styles.note}>Centre {cardinal} · {reading.half_width_deg}° either side</Text>
      {quality !== 'ok' && <Text style={styles.warning}>Wave the phone in a figure-8 to calibrate. Use the printed bearing meanwhile.</Text>}
    </View>
  )
})

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: 6 },
  dial: { width: WIDTH, height: HEIGHT },
  card: { position: 'absolute', left: CX - CARD, top: CY - CARD, width: BOX, height: BOX },
  headingTag: { position: 'absolute', top: 0, left: CX - 40, width: 80, height: 24, borderRadius: 12, backgroundColor: C.wood900, borderWidth: 1, borderColor: C.brassDeep, alignItems: 'center', justifyContent: 'center' },
  headingText: { color: C.onWood, fontFamily: F.numeric, fontSize: 13, lineHeight: 16 },
  range: { color: C.sheetInk, fontFamily: F.numeric, fontSize: 28, lineHeight: 32, letterSpacing: 0.5 },
  note: { color: C.sheetMuted, fontFamily: F.body, fontSize: 15, lineHeight: 20, textAlign: 'center' },
  warning: { color: C.lamp, fontFamily: F.bodyBold, fontSize: 15, lineHeight: 20, textAlign: 'center' },
})
