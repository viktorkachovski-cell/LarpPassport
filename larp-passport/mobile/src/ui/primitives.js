import { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { C, F, S, T } from '../lib/theme'
import { useReducedMotion } from '../lib/useReducedMotion'
import { common } from './common'

export function Field({ label, style, ...props }) {
  return (
    <View style={common.field}>
      <Text style={common.inputLabel}>{label}</Text>
      <TextInput style={[common.input, style]} accessibilityLabel={label} placeholderTextColor={C.muted} {...props} />
    </View>
  )
}

// Consequential outcome that stays until the player dismisses it. Dismissing
// only clears local state; it never confirms, resolves or acknowledges anything
// on the server.
export function OutcomeNote({ text, tone = 'ok', onDismiss }) {
  return (
    <View style={[styles.outcomeNote, tone === 'error' && styles.outcomeNoteError]} accessibilityLiveRegion="polite">
      <Text style={[styles.outcomeText, tone === 'error' && common.errorText, tone === 'error' && styles.outcomeErrorText]}>{text}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={onDismiss} style={styles.outcomeDismiss}>
        <Text style={styles.outcomeDismissText}>DISMISS</Text>
      </TouchableOpacity>
    </View>
  )
}

export function GhostButton({ label, onPress }) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.ghostButton}>
      <Text style={styles.ghostButtonText}>{label}</Text>
    </TouchableOpacity>
  )
}

// Decorative pulse. Static when reduced motion is on; always hidden from
// assistive tech because the adjacent text carries the meaning.
export function LiveDot({ color }) {
  const opacity = useRef(new Animated.Value(1)).current
  const reduced = useReducedMotion()

  useEffect(() => {
    if (reduced) { opacity.setValue(1); return undefined }
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.35, duration: 1000, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 1000, useNativeDriver: true }),
    ]))
    animation.start()
    return () => { animation.stop(); opacity.setValue(1) }
  }, [opacity, reduced])

  return <Animated.View importantForAccessibility="no" accessibilityElementsHidden style={[styles.liveDot, { backgroundColor: color, opacity }]} />
}

const styles = StyleSheet.create({
  liveDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  outcomeNote: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(63,214,143,0.08)', borderColor: C.greenBorder, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12 },
  outcomeNoteError: { backgroundColor: 'rgba(255,84,73,0.08)', borderColor: C.redBorder },
  outcomeText: { flex: 1, color: C.green, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  outcomeErrorText: { marginTop: 0 },
  outcomeDismiss: { minHeight: S.touch, justifyContent: 'center', paddingHorizontal: 8 },
  outcomeDismissText: { color: C.text, fontFamily: F.displaySemiBold, fontSize: 12, letterSpacing: 0.8 },
  ghostButton: { minHeight: S.touch, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 12, marginTop: 14 },
  ghostButtonText: { color: C.text, fontFamily: F.displaySemiBold, fontSize: T.button, letterSpacing: 0.8, textAlign: 'center' },
})
