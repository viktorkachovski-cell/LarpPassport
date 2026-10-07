import { memo, useState } from 'react'
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { supabase } from '../../lib/supabase'
import { C, F, S, T } from '../../lib/theme'
import { eventInfo } from '../../lib/events'
import { formatAge } from '../../lib/time'
import { common } from '../../ui/common'
import { OutcomeNote } from '../../ui/primitives'

export const EventsTab = memo(function EventsTab({ gameId, events }) {
  return (
    <ScrollView style={common.flex} contentContainerStyle={common.scrollContent} keyboardShouldPersistTaps="handled">
      <PlayerMessageBox gameId={gameId} />
      {events.length === 0 && <Text style={styles.emptyText}>No events yet.</Text>}
      {events.map((event) => {
        const { tag, title, body } = eventInfo(event.type)
        const message = event.payload?.message || body
        return (
          <View key={event.id} style={[styles.eventCard, tag.borderColor && { borderColor: tag.borderColor }]}>
            <View style={styles.eventTopRow}>
              <Text style={[styles.eventTag, { color: tag.color }]}>{tag.label}</Text>
              <Text style={styles.eventTime}>{formatAge(event.created_at) ?? '--'}</Text>
            </View>
            <Text style={[styles.eventTitle, tag.titleColor && { color: tag.titleColor }]}>{title}</Text>
            {!!message && <Text style={styles.eventBody}>{message}</Text>}
          </View>
        )
      })}
    </ScrollView>
  )
})

function PlayerMessageBox({ gameId }) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const clean = message.trim()
    if (!clean) return
    setBusy(true); setStatus('')
    try {
    const { error } = await supabase.rpc('send_gm_message', { g: gameId, message: clean })
    setBusy(false)
    if (error) { setStatus(error.message); return }
    setMessage('')
    setStatus('Sent to the GM.')
    } catch (error) { setStatus(error.message) } finally { setBusy(false) }
  }

  const sendDisabled = busy || !message.trim()
  return (
    <View style={styles.messageCard}>
      <Text style={styles.messageTitle}>Message GM</Text>
      <TextInput
        style={[common.input, styles.messageInput]}
        accessibilityLabel="Message to the GM"
        value={message}
        onChangeText={setMessage}
        maxLength={100}
        placeholder="Short in-game message"
        placeholderTextColor={C.muted}
      />
      <View style={styles.messageFooter}>
        <Text style={styles.charCount}>{message.length}/100</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: sendDisabled }} disabled={sendDisabled} onPress={send} style={[styles.smallCyanButton, sendDisabled && common.disabled]}>
          <Text style={styles.smallCyanButtonText}>{busy ? 'SENDING...' : 'SEND TO GM'}</Text>
        </TouchableOpacity>
      </View>
      <Text style={common.privateCaption}>ONLY YOU AND THE GMS SEE THIS // 3s COOLDOWN</Text>
      {!!status && <OutcomeNote text={status} tone={status === 'Sent to the GM.' ? 'ok' : 'error'} onDismiss={() => setStatus('')} />}
    </View>
  )
}

const styles = StyleSheet.create({
  messageCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 13, marginBottom: 13 },
  messageTitle: { color: C.text, fontFamily: F.bodyBold, fontSize: T.bodyLarge },
  messageInput: { marginTop: 9 },
  messageFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  charCount: { flex: 1, color: C.muted, fontFamily: F.mono, fontSize: T.label },
  smallCyanButton: { minHeight: S.touch, justifyContent: 'center', backgroundColor: C.cyan, borderRadius: 5, paddingHorizontal: 17, paddingVertical: 8 },
  smallCyanButtonText: { color: C.ink, fontFamily: F.displayBold, fontSize: T.button, letterSpacing: 0.8 },
  eventCard: { backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 9 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center' },
  eventTag: { flex: 1, fontFamily: F.monoSemiBold, fontSize: T.micro, letterSpacing: 1.1 },
  eventTime: { color: C.muted, fontFamily: F.mono, fontSize: T.label },
  eventTitle: { color: C.text, fontFamily: F.bodySemiBold, fontSize: T.bodyLarge, lineHeight: 21, marginTop: 7 },
  eventBody: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, marginTop: 4 },
  emptyText: { color: C.muted, fontFamily: F.body, fontSize: T.body, lineHeight: T.lineBody, textAlign: 'center', marginVertical: 28 },
})
