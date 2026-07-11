import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as Battery from 'expo-battery'
import * as Notifications from 'expo-notifications'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

export const LOCATION_TASK = 'larp-passport-location'
const QUEUE_KEY = 'larp_ping_queue_v1'
const GAME_KEY = 'larp_active_game_v1'
const LAST_SENT_KEY = 'larp_last_sent_v1'
const SEQ_KEY = 'larp_last_event_seq_v1'
const PROFILE_KEY = 'larp_gps_profile_v1'
const MAX_QUEUE = 500

// Server-hinted GPS profiles. 'near' = close to an active zone: precise + frequent.
// 'far' = nothing nearby: coarse positioning, GPS chip mostly asleep, radio wakes ~1/min.
export const GPS_PROFILES = {
  near: { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 5 },
  far: {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 30000,
    distanceInterval: 20,
    deferredUpdatesInterval: 90000,
  },
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return
  try {
    const gameId = await AsyncStorage.getItem(GAME_KEY)
    if (!gameId) return
    let battery = null
    try { battery = Math.round((await Battery.getBatteryLevelAsync()) * 100) } catch {}
    const pings = (data.locations ?? []).map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy,
      recorded_at: new Date(l.timestamp).toISOString(),
      ...(battery != null && battery >= 0 ? { battery } : {}),
    }))
    if (pings.length === 0) return
    await enqueue(pings)
    await flush(gameId)
  } catch {
    // never throw from the task — pings stay queued for the next tick
  }
})

async function readQueue() {
  try { return JSON.parse((await AsyncStorage.getItem(QUEUE_KEY)) ?? '[]') } catch { return [] }
}

async function enqueue(pings) {
  const cur = await readQueue()
  const next = [...cur, ...pings].slice(-MAX_QUEUE)
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next))
}

// Sends the queue. The server evaluates the WHOLE trail against zones, returns any
// events we haven't seen (piggyback — no websocket needed in the background), and a
// GPS profile hint we apply on the fly.
export async function flush(gameId) {
  const cur = await readQueue()
  if (cur.length === 0) return { accepted: 0, queued: 0 }
  const lastSeen = Number((await AsyncStorage.getItem(SEQ_KEY)) ?? 0)
  const { data, error } = await supabase.rpc('ingest_pings', {
    g: gameId, pings: cur, last_seen_seq: lastSeen,
  })
  if (error) return { accepted: 0, queued: cur.length, error: error.message }
  await AsyncStorage.setItem(QUEUE_KEY, '[]')
  await AsyncStorage.setItem(LAST_SENT_KEY, new Date().toISOString())
  if (data?.reason) {
    await handleRejected()
    return { ...data, queued: 0 }
  }
  if (Array.isArray(data?.events) && data.events.length > 0) await notifyEvents(data.events)
  if (data?.profile?.mode) await applyProfile(data.profile.mode)
  return { ...(data ?? { accepted: 0 }), queued: 0 }
}

// Server said no (game ended / consent revoked / removed from game):
// stop burning GPS and tell the player once.
async function handleRejected() {
  try {
    await stopSharing()
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Location sharing stopped',
        body: 'The game is not active any more, or your consent was withdrawn.',
      },
      trigger: null,
    })
  } catch {}
}

// Single notification gate for BOTH delivery paths (realtime + ping piggyback):
// strictly increasing seq stored on device prevents duplicates.
export async function notifyEvents(events) {
  try {
    let last = Number((await AsyncStorage.getItem(SEQ_KEY)) ?? 0)
    const sorted = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
    for (const e of sorted) {
      if (!e || typeof e.seq !== 'number' || e.seq <= last) continue
      last = e.seq
      const title = notificationTitle(e.type)
      await Notifications.scheduleNotificationAsync({
        content: { title, body: e.payload?.message ?? 'Check your passport.' },
        trigger: null,
      })
    }
    await AsyncStorage.setItem(SEQ_KEY, String(last))
  } catch {}
}

export async function markSeenUpTo(seq) {
  try {
    const last = Number((await AsyncStorage.getItem(SEQ_KEY)) ?? 0)
    if (typeof seq === 'number' && seq > last) await AsyncStorage.setItem(SEQ_KEY, String(seq))
  } catch {}
}

function notificationTitle(type) {
  if (type === 'gm_note') return 'Message from your GM'
  if (type === 'hunt_started') return 'The hunt has begun'
  if (type === 'elimination_requested') return 'Confirm an elimination'
  if (type === 'elimination_claimed') return 'Elimination claim sent'
  if (type === 'elimination_rejected') return 'Elimination rejected'
  if (type === 'elimination_confirmed') return 'Target eliminated'
  if (type === 'eliminated') return 'You have been eliminated'
  if (type === 'hunt_finished') return 'The hunt is over'
  if (type === 'hunt_player_restored') return 'Traveller restored'
  if (type === 'hunt_chain_changed') return 'Target chain corrected'
  if (type === 'hunt_target_assigned') return 'New target assigned'
  if (type === 'zone_boundary_warning') return 'Time anomaly boundary warning'
  if (type === 'zone_boundary_exit') return 'You left the time anomaly'
  if (type === 'player_message') return 'Message sent to GM'
  return 'New passport event'
}

async function applyProfile(mode) {
  const cur = (await AsyncStorage.getItem(PROFILE_KEY)) ?? 'near'
  if (mode === cur || !GPS_PROFILES[mode]) return
  await AsyncStorage.setItem(PROFILE_KEY, mode)
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (!started) return
  try {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK)
    await startUpdates(mode)
  } catch {}
}

async function startUpdates(mode) {
  const p = GPS_PROFILES[mode] ?? GPS_PROFILES.near
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    ...p,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'LARP Passport is sharing your location',
      notificationBody: 'Your game masters can see where you are. Stop sharing any time in the app.',
      notificationColor: '#c9a227',
      killServiceOnDestroy: false,
    },
  })
}

export async function queueStatus() {
  const q = await readQueue()
  const last = await AsyncStorage.getItem(LAST_SENT_KEY)
  const profile = (await AsyncStorage.getItem(PROFILE_KEY)) ?? 'near'
  return { queued: q.length, lastSent: last, profile }
}

export async function startSharing(gameId) {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') throw new Error('Location permission was denied.')
  const bg = await Location.requestBackgroundPermissionsAsync()
  if (bg.status !== 'granted') {
    throw new Error('Background location was denied. Choose "Allow all the time" in system settings so tracking works with the screen off.')
  }
  await AsyncStorage.setItem(GAME_KEY, gameId)
  await AsyncStorage.setItem(PROFILE_KEY, 'near')
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) return
  await startUpdates('near')
}

export async function stopSharing() {
  await AsyncStorage.removeItem(GAME_KEY)
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}

export async function isSharing() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
