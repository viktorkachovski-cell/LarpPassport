import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, View, Text, TextInput, TouchableOpacity, ScrollView, Switch } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { C } from '../lib/theme'
import { startSharing, stopSharing, isSharing, flush, queueStatus, notifyEvents, markSeenUpTo } from '../lib/locationTask'

const btn = (bg, fg = '#14110a') => ({
  backgroundColor: bg, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 16, alignItems: 'center',
})
const input = {
  backgroundColor: C.ink, borderColor: C.lineStrong, borderWidth: 1, borderRadius: 8,
  color: C.text, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15,
}

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function GameScreen({ gameId, session, onBack }) {
  const uid = session.user.id
  const [game, setGame] = useState(null)
  const [character, setCharacter] = useState(undefined) // undefined = loading, null = none yet
  const [events, setEvents] = useState([])
  const [tab, setTab] = useState('hunt')
  const [sharing, setSharing] = useState(false)
  const [member, setMember] = useState(null)
  const [hunt, setHunt] = useState(null)
  const [huntBusy, setHuntBusy] = useState(false)
  const [huntError, setHuntError] = useState('')
  const [queue, setQueue] = useState({ queued: 0, lastSent: null })
  const [error, setError] = useState('')
  const seenEvents = useRef(new Set())

  const stats = game?.template?.stats ?? []

  const loadHunt = useCallback(async () => {
    const { data, error: huntLoadError } = await supabase.rpc('get_hunt_status', { g: gameId })
    if (huntLoadError) {
      setHuntError(huntLoadError.message)
      return null
    }
    setHunt(data)
    setHuntError('')
    return data
  }, [gameId])

  useEffect(() => {
    let alive = true
    async function load() {
      const [g, ch, ev, mem] = await Promise.all([
        supabase.from('games').select('*').eq('id', gameId).single(),
        supabase.from('characters').select('*').eq('game_id', gameId).eq('user_id', uid).eq('is_npc', false).maybeSingle(),
        supabase.from('game_events').select('*').eq('game_id', gameId).order('seq', { ascending: false }).limit(50),
        supabase.from('game_players').select('*').eq('game_id', gameId).eq('profile_id', uid).maybeSingle(),
      ])
      if (!alive) return
      setGame(g.data ?? null)
      setCharacter(ch.data ?? null)
      setEvents(ev.data ?? [])
      let maxSeq = 0
      for (const e of ev.data ?? []) {
        seenEvents.current.add(e.id)
        if (e.player_visible && e.profile_id === uid && e.seq > maxSeq) maxSeq = e.seq
      }
      if (maxSeq > 0) markSeenUpTo(maxSeq)
      setMember(mem.data ?? null)
    }
    load()
    loadHunt()
    isSharing().then(setSharing)
    queueStatus().then(setQueue)
    Notifications.requestPermissionsAsync().catch(() => {})

    const ch = supabase
      .channel(`m-game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'characters', filter: `game_id=eq.${gameId}` }, (p) => {
        if (p.new?.user_id === uid && !p.new?.is_npc) setCharacter(p.new)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_events', filter: `game_id=eq.${gameId}` }, (p) => {
        const row = p.new
        if (!row?.id) return
        setEvents((prev) => {
          const i = prev.findIndex((e) => e.id === row.id)
          if (i === -1) return [row, ...prev].slice(0, 100)
          const next = [...prev]; next[i] = row; return next
        })
        seenEvents.current.add(row.id)
        if (row.player_visible && row.profile_id === uid && row.type !== 'player_message') notifyEvents([row])
        if (row.profile_id === uid && (
          row.type?.startsWith('hunt_')
          || row.type?.startsWith('elimination_')
          || row.type === 'eliminated'
          || row.type === 'zone_boundary_exit'
        )) loadHunt()
      })
      .subscribe()

    const interval = setInterval(() => {
      queueStatus().then(setQueue)
      isSharing().then(setSharing)
      loadHunt()
    }, 15000)
    return () => { alive = false; clearInterval(interval); supabase.removeChannel(ch) }
  }, [gameId, uid, loadHunt])

  useEffect(() => {
    if (!hunt?.participant || hunt.alive || !sharing) return
    stopSharing().then(() => setSharing(false)).catch(() => {})
  }, [hunt?.alive, hunt?.participant, sharing])

  async function toggleSharing(next) {
    setError('')
    try {
      if (next) {
        await supabase.rpc('set_location_consent', { g: gameId, grant_consent: true })
        try {
          await startSharing(gameId)
        } catch (permErr) {
          await supabase.rpc('set_location_consent', { g: gameId, grant_consent: false })
          throw permErr
        }
        setSharing(true)
      } else {
        await stopSharing()
        await supabase.rpc('set_location_consent', { g: gameId, grant_consent: false })
        setSharing(false)
      }
    } catch (e) { setError(e.message) }
  }

  async function sendNow() {
    setError('')
    const res = await flush(gameId)
    if (res?.error) setError(`Send failed: ${res.error}`)
    queueStatus().then(setQueue)
  }

  async function requestElimination() {
    setHuntBusy(true); setHuntError('')
    const { error: claimError } = await supabase.rpc('request_elimination', { g: gameId })
    setHuntBusy(false)
    if (claimError) { setHuntError(claimError.message); return }
    await loadHunt()
  }

  function confirmEliminationRequest() {
    Alert.alert(
      'Confirm elimination?',
      'Only confirm after the live mock battle has been resolved.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request confirmation', onPress: requestElimination },
      ],
    )
  }

  async function respondToElimination(confirmed) {
    if (!hunt?.incoming_claim?.id) return
    setHuntBusy(true); setHuntError('')
    const { data, error: responseError } = await supabase.rpc('respond_elimination', {
      claim_id: hunt.incoming_claim.id,
      confirm_elimination: confirmed,
    })
    setHuntBusy(false)
    if (responseError) { setHuntError(responseError.message); return }
    setHunt(data)
  }

  const visibleEvents = events.filter((e) => e.player_visible && e.profile_id === uid)

  if (!game || character === undefined) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.muted }}>Loading…</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomColor: C.line, borderBottomWidth: 1 }}>
        <TouchableOpacity onPress={onBack} style={{ paddingRight: 12 }}>
          <Text style={{ color: C.muted, fontSize: 18 }}>←</Text>
        </TouchableOpacity>
        <Text style={{ color: C.brass, fontSize: 18, fontFamily: 'serif', letterSpacing: 1, flex: 1 }} numberOfLines={1}>{game.name}</Text>
        <Text style={{ color: game.status === 'active' ? C.moss : C.muted, fontSize: 12 }}>{game.status}</Text>
      </View>

      <View style={{ flexDirection: 'row', borderBottomColor: C.line, borderBottomWidth: 1 }}>
        {[['hunt', 'Hunt'], ['sheet', 'Character'], ['events', 'Events'], ['share', 'Sharing']].map(([k, label]) => (
          <TouchableOpacity key={k} onPress={() => setTab(k)}
            style={{ flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: tab === k ? C.brass : 'transparent' }}>
            <Text style={{ color: tab === k ? C.text : C.muted }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'hunt' && (
        <HuntPanel
          hunt={hunt}
          hasCharacter={character !== null}
          busy={huntBusy}
          error={huntError}
          requestElimination={confirmEliminationRequest}
          respondToElimination={respondToElimination}
          refresh={loadHunt}
        />
      )}

      {tab === 'sheet' && (
        character === null
          ? <CreateCharacter game={game} uid={uid} onCreated={setCharacter} />
          : <Sheet character={character} stats={stats} />
      )}

      {tab === 'events' && (
        <ScrollView style={{ flex: 1, padding: 16 }}>
          <PlayerMessageBox gameId={gameId} />
          {visibleEvents.length === 0 && <Text style={{ color: C.muted, textAlign: 'center', marginTop: 30 }}>Nothing yet. Stay alert.</Text>}
          {visibleEvents.map((e) => (
            <View key={e.id} style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderLeftColor: C.brass, borderLeftWidth: 3, borderRadius: 8, padding: 12, marginBottom: 10 }}>
              <Text style={{ color: C.text, fontWeight: '600' }}>
                {eventTitle(e.type)}
              </Text>
              {!!e.payload?.message && <Text style={{ color: C.text, marginTop: 4 }}>{e.payload.message}</Text>}
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>{timeAgo(e.created_at)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {tab === 'share' && (
        <ScrollView style={{ flex: 1, padding: 16 }}>
          <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 16 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '600' }}>Share my location</Text>
              <Switch value={sharing} onValueChange={toggleSharing} trackColor={{ true: C.brassDim, false: C.lineStrong }} thumbColor={sharing ? C.brass : C.muted} />
            </View>
            <Text style={{ color: C.muted, marginTop: 10, lineHeight: 19 }}>
              While this is on, your phone sends its GPS position roughly every 15 seconds — including with the screen off — and your game masters see it on their map.
              A permanent notification is shown the whole time, so you always know sharing is active.
              Position history is deleted automatically {game.purge_after_days} day{game.purge_after_days === 1 ? '' : 's'} after it's recorded. You can stop any time with this switch.
            </Text>
            {game.status !== 'active' && (
              <Text style={{ color: C.brass, marginTop: 10 }}>The game isn't active yet — pings are only accepted while the GM has set the game to active.</Text>
            )}
            {!!error && <Text style={{ color: C.wax, marginTop: 10 }}>{error}</Text>}
          </View>

          {sharing && (
            <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 16, marginTop: 12 }}>
              <Text style={{ color: C.muted }}>Queued on device: <Text style={{ color: C.text }}>{queue.queued}</Text></Text>
              <Text style={{ color: C.muted, marginTop: 4 }}>Last sent: <Text style={{ color: C.text }}>{timeAgo(queue.lastSent)}</Text></Text>
              <Text style={{ color: C.muted, marginTop: 4 }}>GPS mode: <Text style={{ color: C.text }}>{queue.profile === 'far' ? 'relaxed — saving battery' : 'precise'}</Text></Text>
              <TouchableOpacity onPress={sendNow} style={[btn(C.panel2), { borderColor: C.lineStrong, borderWidth: 1, marginTop: 12 }]}>
                <Text style={{ color: C.text }}>Send now</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function eventTitle(type) {
  if (type === 'gm_note') return 'Message from your GM'
  if (type === 'consent_granted') return 'You started sharing your location'
  if (type === 'consent_revoked') return 'You stopped sharing your location'
  if (type === 'hunt_started') return 'The hunt has begun'
  if (type === 'elimination_requested') return 'Elimination confirmation requested'
  if (type === 'elimination_claimed') return 'Waiting for your target to confirm'
  if (type === 'elimination_rejected') return 'Elimination was rejected'
  if (type === 'elimination_confirmed') return 'Elimination confirmed - target updated'
  if (type === 'eliminated') return 'You have been eliminated'
  if (type === 'hunt_finished') return 'The hunt is over'
  if (type === 'hunt_player_restored') return 'The GM restored a traveller'
  if (type === 'hunt_chain_changed') return 'The GM corrected the target chain'
  if (type === 'hunt_target_assigned') return 'The GM assigned your next target'
  if (type === 'player_message') return 'Message sent to your GM'
  if (type === 'zone_boundary_warning') return 'You are nearing the anomaly boundary'
  if (type === 'zone_boundary_exit') return 'You left the time anomaly'
  return 'Something happens'
}

function PlayerMessageBox({ gameId }) {
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const clean = message.trim()
    if (!clean) return
    setBusy(true); setStatus('')
    const { error } = await supabase.rpc('send_gm_message', { g: gameId, message: clean })
    setBusy(false)
    if (error) { setStatus(error.message); return }
    setMessage('')
    setStatus('Sent to the GM.')
  }

  return (
    <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 14 }}>
      <Text style={{ color: C.text, fontWeight: '700' }}>Message the GM</Text>
      <TextInput
        style={[input, { marginTop: 8 }]}
        value={message}
        onChangeText={setMessage}
        maxLength={100}
        placeholder="Short in-game message"
        placeholderTextColor={C.lineStrong}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
        <Text style={{ color: C.muted, fontSize: 12 }}>{message.length}/100</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity disabled={busy || !message.trim()} onPress={send} style={[btn(C.brass), { opacity: busy || !message.trim() ? 0.55 : 1, paddingVertical: 8, paddingHorizontal: 14 }]}>
          <Text style={{ color: '#14110a', fontWeight: '700' }}>{busy ? 'Sending...' : 'Send'}</Text>
        </TouchableOpacity>
      </View>
      {!!status && <Text style={{ color: status === 'Sent to the GM.' ? C.moss : C.wax, marginTop: 8 }}>{status}</Text>}
    </View>
  )
}

function remainingMinutes(timestamp) {
  if (!timestamp) return 0
  return Math.max(0, Math.ceil((new Date(timestamp).getTime() - Date.now()) / 60000))
}

function proximityText(proximity) {
  if (!proximity) return 'Waiting for a target signal.'
  if (proximity.state === 'cloaked') {
    return `Target signal is masked for about ${remainingMinutes(proximity.available_at)} minute(s).`
  }
  if (proximity.state === 'waiting_for_location') return 'Waiting for both devices to report location.'
  if (proximity.state === 'stale') return 'Target signal is stale. Keep moving and try again.'
  if (proximity.state === 'available') {
    return `${proximity.band} - approximately ${proximity.distance_m} m away`
  }
  return 'Target signal unavailable.'
}

function HuntPanel({ hunt, hasCharacter, busy, error, requestElimination, respondToElimination, refresh }) {
  function confirmDefeat() {
    Alert.alert(
      'Confirm your elimination?',
      'This removes you from the hunt and cannot be undone by a player.',
      [
        { text: 'Not confirmed', style: 'cancel', onPress: () => respondToElimination(false) },
        { text: 'Confirm elimination', style: 'destructive', onPress: () => respondToElimination(true) },
      ],
    )
  }

  if (!hunt) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: error ? C.wax : C.muted }}>{error || 'Loading hunt status...'}</Text>
        {!!error && (
          <TouchableOpacity onPress={refresh} style={[btn(C.panel2), { borderColor: C.lineStrong, borderWidth: 1, marginTop: 14 }]}>
            <Text style={{ color: C.text }}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    )
  }

  if (hunt.phase === 'not_started') {
    return (
      <ScrollView style={{ flex: 1, padding: 16 }}>
        <View style={{ backgroundColor: C.panel, borderColor: C.line, borderWidth: 1, borderRadius: 12, padding: 18 }}>
          <Text style={{ color: C.brass, fontFamily: 'serif', fontSize: 22 }}>Awaiting the hunt</Text>
          <Text style={{ color: C.muted, marginTop: 8, lineHeight: 19 }}>
            The GM will lock the player roster and assign one secret target to every traveller.
          </Text>
          {!hasCharacter && <Text style={{ color: C.wax, marginTop: 10 }}>Create your character before the hunt can start.</Text>}
          {!!error && <Text style={{ color: C.wax, marginTop: 10 }}>{error}</Text>}
          <TouchableOpacity onPress={refresh} style={[btn(C.panel2), { borderColor: C.lineStrong, borderWidth: 1, marginTop: 14 }]}>
            <Text style={{ color: C.text }}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    )
  }

  if (!hunt.participant) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.muted, textAlign: 'center' }}>You are observing this hunt and have no target assignment.</Text>
      </View>
    )
  }

  if (hunt.phase === 'finished') {
    const won = hunt.winner?.is_self
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: won ? C.brass : C.text, fontFamily: 'serif', fontSize: 30, textAlign: 'center' }}>
          {won ? 'Timeline secured' : 'The timeline belongs to another'}
        </Text>
        <Text style={{ color: C.muted, marginTop: 10, textAlign: 'center' }}>
          {hunt.winner?.character_name ?? 'The final traveller'} is the last player standing.
        </Text>
      </View>
    )
  }

  if (!hunt.alive) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: C.wax, fontFamily: 'serif', fontSize: 28 }}>Eliminated</Text>
        <Text style={{ color: C.muted, marginTop: 10, textAlign: 'center' }}>
          Your location sharing has stopped. You can watch the remaining count, but no target is revealed.
        </Text>
        <Text style={{ color: C.text, marginTop: 16 }}>{hunt.alive_count} traveller(s) remain</Text>
      </View>
    )
  }

  const cloakMinutes = remainingMinutes(hunt.hidden_until)
  const pending = hunt.incoming_claim
  const awaitingTarget = !hunt.target

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      {pending && (
        <View style={{ backgroundColor: C.panel, borderColor: C.wax, borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <Text style={{ color: C.wax, fontSize: 18, fontWeight: '700' }}>Elimination claimed</Text>
          <Text style={{ color: C.muted, marginTop: 7, lineHeight: 19 }}>
            Confirm only if the live mock battle was completed. The hunter remains anonymous in the app.
          </Text>
          <TouchableOpacity disabled={busy} onPress={confirmDefeat} style={[btn(C.wax, C.text), { marginTop: 12, opacity: busy ? 0.6 : 1 }]}>
            <Text style={{ color: C.text, fontWeight: '700' }}>Review confirmation</Text>
          </TouchableOpacity>
        </View>
      )}

      {cloakMinutes > 0 && (
        <View style={{ backgroundColor: C.panel, borderColor: C.moss, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 12 }}>
          <Text style={{ color: C.moss, fontWeight: '700' }}>Temporal cloak active</Text>
          <Text style={{ color: C.muted, marginTop: 4 }}>Your hunter cannot read your proximity for about {cloakMinutes} minute(s).</Text>
        </View>
      )}

      <View style={{ backgroundColor: C.panel, borderColor: C.brassDim, borderWidth: 1, borderRadius: 12, padding: 18 }}>
        <Text style={{ color: C.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Your target</Text>
        <Text style={{ color: C.brass, fontFamily: 'serif', fontSize: 28, marginTop: 5 }}>{hunt.target?.character_name ?? 'Signal pending'}</Text>
        <Text style={{ color: C.text, fontSize: 17, marginTop: 14 }}>
          {awaitingTarget ? 'Waiting for the GM to assign your next target.' : proximityText(hunt.target?.proximity)}
        </Text>
        <Text style={{ color: C.muted, marginTop: 8 }}>{hunt.alive_count} traveller(s) remain</Text>
        <TouchableOpacity
          disabled={busy || !!hunt.outgoing_claim || awaitingTarget}
          onPress={requestElimination}
          style={[btn(C.brass), { marginTop: 18, opacity: busy || hunt.outgoing_claim || awaitingTarget ? 0.55 : 1 }]}
        >
          <Text style={{ color: '#14110a', fontWeight: '700' }}>
            {awaitingTarget ? 'Awaiting GM assignment' : hunt.outgoing_claim ? 'Waiting for target confirmation' : 'Claim elimination'}
          </Text>
        </TouchableOpacity>
        {!!error && <Text style={{ color: C.wax, marginTop: 10 }}>{error}</Text>}
      </View>
    </ScrollView>
  )
}

function Sheet({ character, stats }) {
  const [draft, setDraft] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const fields = character.fields ?? {}
  const editable = stats.filter((s) => s.player_editable)
  const locked = stats.filter((s) => !s.player_editable)

  const d = draft ?? {}
  const valueOf = (key) => (key in d ? d[key] : fields[key])
  const dirty = draft && Object.keys(d).some((k) => String(d[k]) !== String(fields[k] ?? ''))

  async function save() {
    setError(''); setSaved(false)
    const next = { ...fields }
    for (const s of editable) {
      if (!(s.key in d)) continue
      next[s.key] = s.type === 'number' ? Number(d[s.key]) : String(d[s.key] ?? '')
      if (s.type === 'number' && !Number.isFinite(next[s.key])) next[s.key] = s.default ?? 0
    }
    const { error } = await supabase.from('characters').update({ fields: next }).eq('id', character.id)
    if (error) { setError(error.message); return }
    setDraft(null); setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ color: C.text, fontSize: 26, fontFamily: 'serif', letterSpacing: 1 }}>{character.name}</Text>
      {!!character.bio && <Text style={{ color: C.muted, marginTop: 4, marginBottom: 6 }}>{character.bio}</Text>}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {locked.map((s) => (
          <View key={s.key} style={{ backgroundColor: C.panel, borderColor: C.brassDim, borderWidth: 1, borderRadius: 12, padding: 14, minWidth: 100, alignItems: 'center' }}>
            <Text style={{ color: C.brass, fontSize: 28, fontWeight: '700' }}>{String(fields[s.key] ?? '—')}</Text>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{s.label || s.key}</Text>
          </View>
        ))}
      </View>
      {locked.length > 0 && <Text style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>These are set by your game masters and update live.</Text>}

      {editable.length > 0 && (
        <View style={{ marginTop: 22 }}>
          <Text style={{ color: C.muted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Yours to edit</Text>
          {editable.map((s) => (
            <View key={s.key} style={{ marginBottom: 12 }}>
              <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{s.label || s.key}{s.type === 'number' && s.min !== undefined && s.max !== undefined ? `  (${s.min}–${s.max})` : ''}</Text>
              <TextInput
                style={input}
                keyboardType={s.type === 'number' ? 'numeric' : 'default'}
                value={String(valueOf(s.key) ?? '')}
                onChangeText={(v) => setDraft({ ...(draft ?? {}), [s.key]: v })}
              />
            </View>
          ))}
          <TouchableOpacity disabled={!dirty} onPress={save} style={[btn(C.brass), { opacity: dirty ? 1 : 0.45 }]}>
            <Text style={{ color: '#14110a', fontWeight: '700' }}>Save changes</Text>
          </TouchableOpacity>
          {!!error && <Text style={{ color: C.wax, marginTop: 8 }}>{error}</Text>}
          {saved && <Text style={{ color: C.moss, marginTop: 8 }}>Saved</Text>}
        </View>
      )}
    </ScrollView>
  )
}

function CreateCharacter({ game, uid, onCreated }) {
  const stats = game.template?.stats ?? []
  const editable = stats.filter((s) => s.player_editable)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [vals, setVals] = useState(() => Object.fromEntries(editable.map((s) => [s.key, s.default ?? (s.type === 'number' ? 0 : '')])))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) { setError('Your character needs a name.'); return }
    setBusy(true); setError('')
    const fields = {}
    for (const s of editable) {
      fields[s.key] = s.type === 'number' ? Number(vals[s.key]) || 0 : String(vals[s.key] ?? '')
    }
    const { data, error } = await supabase.from('characters')
      .insert({ game_id: game.id, user_id: uid, name: name.trim(), bio: bio.trim(), fields })
      .select().single()
    setBusy(false)
    if (error) { setError(error.message); return }
    onCreated(data)
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ color: C.text, fontSize: 20, fontFamily: 'serif' }}>Create your character</Text>
      <Text style={{ color: C.muted, marginTop: 4, marginBottom: 16 }}>This is who you'll be in {game.name}.</Text>
      <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>Name</Text>
      <TextInput style={[input, { marginBottom: 12 }]} value={name} onChangeText={setName} placeholder="Yavor the Unbowed" placeholderTextColor={C.lineStrong} />
      <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>Bio</Text>
      <TextInput style={[input, { marginBottom: 12, minHeight: 70 }]} value={bio} onChangeText={setBio} multiline placeholder="A few lines about them" placeholderTextColor={C.lineStrong} />
      {editable.map((s) => (
        <View key={s.key} style={{ marginBottom: 12 }}>
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 4 }}>{s.label || s.key}</Text>
          <TextInput style={input} keyboardType={s.type === 'number' ? 'numeric' : 'default'}
            value={String(vals[s.key] ?? '')} onChangeText={(v) => setVals({ ...vals, [s.key]: v })} />
        </View>
      ))}
      <TouchableOpacity disabled={busy} onPress={create} style={[btn(C.brass), { opacity: busy ? 0.6 : 1, marginTop: 6 }]}>
        <Text style={{ color: '#14110a', fontWeight: '700' }}>Create character</Text>
      </TouchableOpacity>
      {!!error && <Text style={{ color: C.wax, marginTop: 8 }}>{error}</Text>}
      <Text style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>Stats your GM controls are added automatically with their starting values.</Text>
    </ScrollView>
  )
}
