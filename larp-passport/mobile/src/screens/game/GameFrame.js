import { memo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { COPY, OTHER_APP, ownsGame } from '../../lib/brand'
import { describeServerSync, describeSharing } from '../../lib/syncStatus'
import { C, F, S, T, toneColor } from '../../lib/theme'
import { useNow } from '../../lib/useNow'
import { common } from '../../ui/common'
import { LiveDot } from '../../ui/primitives'
import { CharacterSheet, CreateCharacter } from './CharacterTab'
import { EventsTab } from './EventsTab'
import { SharingTab } from './SharingTab'
import { skin } from './frameSkin'

// Layout shared by both apps' game screens: header, sync line, state strip,
// tab bar and the character, events and sharing tabs. Each app supplies its
// state cells, mode tabs and, as children, the panel for its mode tabs; its
// frameSkin restyles the chrome. Optional: a phase line under the header (the
// phase chip moves into it), the character or sharing tab left out of the
// bar, and a GPS button in the header that opens the sharing view instead.
const sk = skin.styles

// Full-screen loading, error and wrong-app states. actions: [label, onPress].
function FrameMessage({ text, live = false, actions = [] }) {
  return (
    <SafeAreaView style={[styles.loading, sk.loading]}>
      <Text style={[styles.loadingText, sk.loadingText]} accessibilityLiveRegion={live ? 'polite' : undefined}>{text}</Text>
      {actions.map(([label, onPress]) => (
        <TouchableOpacity key={label} accessibilityRole="button" onPress={onPress} style={styles.loadingAction}>
          <Text style={[styles.loadingText, sk.loadingText]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </SafeAreaView>
  )
}

function DefaultTab({ label, selected, onPress }) {
  return (
    <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label.toLowerCase()}
      onPress={onPress} style={[styles.tab, selected && styles.activeTab]}>
      <Text style={[styles.tabText, selected && styles.activeTabText]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{label}</Text>
    </TouchableOpacity>
  )
}
const TabButton = skin.TabButton ?? DefaultTab

function PhaseChip({ phase, label, color }) {
  return (
    <View style={[styles.phaseChip, sk.phaseChip, { borderColor: color }]} accessibilityLabel={`Game ${label.toLowerCase()}`}>
      {phase === 'active' && <LiveDot color={C.green} />}
      <Text style={[styles.phaseText, sk.phaseText, { color }]}>{label}</Text>
    </View>
  )
}

function FrameHeader({ session, onBack, chip, phaseHint, gpsInHeader, tab, setTab }) {
  const { name } = session.game
  return <>
    <View style={[styles.header, sk.header]}>
      {skin.HeaderDecor && <skin.HeaderDecor />}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to games" onPress={onBack} style={[styles.backButton, sk.backButton]}>
        {skin.BackGlyph ? <skin.BackGlyph /> : <Text style={styles.backText}>&lt;</Text>}
      </TouchableOpacity>
      <Text style={[styles.gameName, sk.gameName]} numberOfLines={1}>{skin.upperName ? name.toUpperCase() : name}</Text>
      {!phaseHint && chip}
      {gpsInHeader && <GpsButton session={session} selected={tab === 'share'} onPress={() => setTab('share')} />}
    </View>
    {!!phaseHint && (
      <View style={[styles.phaseLine, sk.phaseLine]}>
        {chip}
        <Text style={[styles.phaseHint, sk.phaseHint]}>{phaseHint}</Text>
      </View>
    )}
  </>
}

// The character, events and sharing tabs every game shares.
function SharedTab({ tab, session, phase, hasSheet }) {
  const { game, character } = session
  if (tab === 'sheet' && hasSheet) {
    return character === null
      ? <CreateCharacter game={game} uid={session.uid} onCreated={session.setCharacter} />
      : <CharacterSheet character={character} stats={game.template?.stats ?? []} />
  }
  if (tab === 'events') return <EventsTab gameId={session.gameId} events={session.visibleEvents} />
  if (tab !== 'share') return null
  return <SharingTab game={game} phase={phase} sharing={session.sharing} permission={session.permission} queue={session.queue}
    error={session.error} sharingBusy={session.sharingBusy} toggleSharing={session.toggleSharing} sendNow={session.sendNow} />
}

export function GameFrame({
  session, onBack, phase, phaseLabel, phaseColor, phaseHint, cells, banner, modeTabs, eventsLabel = 'EVENTS',
  sheetTab = ['sheet', 'CHARACTER'], shareTab = ['share', 'SHARING'], gpsInHeader = false, tab, setTab, children,
}) {
  const { game, character } = session
  if (session.loadError) return <FrameMessage text={session.loadError} live actions={[['Retry', session.refresh], ['Back to games', onBack]]} />
  if (!game || character === undefined) return <FrameMessage text={COPY.loadingGame} />
  if (!ownsGame(game)) return <FrameMessage text={`${game.name} runs in the ${OTHER_APP} app.`} actions={[['Back to games', onBack]]} />

  const tabs = [...modeTabs, sheetTab, ['events', eventsLabel], shareTab].filter(Boolean)
  return (
    <SafeAreaView style={[styles.safe, sk.safe]}>
      {skin.Backdrop && <skin.Backdrop />}
      <FrameHeader session={session} onBack={onBack} phaseHint={phaseHint} gpsInHeader={gpsInHeader} tab={tab} setTab={setTab}
        chip={<PhaseChip phase={phase} label={phaseLabel} color={phaseColor} />} />
      <SyncStatusLine sync={session.sync} realtime={session.realtime} onRetry={session.refresh} />
      <View style={[styles.stateStrip, sk.stateStrip]}>{cells}</View>
      {banner}
      <View style={[styles.tabs, sk.tabs]}>
        {tabs.map(([key, label]) => <TabButton key={key} label={label} selected={tab === key} onPress={() => setTab(key)} />)}
      </View>
      {children}
      <SharedTab tab={tab} session={session} phase={phase} hasSheet={!!sheetTab} />
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
  if (skin.quietSync && (status.tone === 'ok' || status.tone === 'checking')) return null
  return (
    <View style={[styles.syncLine, sk.syncLine]}>
      <View style={common.flex}>
        <Text style={[styles.syncText, { color }]}>{status.text}</Text>
        <Text style={[styles.syncDetail, sk.syncDetail]} accessibilityLiveRegion={status.tone === 'error' ? 'polite' : 'none'}>{status.detail}</Text>
      </View>
      {status.tone === 'error' && (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry sync" onPress={onRetry} style={[styles.syncRetry, sk.syncRetry]}>
          <Text style={[styles.syncRetryText, sk.syncRetryText]}>RETRY</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

// Location sharing at a glance. The colour follows the sharing status tone and
// the label carries the meaning, so colour is never the only signal.
function GpsButton({ session, selected, onPress }) {
  const now = useNow(10000)
  const { queue } = session
  const status = describeSharing({
    sharing: session.sharing, permission: session.permission, lastFixAt: queue.lastFixAt,
    queued: queue.queued ?? 0, failed: queue.failed ?? 0, lastError: queue.lastError, now,
  })
  const color = toneColor(status.tone)
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${status.text}. Open location sharing`}
      accessibilityState={{ selected }} onPress={onPress} style={[styles.gpsButton, sk.gpsButton, selected && sk.gpsButtonSelected]}>
      <View style={[styles.gpsDot, { backgroundColor: color }]} />
      <Text style={[styles.gpsText, sk.gpsText]}>{session.sharing ? 'GPS' : 'GPS off'}</Text>
    </TouchableOpacity>
  )
}

export const StateCell = memo(function StateCell({ value, label, color = C.text, bordered = false }) {
  const isElement = typeof value === 'object' && value !== null
  return (
    <View style={[styles.stateCell, sk.stateCell, bordered && styles.stateCellBorder, bordered && sk.stateCellBorder]}>
      <Text style={[styles.stateValue, sk.stateValue, { color }]} numberOfLines={1}>{isElement ? value : String(value)}</Text>
      <Text style={[styles.stateLabel, sk.stateLabel]} numberOfLines={1}>{label}</Text>
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
  phaseLine: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, paddingBottom: 8, gap: 10 },
  phaseHint: { flex: 1, color: C.text, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  gpsButton: { minHeight: S.touch, minWidth: S.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderColor: C.line, borderWidth: 1, borderRadius: 22, paddingHorizontal: 10 },
  gpsDot: { width: 10, height: 10, borderRadius: 5 },
  gpsText: { color: C.text, fontFamily: F.bodySemiBold, fontSize: T.label },
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
  tab: { flex: 1, minHeight: S.touch, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent', paddingHorizontal: 2 },
  activeTab: { borderBottomColor: C.cyan },
  tabText: { color: C.muted, fontFamily: F.displaySemiBold, fontSize: 13, letterSpacing: 0.4, textAlign: 'center' },
  activeTabText: { color: C.text },
})
