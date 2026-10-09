import { StyleSheet, Text, View } from 'react-native'
import { C, F, T } from '../../lib/theme'
import { BackIcon, PressPlank, Rivets, WoodBackdrop } from '../../pirate/ui'

// The Black Tide dresses GameFrame as a ship: a riveted wooden rail, a brass
// back boss, plank tabs and plank state cells over deck planking.
function BrassBack() {
  return <View style={styles.brassBoss}><BackIcon size={22} color={C.wood900} /></View>
}

// A nailed plank per tab. The selected plank is seated into the rail and
// takes the tide-green stain with a brass edge.
function PlankTab({ label, selected, scroll, onPress }) {
  return (
    <PressPlank accessibilityRole="tab" accessibilityLabel={label.toLowerCase()} accessibilityState={{ selected }}
      selected={selected} onPress={onPress} nails
      face={selected ? C.tide : C.wood600} lip={selected ? C.brassDeep : C.woodSeam} edge={selected ? C.brass : C.onWoodMuted}
      style={scroll ? styles.plankTabScroll : styles.plankTab}>
      <Text style={[styles.tabText, selected && styles.activeTabText]}>{label}</Text>
    </PressPlank>
  )
}

const styles = StyleSheet.create({
  safe: { backgroundColor: C.wood700 },
  loading: { backgroundColor: C.wood800 },
  loadingText: { color: C.onWood, fontFamily: F.mono, fontSize: T.label, letterSpacing: 0.6 },
  header: { minHeight: 64, backgroundColor: C.wood800, paddingTop: 8, paddingHorizontal: 16, gap: 8 },
  backButton: { width: 52 },
  brassBoss: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.brass, borderWidth: 1, borderColor: C.brassDeep, borderTopColor: C.brassLight, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  gameName: { color: C.onWood, fontFamily: F.blackletter, fontSize: 28, lineHeight: 34, letterSpacing: 0, paddingVertical: 4 },
  phaseChip: { backgroundColor: C.wood900, borderRadius: 18, paddingVertical: 5, paddingHorizontal: 12 },
  phaseText: { fontFamily: F.mono, fontSize: 15, letterSpacing: 0.4 },
  phaseLine: { backgroundColor: C.wood800, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 8, alignItems: 'flex-start', borderBottomWidth: 1, borderBottomColor: C.woodSeam },
  phaseHint: { color: C.onWood, fontFamily: F.bodyMedium, fontSize: T.bodyLarge, lineHeight: 23 },
  gpsButton: { backgroundColor: C.wood900, borderColor: C.brassDeep },
  gpsButtonSelected: { backgroundColor: C.tide, borderColor: C.brass },
  gpsText: { color: C.onWood, fontFamily: F.bodyBold, fontSize: 15 },
  syncLine: { backgroundColor: C.wood800, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: C.woodSeam },
  syncDetail: { color: C.onWoodMuted },
  syncRetry: { borderColor: C.woodSeam, backgroundColor: C.wood600 },
  syncRetryText: { color: C.onWood, fontFamily: F.displayBold, fontSize: 15 },
  stateStrip: { minHeight: 64, backgroundColor: 'transparent', borderTopWidth: 0, borderBottomWidth: 0, paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  stateCell: { backgroundColor: C.wood600, borderRadius: 12, borderWidth: 1, borderColor: C.woodSeam, borderTopColor: C.brassDeep, borderBottomWidth: 2, paddingVertical: 8, elevation: 2 },
  stateCellBorder: { borderLeftColor: C.woodSeam, borderRightColor: C.woodSeam },
  stateValue: { fontFamily: F.numeric, fontSize: 21, lineHeight: 26 },
  stateLabel: { color: C.onWoodMuted, fontFamily: F.mono, fontSize: 14, letterSpacing: 0.3 },
  tabs: { backgroundColor: 'transparent', borderBottomWidth: 0, paddingHorizontal: 8, paddingTop: 16, paddingBottom: 0, gap: 4 },
  scrollTabsWrap: { backgroundColor: 'transparent', borderBottomWidth: 0 },
  scrollTabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  plankTab: { flex: 1 },
  plankTabScroll: { minWidth: 96 },
  tabText: { color: C.onWoodMuted, fontFamily: F.displayBold, fontSize: 14, lineHeight: 18, letterSpacing: 0, paddingHorizontal: 2, paddingVertical: 8, textAlign: 'center' },
  activeTabText: { color: C.onWood, textShadowColor: C.woodSeam, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 0 },
})

// quietSync: the sync line shows only when data is old or a request failed.
export const skin = { styles, Backdrop: WoodBackdrop, HeaderDecor: Rivets, BackGlyph: BrassBack, upperName: false, nameLines: 2, quietSync: true, TabButton: PlankTab }
