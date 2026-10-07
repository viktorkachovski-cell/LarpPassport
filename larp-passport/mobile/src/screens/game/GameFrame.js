import { memo } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { OTHER_APP, ownsGame } from '../../lib/brand'
import { describeServerSync } from '../../lib/syncStatus'
import { C, F, S, T, toneColor } from '../../lib/theme'
import { useNow } from '../../lib/useNow'
import { common } from '../../ui/common'
import { LiveDot } from '../../ui/primitives'
import { CharacterSheet, CreateCharacter } from './CharacterTab'
import { EventsTab } from './EventsTab'
import { SharingTab } from './SharingTab'

// Layout shared by both apps' game screens: header, sync line, state strip,
// tab bar and the character, events and sharing tabs. Each app supplies its
// own state cells, mode tabs and, as children, the panel for its mode tabs.
export function GameFrame({
  session, onBack, phase, phaseLabel, phaseColor, cells, banner, modeTabs, eventsLabel = 'EVENTS', scrollTabs = false, tab, setTab, children,
}) {
  const { game, character } = session
  if (session.loadError) return (
    <SafeAreaView style={styles.loading}>
      <Text style={styles.loadingText} accessibilityLiveRegion="polite">{session.loadError}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={session.refresh} style={styles.loadingAction}><Text style={styles.loadingText}>Retry</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.loadingAction}><Text style={styles.loadingText}>Back to games</Text></TouchableOpacity>
    </SafeAreaView>
  )
  if (!game || character === undefined) return (
    <SafeAreaView style={styles.loading}>
      <Text style={styles.loadingText}>LOADING GAME...</Text>
    </SafeAreaView>
  )
  if (!ownsGame(game)) return (
    <SafeAreaView style={styles.loading}>
      <Text style={styles.loadingText}>{`${game.name} runs in the ${OTHER_APP} app.`}</Text>
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.loadingAction}><Text style={styles.loadingText}>Back to games</Text></TouchableOpacity>
    </SafeAreaView>
  )

  const tabButtons = [...modeTabs, ['sheet', 'CHARACTER'], ['events', eventsLabel], ['share', 'SHARING']]
    .map(([key, label]) => (
      <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}
        accessibilityLabel={label.toLowerCase()} onPress={() => setTab(key)}
        style={[styles.tab, scrollTabs && styles.scrollTab, tab === key && styles.activeTab]}>
        <Text style={[styles.tabText, tab === key && styles.activeTabText]}>{label}</Text>
      </TouchableOpacity>
    ))

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to games" onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>&lt;</Text>
        </TouchableOpacity>
        <Text style={styles.gameName} numberOfLines={1}>{game.name.toUpperCase()}</Text>
        <View style={[styles.phaseChip, { borderColor: phaseColor }]} accessibilityLabel={`Game ${phaseLabel.toLowerCase()}`}>
          {phase === 'active' && <LiveDot color={C.green} />}
          <Text style={[styles.phaseText, { color: phaseColor }]}>{phaseLabel}</Text>
        </View>
      </View>

      <SyncStatusLine sync={session.sync} realtime={session.realtime} onRetry={session.refresh} />

      <View style={styles.stateStrip}>{cells}</View>

      {banner}

      {scrollTabs
        ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollTabsWrap}
            contentContainerStyle={styles.scrollTabs}>{tabButtons}</ScrollView>
        : <View style={styles.tabs}>{tabButtons}</View>}

      {children}

      {tab === 'sheet' && (
        character === null
          ? <CreateCharacter game={game} uid={session.uid} onCreated={session.setCharacter} />
          : <CharacterSheet character={character} stats={game.template?.stats ?? []} />
      )}

      {tab === 'events' && <EventsTab gameId={session.gameId} events={session.visibleEvents} />}

      {tab === 'share' && (
        <SharingTab
          game={game}
          phase={phase}
          sharing={session.sharing}
          permission={session.permission}
          queue={session.queue}
          error={session.error}
          sharingBusy={session.sharingBusy}
          toggleSharing={session.toggleSharing}
          sendNow={session.sendNow}
        />
      )}
    </SafeAreaView>
  )
}

// Self-ticking (10 s) so "12s ago" stays honest without re-rendering the
// screen. The age line is deliberately not a live region: announcing every
// tick would be noise. Only the error detail is announced.
function SyncStatusLine({ sync, realtime, onRetry }) {
  const now = useNow(10000)
  const status = describeServerSync({ ...sync, realtime, now })
  const color = toneColor(status.tone)
  return (
    <View style={styles.syncLine}>
      <View style={common.flex}>
        <Text style={[styles.syncText, { color }]}>{status.text}</Text>
        <Text style={styles.syncDetail} accessibilityLiveRegion={status.tone === 'error' ? 'polite' : 'none'}>{status.detail}</Text>
      </View>
      {status.tone === 'error' && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry sync" onPress={onRetry} style={styles.syncRetry}>
          <Text style={styles.syncRetryText}>RETRY</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

export const StateCell = memo(function StateCell({ value, label, color = C.text, bordered = false }) {
  const isElement = typeof value === 'object' && value !== null
  return (
    <View style={[styles.stateCell, bordered && styles.stateCellBorder]}>
      <Text style={[styles.stateValue, { color }]} numberOfLines={1}>{isElement ? value : String(value)}</Text>
      <Text style={styles.stateLabel} numberOfLines={1}>{label}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  loading: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 6 },
  loadingAction: { minHeight: S.touch, justifyContent: 'center', paddingHorizontal: 16 },
  loadingText: { color: C.cyan, fontFamily: F.mono, fontSize: T.label, letterSpacing: 1.4, textAlign: 'center', paddingHorizontal: 20, lineHeight: T.lineLabel },
  header: { minHeight: 55, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, backgroundColor: C.ink },
  backButton: { width: S.touch, minHeight: S.touch, alignItems: 'flex-start', justifyContent: 'center' },
  backText: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: 20 },
  gameName: { flex: 1, color: C.text, fontFamily: F.displayBold, fontSize: 17, letterSpacing: 1.35 },
  phaseChip: { minWidth: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, paddingVertical: 6 },
  phaseText: { fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1.1 },
  syncLine: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingBottom: 8, gap: 10 },
  syncText: { fontFamily: F.bodyMedium, fontSize: T.body },
  syncDetail: { color: C.muted, fontFamily: F.body, fontSize: T.label, lineHeight: T.lineLabel, marginTop: 1 },
  syncRetry: { minHeight: S.touch, justifyContent: 'center', borderColor: C.lineStrong, borderWidth: 1, borderRadius: 6, paddingHorizontal: 12 },
  syncRetryText: { color: C.text, fontFamily: F.displaySemiBold, fontSize: 12.5, letterSpacing: 0.85 },
  stateStrip: { minHeight: 57, flexDirection: 'row', backgroundColor: C.panel, borderTopColor: C.line, borderTopWidth: 1, borderBottomColor: C.line, borderBottomWidth: 1 },
  stateCell: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  stateCellBorder: { borderLeftColor: C.line, borderLeftWidth: 1, borderRightColor: C.line, borderRightWidth: 1 },
  stateValue: { fontFamily: F.displayBold, fontSize: 18 },
  stateLabel: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 0.6, marginTop: 3, textAlign: 'center' },
  tabs: { minHeight: S.touch, flexDirection: 'row', borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.ink },
  scrollTabsWrap: { flexGrow: 0, borderBottomColor: C.line, borderBottomWidth: 1, backgroundColor: C.ink },
  scrollTabs: { flexDirection: 'row' },
  tab: { flex: 1, minHeight: S.touch, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  scrollTab: { flex: 0, minWidth: 86, paddingHorizontal: 8 },
  activeTab: { borderBottomColor: C.cyan },
  tabText: { color: C.muted, fontFamily: F.displaySemiBold, fontSize: 13, letterSpacing: 0.4, textAlign: 'center' },
  activeTabText: { color: C.text },
})
