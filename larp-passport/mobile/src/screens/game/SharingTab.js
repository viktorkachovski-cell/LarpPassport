import { memo, useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { COPY, SHARING_FOOTNOTE } from '../../lib/brand'
import { C, F, S, T, toneColor } from '../../lib/theme'
import { describeSharing } from '../../lib/syncStatus'
import { formatAge } from '../../lib/time'
import { common } from '../../ui/common'
import { GhostButton } from '../../ui/primitives'

export const SharingTab = memo(function SharingTab({ game, phase, sharing, permission, queue, error, sharingBusy, toggleSharing, sendNow }) {
  const status = describeSharing({
    sharing, permission, lastFixAt: queue.lastFixAt, queued: queue.queued ?? 0, failed: queue.failed ?? 0, lastError: queue.lastError,
  })
  const stateColor = toneColor(status.tone)
  // Telemetry is for troubleshooting; a brand may fold it away until asked.
  const [detailsOpen, setDetailsOpen] = useState(!COPY.sharing.collapseDetails)
  return (
    <ScrollView style={common.flex} contentContainerStyle={common.scrollContent}>
      <View style={common.neutralCard}>
        <View style={styles.sharingHeader}>
          <View style={common.flex}>
            <Text style={styles.sharingTitle}>Location sharing</Text>
            <Text style={[styles.sharingState, { color: stateColor }]}>{status.text}</Text>
          </View>
          <Switch
            accessibilityLabel="Location sharing"
            accessibilityRole="switch"
            value={sharing}
            disabled={sharingBusy}
            onValueChange={toggleSharing}
            trackColor={{ true: C.cyan, false: C.lineStrong }}
            thumbColor={sharing ? C.ink : C.muted}
          />
        </View>
        {status.lines.map((line) => (
          <Text key={line} style={[styles.sharingFact, status.tone === 'error' && common.errorText, status.tone === 'warning' && common.amberText]}>{line}</Text>
        ))}
        <Text style={common.bodyCopy}>
          While enabled, your phone sends its position roughly every 15 seconds, including with the screen off. GMs see it on their map and a permanent notification stays visible.
        </Text>
        <Text style={[common.bodyCopy, styles.sharingDetails]}>
          Position history is deleted automatically after {game.purge_after_days} day{game.purge_after_days === 1 ? '' : 's'}. You can stop at any time.
        </Text>
        {phase === 'finished' && <Text style={styles.warningCopy}>The game has finished; location pings are no longer accepted.</Text>}
        {!!error && <Text style={common.errorText}>{error}</Text>}
        {!!error && !sharing && <GhostButton label="RETRY STOP SHARING" onPress={() => toggleSharing(false)} />}
      </View>

      {COPY.sharing.collapseDetails && (
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }}
          onPress={() => setDetailsOpen((open) => !open)} style={styles.detailsToggle}>
          <Text style={styles.detailsToggleText}>{detailsOpen ? 'Hide details' : 'Show details'}</Text>
        </TouchableOpacity>
      )}
      {detailsOpen && <SyncDetails queue={queue} sendNow={sendNow} />}
      {!!SHARING_FOOTNOTE && <Text style={styles.sharingFootnote}>{SHARING_FOOTNOTE}</Text>}
    </ScrollView>
  )
})

function SyncDetails({ queue, sendNow }) {
  const failed = queue.failed ?? 0
  return (
    <View style={styles.telemetryCard}>
      <Text style={styles.telemetryKicker}>SYNC DETAILS</Text>
      <View style={styles.telemetryRow}>
        <TelemetryCell label="QUEUED" value={queue.queued ?? 0} color={C.cyan} />
        <TelemetryCell label="LAST SENT" value={(formatAge(queue.lastSent) ?? 'never').toUpperCase()} color={queue.lastSent ? C.green : C.muted} />
        <TelemetryCell label="GPS FIX" value={(formatAge(queue.lastFixAt) ?? 'none').toUpperCase()} color={queue.lastFixAt ? C.text : C.muted} />
        <TelemetryCell label="GPS MODE" value={queue.profile === 'far' ? 'RELAXED' : 'PRECISE'} />
      </View>
      {failed > 0 && (
        <Text style={common.errorText}>{failed} update{failed === 1 ? '' : 's'} rejected by the server and will not be retried{queue.lastError ? `: ${queue.lastError}` : '.'}</Text>
      )}
      <Text style={styles.telemetryNote}>Queued updates are sent automatically. "Last sent" is about location updates only; it does not prove the rest of the game data is current.</Text>
      <GhostButton label="SEND NOW" onPress={sendNow} />
    </View>
  )
}

const TelemetryCell = memo(function TelemetryCell({ label, value, color = C.text }) {
  return (
    <View style={styles.telemetryCell}>
      <Text style={[styles.telemetryValue, { color }]}>{String(value)}</Text>
      <Text style={styles.telemetryLabel}>{label}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  sharingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  sharingTitle: { color: C.text, fontFamily: F.bodySemiBold, fontSize: 16 },
  sharingState: { color: C.cyan, fontFamily: F.bodyMedium, fontSize: T.body, marginTop: 3 },
  sharingDetails: { marginTop: 9 },
  sharingFact: { color: C.text, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody, marginTop: 4 },
  telemetryNote: { color: C.muted, fontFamily: F.body, fontSize: T.label, lineHeight: T.lineLabel, marginTop: 10 },
  warningCopy: { color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody, marginTop: 11 },
  detailsToggle: { minHeight: S.touch, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  detailsToggleText: { color: C.text, fontFamily: F.bodySemiBold, fontSize: T.body, textDecorationLine: 'underline' },
  telemetryCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 12 },
  telemetryKicker: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1.2 },
  telemetryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 },
  telemetryCell: { flexGrow: 1, flexBasis: '45%', minHeight: 60, backgroundColor: C.ink, borderColor: C.line, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 8 },
  telemetryValue: { fontFamily: F.displayBold, fontSize: T.bodyLarge, textAlign: 'center' },
  telemetryLabel: { color: C.muted, fontFamily: F.mono, fontSize: T.micro, letterSpacing: 0.6, marginTop: 3 },
  sharingFootnote: { color: C.muted, fontFamily: F.body, fontSize: T.label, lineHeight: T.lineLabel, textAlign: 'center', marginTop: 14 },
})
