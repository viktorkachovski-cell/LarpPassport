import { memo } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { C, F, S, T } from '../../lib/theme'
import { showsMetres } from '../../lib/direction'
import { formatAge, remainingMinutes } from '../../lib/time'
import { common } from '../../ui/common'
import { GhostButton, LiveDot, OutcomeNote } from '../../ui/primitives'
import { DirectionSignal } from './DirectionSignal'

const BANDS = ['immediate', 'close', 'nearby', 'distant', 'far']

export const HuntPanel = memo(function HuntPanel({ hunt, hasCharacter, busy, error, outcome, dismissOutcome, boundaryWarning, requestElimination, respondToElimination, refresh }) {
  function confirmDefeat() {
    Alert.alert(
      'Confirm your elimination?',
      'This removes you from the hunt. A GM can restore you if the app or ruling is inconsistent.',
      [
        { text: 'Not confirmed', style: 'cancel', onPress: () => respondToElimination(false) },
        { text: 'Confirm elimination', style: 'destructive', onPress: () => respondToElimination(true) },
      ],
    )
  }

  if (!hunt) {
    return (
      <View style={styles.centerState}>
        <Text style={[styles.centerCopy, error && common.errorText]}>{error || 'Loading hunt status...'}</Text>
        {!!error && <GhostButton label="RETRY" onPress={refresh} />}
      </View>
    )
  }

  if (hunt.phase === 'not_started') {
    return (
      <ScrollView style={common.flex} contentContainerStyle={common.scrollContent}>
        <View style={common.neutralCard}>
          <Text style={common.cyanKicker}>O AWAITING THE HUNT</Text>
          <Text style={common.sectionTitle}>Hunt not started</Text>
          <Text style={common.bodyCopy}>The GM will lock the roster and assign one secret target to every traveller.</Text>
          {!hasCharacter && (
            <View style={styles.warningInset}>
              <Text style={styles.warningInsetText}>Create your character before the hunt can start.</Text>
            </View>
          )}
          {!!error && <Text style={common.errorText}>{error}</Text>}
          <GhostButton label="REFRESH" onPress={refresh} />
        </View>
      </ScrollView>
    )
  }

  if (!hunt.participant) {
    return (
      <View style={styles.centerState}>
        <View style={styles.neutralIcon}><Text style={styles.neutralIconText}>O</Text></View>
        <Text style={common.sectionTitle}>Observer</Text>
        <Text style={styles.centerCopy}>You are not part of this hunt's target chain.</Text>
      </View>
    )
  }

  if (hunt.phase === 'finished') return <FinishedState hunt={hunt} />
  if (!hunt.alive) return <EliminatedState aliveCount={hunt.alive_count} />

  const cloakMinutes = remainingMinutes(hunt.hidden_until)
  const awaitingTarget = !hunt.target
  const claimPending = !!hunt.outgoing_claim
  const disabled = busy || claimPending || awaitingTarget

  return (
    <ScrollView style={common.flex} contentContainerStyle={common.scrollContent}>
      {!!hunt.incoming_claim && (
        <View style={styles.claimAlert} accessibilityLiveRegion="polite">
          <Text style={styles.redKicker}>! ELIMINATION CLAIMED</Text>
          <Text style={styles.claimTitle}>A hunter claims they defeated you</Text>
          <Text style={common.bodyCopy}>The hunter remains anonymous. Confirm only after the live battle is resolved.</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={confirmDefeat} style={[styles.redButton, busy && common.disabled]}>
            <Text style={common.filledButtonText}>REVIEW CONFIRMATION</Text>
          </TouchableOpacity>
        </View>
      )}

      {boundaryWarning && (
        <View style={styles.boundaryBanner} accessibilityLiveRegion="polite">
          <Text style={styles.amberKicker}>! ANOMALY BOUNDARY AHEAD</Text>
          <Text style={styles.boundaryCopy}>Move toward the safe interior. Leaving forfeits any pending claim and alerts the GM.</Text>
        </View>
      )}

      {cloakMinutes > 0 && (
        <View style={styles.cloakCard}>
          <View style={styles.kickerRow}><LiveDot color={C.cyan} /><Text style={common.cyanKicker}>TEMPORAL CLOAK ACTIVE</Text></View>
          <Text style={styles.cloakCopy}>Your hunter cannot read your proximity for about {cloakMinutes} minute{cloakMinutes === 1 ? '' : 's'}.</Text>
        </View>
      )}

      <View style={[styles.targetCard, awaitingTarget && styles.awaitingCard]}>
        <View style={[styles.targetHeader, awaitingTarget && styles.awaitingHeader]}>
          <Text style={[styles.targetKicker, awaitingTarget && styles.mutedKicker]}>+ YOUR TARGET</Text>
          {!!hunt.direction_enabled && <Text style={styles.directionChip}>DIRECTION ON</Text>}
          {!!hunt.target?.proximity?.last_seen_at && (
            <Text style={[styles.signalAge, hunt.target.proximity.state === 'stale' && common.amberText]}>{formatAge(hunt.target.proximity.last_seen_at)}</Text>
          )}
        </View>
        <View style={styles.targetBody}>
          <Text style={[styles.targetName, awaitingTarget && styles.awaitingName]}>{hunt.target?.character_name ?? 'NO TARGET YET'}</Text>
          {awaitingTarget ? (
            <Text style={common.bodyCopy}>Elimination confirmed. Waiting for the GM to assign your next target. No claim can start until then.</Text>
          ) : (
            <ProximitySignal proximity={hunt.target.proximity} />
          )}

          <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={requestElimination} style={[disabled ? styles.disabledClaimButton : styles.claimButton, busy && common.disabled]}>
            <Text style={disabled ? styles.disabledButtonText : common.filledButtonText}>
              {awaitingTarget ? 'WAITING FOR GM TARGET ASSIGNMENT' : claimPending ? 'WAITING FOR TARGET CONFIRMATION' : 'CLAIM ELIMINATION'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.claimCaption}>
            {claimPending ? 'TARGET RESPONSE PENDING' : 'CLAIM ONLY AFTER THE LIVE BATTLE IS RESOLVED\nYOUR TARGET MUST CONFIRM // YOU STAY ANONYMOUS'}
          </Text>
          {!!error && <Text style={common.errorText} accessibilityLiveRegion="polite">{error}</Text>}
          {!!outcome && <OutcomeNote text={outcome} onDismiss={dismissOutcome} />}
        </View>
      </View>
      <Text style={styles.hunterWarning}>SOMEONE IS HUNTING YOU. THEIR NAME IS NEVER SHOWN.</Text>
    </ScrollView>
  )
})

function ProximitySignal({ proximity }) {
  if (!proximity || proximity.state === 'waiting_for_location') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalNeutral}>WAITING</Text>
        <Text style={common.bodyCopy}>Waiting for both devices to report location.</Text>
      </View>
    )
  }

  if (proximity.state === 'stale') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalStale}>STALE</Text>
        <Text style={common.bodyCopy}>Signal older than 2 minutes. Keep moving and try again.</Text>
      </View>
    )
  }

  if (proximity.state === 'cloaked') {
    return (
      <View style={styles.signalState}>
        <Text style={styles.signalMasked}>MASKED</Text>
        <Text style={common.bodyCopy}>Target signal hidden for about {remainingMinutes(proximity.available_at)} minute(s).</Text>
      </View>
    )
  }

  if (proximity.state !== 'available') {
    return <Text style={common.bodyCopy}>Target signal unavailable.</Text>
  }

  const activeBand = String(proximity.band ?? '').toLowerCase()
  return (
    <View style={styles.signalAvailable}>
      <View style={styles.distanceRow}>
        <Text style={styles.bandWord} accessibilityLabel={`Target is ${activeBand}`}>{activeBand.toUpperCase()}</Text>
        {showsMetres(proximity) && <Text style={styles.distance}>~{Math.round(Number(proximity.distance_m) / 10) * 10} m</Text>}
      </View>
      <View style={styles.meterRow} importantForAccessibility="no-hide-descendants">
        {BANDS.map((band) => {
          const active = band === activeBand
          return (
            <View key={band} style={styles.meterItem}>
              <View style={[styles.meterBar, active && styles.meterBarActive]} />
              <Text style={[styles.meterLabel, active && styles.meterLabelActive]}>{band.toUpperCase()}</Text>
            </View>
          )
        })}
      </View>
      <DirectionSignal proximity={proximity} />
    </View>
  )
}

function FinishedState({ hunt }) {
  const won = hunt.winner?.is_self
  return (
    <View style={styles.centerState}>
      <View style={[styles.resultIcon, won ? styles.winnerIcon : styles.otherIcon]}>
        <Text style={[styles.resultIconText, { color: won ? C.cyan : C.muted }]}>{won ? '*' : 'O'}</Text>
      </View>
      <Text style={[styles.resultTitle, won && styles.winnerTitle]}>{won ? 'TIMELINE SECURED' : 'THE TIMELINE BELONGS TO ANOTHER'}</Text>
      <Text style={styles.resultCopy}><Text style={!won && styles.targetInline}>{hunt.winner?.character_name ?? 'The final traveller'}</Text> is the last traveller standing.</Text>
      <View style={[styles.resultChip, won && styles.winnerChip]}>
        <Text style={[styles.resultChipText, won && styles.winnerChipText]}>ROUND COMPLETE</Text>
      </View>
    </View>
  )
}

function EliminatedState({ aliveCount }) {
  return (
    <View style={styles.centerState}>
      <View style={styles.eliminatedIcon}><Text style={styles.eliminatedIconText}>X</Text></View>
      <Text style={styles.eliminatedTitle}>ELIMINATED</Text>
      <Text style={styles.resultCopy}>Location sharing has stopped. Your latest map position is removed and no target is revealed.</Text>
      <View style={styles.resultChip}><Text style={styles.resultChipText}>{aliveCount} TRAVELLERS REMAIN</Text></View>
      <Text style={styles.restoreNote}>THE GM CAN RESTORE YOU TO THE CHAIN</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  centerCopy: { color: C.muted, fontFamily: F.body, fontSize: T.bodyLarge, lineHeight: 22, textAlign: 'center', marginTop: 9 },
  redKicker: { color: C.red, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1.3 },
  amberKicker: { color: C.amber, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1.2 },
  kickerRow: { flexDirection: 'row', alignItems: 'center' },
  warningInset: { backgroundColor: 'rgba(255,176,32,0.08)', borderColor: C.amberBorder, borderWidth: 1, borderRadius: 6, padding: 11, marginTop: 14 },
  warningInsetText: { color: C.amber, fontFamily: F.bodyMedium, fontSize: T.body, lineHeight: T.lineBody },
  neutralIcon: { width: 60, height: 60, borderRadius: 30, borderColor: C.lineStrong, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  neutralIconText: { color: C.muted, fontFamily: F.displayBold, fontSize: 21 },
  claimAlert: { backgroundColor: C.panel, borderColor: C.red, borderWidth: 1, borderRadius: 10, padding: 15, marginBottom: 11 },
  claimTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 19, lineHeight: 24, marginTop: 7 },
  redButton: { minHeight: S.touch, backgroundColor: C.red, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, marginTop: 14 },
  boundaryBanner: { backgroundColor: 'rgba(255,176,32,0.08)', borderColor: C.amberBorder, borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 11 },
  boundaryCopy: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, marginTop: 5 },
  cloakCard: { backgroundColor: C.panel, borderColor: C.cyanBorder, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 11 },
  cloakCopy: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, marginTop: 4 },
  targetCard: { backgroundColor: C.panel, borderColor: C.orange, borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  awaitingCard: { borderColor: C.line },
  targetHeader: { backgroundColor: 'rgba(255,122,51,0.10)', borderBottomColor: 'rgba(255,122,51,0.40)', borderBottomWidth: 1, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  awaitingHeader: { backgroundColor: C.panel2, borderBottomColor: C.line },
  targetKicker: { flex: 1, color: C.orangeBright, fontFamily: F.monoSemiBold, fontSize: T.label, letterSpacing: 1.3 },
  mutedKicker: { color: C.muted },
  directionChip: { color: C.cyan, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1, marginRight: 10 },
  signalAge: { color: C.muted, fontFamily: F.mono, fontSize: T.label },
  targetBody: { padding: 14 },
  targetName: { color: C.orangeBright, fontFamily: F.displayBold, fontSize: 24, letterSpacing: 0.35 },
  awaitingName: { color: C.muted },
  signalState: { marginTop: 11 },
  signalNeutral: { color: C.text, fontFamily: F.displayBold, fontSize: 22 },
  signalStale: { color: C.amber, fontFamily: F.displayBold, fontSize: 22 },
  signalMasked: { color: C.cyan, fontFamily: F.displayBold, fontSize: 22 },
  signalAvailable: { marginTop: 10 },
  distanceRow: { flexDirection: 'row', alignItems: 'baseline' },
  bandWord: { flex: 1, color: C.orangeBright, fontFamily: F.displayBold, fontSize: 29 },
  distance: { color: C.text, fontFamily: F.monoSemiBold, fontSize: T.body },
  meterRow: { flexDirection: 'row', gap: 5, marginTop: 12 },
  meterItem: { flex: 1, alignItems: 'center' },
  meterBar: { width: '100%', height: 5, borderRadius: 3, backgroundColor: C.line },
  meterBarActive: { backgroundColor: C.orange },
  meterLabel: { color: C.muted, fontFamily: F.mono, fontSize: 10, marginTop: 5, textAlign: 'center' },
  meterLabelActive: { color: C.orangeBright, fontFamily: F.monoSemiBold },
  claimButton: { minHeight: S.touch, backgroundColor: C.orange, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, paddingHorizontal: 12, marginTop: 18 },
  disabledClaimButton: { minHeight: S.touch, backgroundColor: C.panel2, borderColor: C.line, borderWidth: 1, borderRadius: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 12, marginTop: 18 },
  disabledButtonText: { color: C.muted, fontFamily: F.displayBold, fontSize: T.button, letterSpacing: 0.7, textAlign: 'center' },
  claimCaption: { color: C.muted, fontFamily: F.mono, fontSize: T.micro, lineHeight: T.lineLabel, letterSpacing: 0.3, textAlign: 'center', marginTop: 8 },
  hunterWarning: { color: C.muted, fontFamily: F.mono, fontSize: T.micro, lineHeight: T.lineLabel, letterSpacing: 0.5, textAlign: 'center', marginTop: 13 },
  resultIcon: { width: 64, height: 64, borderRadius: 32, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  winnerIcon: { borderColor: C.cyan },
  otherIcon: { borderColor: C.lineStrong },
  resultIconText: { fontFamily: F.displayBold, fontSize: 26 },
  resultTitle: { color: C.text, fontFamily: F.displayBold, fontSize: 26, lineHeight: 31, textAlign: 'center' },
  winnerTitle: { color: C.cyan, fontSize: 30 },
  resultCopy: { color: C.muted, fontFamily: F.body, fontSize: T.bodyLarge, lineHeight: 22, textAlign: 'center', marginTop: 10 },
  targetInline: { color: C.orangeBright, fontFamily: F.bodySemiBold },
  resultChip: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 7, marginTop: 18 },
  winnerChip: { borderColor: C.cyanBorder },
  resultChipText: { color: C.muted, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1 },
  winnerChipText: { color: C.cyan },
  eliminatedIcon: { width: 64, height: 64, borderRadius: 32, borderColor: C.red, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  eliminatedIconText: { color: C.red, fontFamily: F.displayBold, fontSize: 24 },
  eliminatedTitle: { color: C.red, fontFamily: F.displayBold, fontSize: 30, letterSpacing: 1 },
  restoreNote: { color: C.muted, fontFamily: F.mono, fontSize: T.micro, letterSpacing: 0.8, marginTop: 17, textAlign: 'center' },
})
