import { StyleSheet } from 'react-native'
import { C, F, S, T } from '../lib/theme'

// Styles shared by more than one game tab and the UI primitives.
export const common = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { padding: 15, paddingBottom: 32 },
  neutralCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 17 },
  cyanKicker: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1.3 },
  sectionTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 20, marginTop: 7 },
  bodyCopy: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, marginTop: 7 },
  amberText: { color: C.amber },
  filledButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: T.button, letterSpacing: 1, textAlign: 'center' },
  disabled: { opacity: 0.55 },
  errorText: { color: C.red, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody, marginTop: 10 },
  privateCaption: { color: C.muted, fontFamily: F.mono, fontSize: T.micro, lineHeight: T.lineLabel, letterSpacing: 0.5, marginTop: 9 },
  field: { marginBottom: 12 },
  inputLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1, marginBottom: 5 },
  input: { minHeight: S.touch, backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, color: C.text, fontFamily: F.body, fontSize: 16, paddingHorizontal: 12, paddingVertical: 10 },
})
