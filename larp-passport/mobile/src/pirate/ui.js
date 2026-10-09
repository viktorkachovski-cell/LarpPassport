import { memo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Svg, { Circle, Defs, Line, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg'
import { C, F, S, T } from '../lib/theme'

// The Black Tide building blocks: wood, parchment and brass. Pirate build only.

// Deck planking behind every pirate screen. Static vector pattern: one draw.
export const WoodBackdrop = memo(function WoodBackdrop() {
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Defs>
        <Pattern id="planks" width="160" height="48" patternUnits="userSpaceOnUse">
          <Rect width="160" height="48" fill={C.wood700} />
          <Line x1="0" y1="9" x2="160" y2="11" stroke={C.woodSeam} strokeOpacity="0.18" strokeWidth="1" />
          <Line x1="0" y1="21" x2="160" y2="19" stroke={C.onWood} strokeOpacity="0.04" strokeWidth="2" />
          <Line x1="0" y1="31" x2="160" y2="33" stroke={C.woodSeam} strokeOpacity="0.14" strokeWidth="1" />
          <Line x1="0" y1="40" x2="160" y2="39" stroke={C.onWood} strokeOpacity="0.035" strokeWidth="1.5" />
          <Rect x="0" y="46" width="160" height="2" fill={C.woodSeam} />
          <Rect x="118" y="0" width="2" height="46" fill={C.woodSeam} opacity="0.7" />
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
          <Circle cx="20" cy="4" r="2.5" fill={C.brassDeep} />
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
              <Stop offset="1" stopColor={C.sheetEdge} stopOpacity="0.55" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#burn)" />
        </Svg>
        {children}
      </View>
    </View>
  )
}

export function Kicker({ children, style }) {
  return <Text style={[styles.kicker, style]}>{children}</Text>
}

export function SheetTitle({ children }) {
  return <Text style={styles.sheetTitle} accessibilityRole="header">{children}</Text>
}

// Brass for the one action that matters, plank for the rest, blood for hostile
// or irreversible choices, ink for quiet actions on the sheet.
export function TideButton({ label, onPress, disabled, variant = 'brass', style, accessibilityLabel }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} activeOpacity={0.75}
      style={[styles.button, styles[variant], disabled && styles.disabled, style]}>
      <Text style={[styles.buttonText, variant === 'brass' ? styles.brassText : variant === 'ink' ? styles.inkText : styles.woodText]}>{label}</Text>
    </TouchableOpacity>
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
    <View style={styles.notice} accessibilityLiveRegion="polite">
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
  rivets: { position: 'absolute', left: 0, right: 0, top: 3, height: 8 },
  sheetShadow: { borderRadius: 4, backgroundColor: C.sheet, elevation: 8, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  sheet: { borderRadius: 4, borderWidth: 1, borderColor: C.sheetEdge, backgroundColor: C.sheet, padding: 20, gap: 10, overflow: 'hidden' },
  kicker: { color: C.sheetMuted, fontFamily: F.mono, fontSize: 15, lineHeight: 18, letterSpacing: 0.9 },
  sheetTitle: { color: C.sheetInk, fontFamily: F.blackletter, fontSize: 28, lineHeight: 32 },
  button: { minHeight: S.touch, borderRadius: 6, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10, elevation: 3 },
  brass: { backgroundColor: C.brass, borderColor: C.woodSeam, borderTopColor: C.brassLight, borderBottomWidth: 3, borderBottomColor: C.brassDeep },
  plank: { backgroundColor: C.wood600, borderColor: C.woodSeam, borderBottomWidth: 3 },
  blood: { backgroundColor: C.bloodFill, borderColor: C.woodSeam, borderBottomWidth: 3 },
  ink: { backgroundColor: 'transparent', borderColor: C.sheetInk, borderWidth: 1.5, elevation: 0 },
  disabled: { opacity: 0.5 },
  buttonText: { fontFamily: F.displayBold, fontSize: T.button, lineHeight: 21, letterSpacing: 0.3, textAlign: 'center' },
  brassText: { color: C.wood900 },
  woodText: { color: C.onWood },
  inkText: { color: C.sheetInk },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: C.sheetShade, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10 },
  seal: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  sealGlyph: { fontFamily: F.bodyBold, fontSize: 13, lineHeight: 16 },
  noticeText: { flex: 1, fontFamily: F.bodySemiBold, fontSize: T.bodyLarge, lineHeight: T.lineBody },
})
