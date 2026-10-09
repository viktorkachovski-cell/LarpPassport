import { memo, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Defs, Line, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'
import { C, F, S, T } from '../lib/theme'
import { useReducedMotion } from '../lib/useReducedMotion'
import { DecorativeLayer, MotionScrollView as ScrollView, TouchableOpacity } from '../ui/presentation'

// The Black Tide building blocks: wood, parchment and brass. Pirate build only.

// Deck planking behind every pirate screen. Static vector pattern: one draw.
export const WoodBackdrop = memo(function WoodBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id="planks" width="160" height="48" patternUnits="userSpaceOnUse">
          <Rect width="160" height="48" fill={C.wood700} />
          <Line x1="0" y1="9" x2="160" y2="11" stroke={C.woodSeam} strokeOpacity="0.09" strokeWidth="1" />
          <Line x1="0" y1="21" x2="160" y2="19" stroke={C.onWood} strokeOpacity="0.025" strokeWidth="2" />
          <Line x1="0" y1="31" x2="160" y2="33" stroke={C.woodSeam} strokeOpacity="0.07" strokeWidth="1" />
          <Line x1="0" y1="40" x2="160" y2="39" stroke={C.onWood} strokeOpacity="0.02" strokeWidth="1.5" />
          <Rect x="0" y="46" width="160" height="2" fill={C.woodSeam} opacity="0.45" />
          <Rect x="118" y="0" width="2" height="46" fill={C.woodSeam} opacity="0.3" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#planks)" />
    </Svg>
  )
})

// Brass rivets along the top of the header rail.
export const Rivets = memo(function Rivets() {
  return (
    <Svg style={styles.rivets} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id="rivets" width="40" height="8" patternUnits="userSpaceOnUse">
          <Circle cx="20" cy="4" r="2" fill={C.brassDeep} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="8" fill="url(#rivets)" />
    </Svg>
  )
})

// The parchment sheet that holds a tab's content. The vignette burns the edges.
export function Sheet({ children, style }) {
  return (
    <View style={[styles.sheetShadow, style]}>
      <View style={styles.sheet}>
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Defs>
            <RadialGradient id="burn" cx="50%" cy="42%" rx="62%" ry="62%">
              <Stop offset="0.62" stopColor={C.sheetEdge} stopOpacity="0" />
              <Stop offset="1" stopColor={C.sheetEdge} stopOpacity="0.16" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#burn)" />
        </Svg>
        <DecorativeLayer kind="glow" />
        {children}
      </View>
    </View>
  )
}

// Text on the parchment sheet, shared by the tab panels' style sheets.
export const SHEET_TEXT = {
  body: { color: C.sheetInk, fontFamily: F.body, fontSize: T.bodyLarge, lineHeight: T.lineBody },
  muted: { color: C.sheetMuted, fontFamily: F.body, fontSize: 15, lineHeight: 21 },
  rule: { height: 1, backgroundColor: C.sheetRule, marginVertical: 6 },
}

// Scroll page for a player tab: any load error, then the content. A GM is
// pointed at the dashboard instead.
export function TabPage({ state, error, children }) {
  const gm = !!state && state.role !== 'player'
  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!!error && !gm && <Notice tone="error" text={error} />}
      {gm ? <Sheet><SheetTitle>Pirate game</SheetTitle><Text style={styles.body}>GM controls are available in the dashboard.</Text></Sheet> : children}
    </ScrollView>
  )
}

export function Kicker({ children, style }) {
  return <Text style={[styles.kicker, style]}>{children}</Text>
}

export function SheetTitle({ children }) {
  return <Text style={styles.sheetTitle} accessibilityRole="header">{children}</Text>
}

// A raised plank or brass plate on a dark lip. The face sinks onto the lip
// while pressed and stays seated while selected. Only a transform animates,
// on the native driver; reduced motion snaps instead of easing.
const LIP = 3
const SEATED = 0.7 // a selected tab sits most of the way down

export function PressPlank({
  children, onPress, disabled, selected = false, face, lip, edge, nails = false, grain = true, shimmer = false,
  style, faceStyle, accessibilityRole = 'button', accessibilityLabel, accessibilityState,
}) {
  const reduced = useReducedMotion()
  const [pressed, setPressed] = useState(false)
  const depth = useRef(new Animated.Value(selected ? SEATED : 0)).current
  const target = pressed ? 1 : selected ? SEATED : 0

  useEffect(() => {
    if (reduced) { depth.setValue(target); return undefined }
    const animation = Animated.timing(depth, {
      toValue: target, useNativeDriver: true, duration: pressed ? 90 : 140, easing: Easing.out(Easing.cubic),
    })
    animation.start()
    return () => animation.stop()
  }, [depth, target, pressed, reduced])

  const translateY = depth.interpolate({ inputRange: [0, 1], outputRange: [0, LIP - 1] })
  return (
    <Pressable accessibilityRole={accessibilityRole} accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }} disabled={disabled}
      onPress={onPress} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
      style={[styles.plankOuter, disabled && styles.disabled, style]}>
      <View style={[styles.plankLip, { backgroundColor: lip }]} />
      <Animated.View style={[styles.plankFace, { backgroundColor: face, borderTopColor: edge }, faceStyle, { transform: [{ translateY }] }]}>
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Defs><LinearGradient id="plateLight" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={C.brassLight} stopOpacity={grain ? 0.07 : 0.2} />
            <Stop offset="0.55" stopColor={C.brassLight} stopOpacity="0" />
          </LinearGradient></Defs>
          <Rect width="100%" height="100%" fill="url(#plateLight)" />
        </Svg>
        {shimmer && <DecorativeLayer kind="shimmer" enabled={!disabled} />}
        {grain && <View pointerEvents="none" style={styles.grainWrap} importantForAccessibility="no-hide-descendants">
          <View style={[styles.grain, { top: '28%' }]} />
          <View style={[styles.grain, styles.grainFaint, { top: '62%' }]} />
        </View>}
        {nails && <View pointerEvents="none" style={[styles.nail, styles.nailLeft]} />}
        {nails && <View pointerEvents="none" style={[styles.nail, styles.nailRight]} />}
        {children}
      </Animated.View>
    </Pressable>
  )
}

const PLATES = {
  brass: { face: C.brass, lip: C.brassDeep, edge: C.brassLight, text: 'brassText', grain: false },
  plank: { face: C.wood600, lip: C.woodSeam, edge: C.onWoodMuted, text: 'woodText', grain: true },
  blood: { face: C.bloodFill, lip: C.woodSeam, edge: C.blood, text: 'woodText', grain: true },
}

// Brass for the one action that matters, plank for the rest, blood for hostile
// or irreversible choices, ink for quiet actions on the sheet.
export function TideButton({ label, onPress, disabled, variant = 'brass', style, accessibilityLabel }) {
  const plate = PLATES[variant]
  if (!plate) {
    return (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} activeOpacity={0.75}
        style={[styles.button, styles.ink, disabled && styles.disabled, style]}>
        <Text style={[styles.buttonText, styles.inkText]}>{label}</Text>
      </TouchableOpacity>
    )
  }
  return (
    <PressPlank onPress={onPress} disabled={disabled} face={plate.face} lip={plate.lip} edge={plate.edge}
      grain={plate.grain} shimmer={variant === 'brass'} style={style} faceStyle={styles.buttonFace} accessibilityLabel={accessibilityLabel}>
      <Text style={[styles.buttonText, styles[plate.text]]}>{label}</Text>
    </PressPlank>
  )
}

const SEAL = {
  ok: { glyph: '✓', fill: 'tide', text: 'tideInk', glyphColor: 'onWood' },
  warning: { glyph: '!', fill: 'lampGlow', text: 'lamp', glyphColor: 'wood900' },
  error: { glyph: '✕', fill: 'bloodFill', text: 'blood', glyphColor: 'onWood' },
  info: { glyph: 'i', fill: 'sea', text: 'sheetInk', glyphColor: 'sheet' },
}

// A wax-sealed line on the sheet: the glyph carries the tone, never colour alone.
export function Notice({ text, tone = 'info' }) {
  const seal = SEAL[tone] ?? SEAL.info
  return (
    <View style={[styles.notice, tone === 'warning' && styles.noticeWarning]} accessibilityLiveRegion="polite">
      <View style={[styles.seal, { backgroundColor: C[seal.fill] }]} importantForAccessibility="no-hide-descendants">
        <Text style={[styles.sealGlyph, { color: C[seal.glyphColor] }]}>{seal.glyph}</Text>
      </View>
      <Text style={[styles.noticeText, { color: C[seal.text] }]}>{text}</Text>
    </View>
  )
}

// Currency marks for the Hold ledger.
export function DoubloonIcon({ size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10" fill="#C9A23F" stroke="#7A5B1E" strokeWidth="1.5" />
      <Circle cx="12" cy="12" r="7" fill="none" stroke="#ECD58C" strokeWidth="1" />
      <Path d="M12 7.5v9M8.5 10.5h7" stroke="#7A5B1E" strokeWidth="2" strokeLinecap="round" />
    </Svg>
  )
}

export function ShardIcon({ size = 20 }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 2.5l7.5 3.5 2 8-6 7.5-6.5-4.5-1-8.5z" fill="#5FA8A2" stroke="#1F4F55" strokeWidth="1.5" strokeLinejoin="round" />
      <Path d="M9 2.5l3 9 6.5 2.5M12 11.5l-7-2" stroke="#A9DCD4" strokeWidth="1" fill="none" />
    </Svg>
  )
}

export function BackIcon({ size = 24, color = '#1C120A' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 4.5L4 9.5l5 5" />
      <Path d="M4 9.5h10a5 5 0 0 1 0 10h-3" />
    </Svg>
  )
}

const styles = StyleSheet.create({
  ...SHEET_TEXT,
  page: { padding: 16, gap: 16, paddingBottom: 40 },
  rivets: { position: 'absolute', left: 0, right: 0, top: 3, height: 8 },
  sheetShadow: { borderRadius: 12, backgroundColor: C.sheet, elevation: 4, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  sheet: { borderRadius: 12, borderWidth: 1, borderColor: C.sheetEdge, backgroundColor: C.sheet, padding: 20, gap: 12, overflow: 'hidden' },
  kicker: { color: C.sheetMuted, fontFamily: F.mono, fontSize: 15, lineHeight: 18, letterSpacing: 0.9 },
  sheetTitle: { color: C.sheetInk, fontFamily: F.blackletter, fontSize: 28, lineHeight: 32 },
  button: { minHeight: S.touch, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  ink: { backgroundColor: 'transparent', borderColor: C.sheetInk, borderWidth: 1.5 },
  plankOuter: { minHeight: S.touch + LIP, paddingBottom: LIP, maxWidth: '100%' },
  plankLip: { position: 'absolute', left: 0, right: 0, top: LIP, bottom: 0, borderRadius: 10 },
  plankFace: { flex: 1, minHeight: S.touch, borderRadius: 10, borderWidth: 1, borderColor: C.woodSeam, borderTopWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  buttonFace: { paddingHorizontal: 16, paddingVertical: 10 },
  grainWrap: { ...StyleSheet.absoluteFillObject },
  grain: { position: 'absolute', left: -4, right: -4, height: 1.5, backgroundColor: C.woodSeam, opacity: 0.1, transform: [{ rotate: '-0.6deg' }] },
  grainFaint: { backgroundColor: C.onWood, opacity: 0.04, height: 2, transform: [{ rotate: '0.5deg' }] },
  nail: { position: 'absolute', top: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: C.brassDeep, borderWidth: 0.5, borderColor: C.woodSeam },
  nailLeft: { left: 5 },
  nailRight: { right: 5 },
  disabled: { opacity: 0.5 },
  buttonText: { fontFamily: F.displayBold, fontSize: T.button, lineHeight: 21, letterSpacing: 0.3, textAlign: 'center' },
  brassText: { color: C.wood900 },
  woodText: { color: C.onWood },
  inkText: { color: C.sheetInk },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.sheetShade, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 },
  noticeWarning: { backgroundColor: C.sheet, borderWidth: 1, borderColor: C.sheetRule },
  seal: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  sealGlyph: { fontFamily: F.bodyBold, fontSize: 13, lineHeight: 16 },
  noticeText: { flex: 1, fontFamily: F.bodySemiBold, fontSize: T.bodyLarge, lineHeight: T.lineBody },
})
