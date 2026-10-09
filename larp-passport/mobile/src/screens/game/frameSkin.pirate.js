import { StyleSheet, View } from 'react-native'
import { C, F, T } from '../../lib/theme'
import { BackIcon, Rivets, WoodBackdrop } from '../../pirate/ui'

// The Black Tide dresses GameFrame as a ship: a riveted wooden rail, a brass
// back boss, plank tabs and plank state cells over deck planking.
function BrassBack() {
  return <View style={styles.brassBoss}><BackIcon size={22} color={C.wood900} /></View>
}

const styles = StyleSheet.create({
  safe: { backgroundColor: C.wood700 },
  loading: { backgroundColor: C.wood800 },
  loadingText: { color: C.onWood, fontFamily: F.mono, fontSize: T.label, letterSpacing: 0.6 },
  header: { minHeight: 64, backgroundColor: C.wood800, paddingTop: 10, gap: 10 },
  backButton: { width: 52 },
  brassBoss: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.brass, borderWidth: 2, borderColor: C.woodSeam, borderTopColor: C.brassLight, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  gameName: { color: C.onWood, fontFamily: F.blackletter, fontSize: 28, lineHeight: 34, letterSpacing: 0 },
  phaseChip: { backgroundColor: C.wood900, borderRadius: 18, paddingVertical: 5, paddingHorizontal: 12 },
  phaseText: { fontFamily: F.mono, fontSize: 15, letterSpacing: 0.4 },
  phaseLine: { backgroundColor: C.wood800, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: C.woodSeam },
  phaseHint: { color: C.onWood, fontFamily: F.bodyMedium, fontSize: T.bodyLarge, lineHeight: 22 },
  gpsButton: { backgroundColor: C.wood900, borderColor: C.brassDeep },
  gpsButtonSelected: { backgroundColor: C.tide, borderColor: C.brass },
  gpsText: { color: C.onWood, fontFamily: F.bodyBold, fontSize: 15 },
  syncLine: { backgroundColor: C.wood800, paddingBottom: 10, borderBottomWidth: 2, borderBottomColor: C.woodSeam },
  syncDetail: { color: C.onWoodMuted },
  syncRetry: { borderColor: C.woodSeam, backgroundColor: C.wood600 },
  syncRetryText: { color: C.onWood, fontFamily: F.displayBold, fontSize: 15 },
  stateStrip: { minHeight: 64, backgroundColor: 'transparent', borderTopWidth: 0, borderBottomWidth: 0, paddingHorizontal: 12, paddingTop: 10, gap: 8 },
  stateCell: { backgroundColor: C.wood600, borderRadius: 10, borderWidth: 1, borderColor: C.woodSeam, borderBottomWidth: 3, paddingVertical: 6, elevation: 3 },
  stateCellBorder: { borderLeftColor: C.woodSeam, borderRightColor: C.woodSeam },
  stateValue: { fontFamily: F.numeric, fontSize: 21, lineHeight: 26 },
  stateLabel: { color: C.onWoodMuted, fontFamily: F.mono, fontSize: 14, letterSpacing: 0.3 },
  tabs: { backgroundColor: 'transparent', borderBottomWidth: 0, paddingHorizontal: 10, paddingVertical: 10, gap: 6 },
  scrollTabsWrap: { backgroundColor: 'transparent', borderBottomWidth: 0 },
  scrollTabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: { backgroundColor: C.wood600, borderRadius: 10, borderWidth: 1, borderColor: C.woodSeam, borderBottomWidth: 3, borderBottomColor: C.woodSeam, elevation: 3 },
  scrollTab: { minWidth: 96, paddingHorizontal: 12 },
  activeTab: { backgroundColor: C.tide, borderBottomColor: C.brass, elevation: 0, transform: [{ translateY: 2 }] },
  tabText: { color: C.onWood, fontFamily: F.displayBold, fontSize: 16, letterSpacing: 0.2 },
  activeTabText: { color: C.onWood },
})

// quietSync: the sync line shows only when data is old or a request failed.
export const skin = { styles, Backdrop: WoodBackdrop, HeaderDecor: Rivets, BackGlyph: BrassBack, upperName: false, quietSync: true }
