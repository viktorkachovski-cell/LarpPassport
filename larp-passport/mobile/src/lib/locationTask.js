import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as Battery from 'expo-battery'
import * as Notifications from 'expo-notifications'
import * as SQLite from 'expo-sqlite'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { createPingStore } from './pingStore'

export const LOCATION_TASK = 'larp-passport-location'
const LEGACY_QUEUE_KEY = 'larp_ping_queue_v1' // pre-SQLite queue, imported once
const GAME_KEY = 'larp_active_game_v1'
const LAST_SENT_KEY = 'larp_last_sent_v1'
const SEQ_KEY = 'larp_last_event_seq_v1'
const PROFILE_KEY = 'larp_gps_profile_v1'

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

// One store per JS runtime. Android runs a single JS process for the app
// (foreground UI and the background location task never execute JS
// concurrently in separate processes), so the store's in-process drain lock
// plus SQLite transactions cover every enqueue/flush interleaving.
let storePromise = null
function getStore() {
  if (!storePromise) {
    storePromise = (async () => {
      const db = await SQLite.openDatabaseAsync('larp_pings.db')
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')
      const store = createPingStore({ db })
      await store.init()
      await migrateLegacyQueue(store)
      return store
    })()
  }
  return storePromise
}

// One-time import of the old AsyncStorage JSON queue so an app update does
// not drop points that were recorded but not yet sent.
async function migrateLegacyQueue(store) {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_QUEUE_KEY)
    if (raw == null) return
    const gameId = await AsyncStorage.getItem(GAME_KEY)
    const items = JSON.parse(raw)
    if (gameId && Array.isArray(items) && items.length > 0) {
      await store.enqueue(gameId, items)
    }
    await AsyncStorage.removeItem(LEGACY_QUEUE_KEY)
  } catch {
    try { await AsyncStorage.removeItem(LEGACY_QUEUE_KEY) } catch {}
  }
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
    const store = await getStore()
    await store.enqueue(gameId, pings)
    await flush(gameId)
  } catch {
    // never throw from the task — pings stay queued for the next tick
  }
})

// Sends queued points for the active game in claimed batches. The server
// evaluates the trail against zones, returns any events we haven't seen
// (piggyback — no websocket needed in the background), and a GPS profile hint
// we apply on the fly. Only one drain runs at a time; a second flush() call
// (e.g. "SEND NOW" during a background tick) joins the running drain, which
// keeps claiming batches until nothing is pending.
export async function flush(gameId) {
  if (!gameId) return { accepted: 0, queued: 0 }
  const store = await getStore()
  let profileMode = null
  const result = await store.drain({
    gameId,
    send: async (pings) => {
      const lastSeen = Number((await AsyncStorage.getItem(SEQ_KEY)) ?? 0)
      const { data, error } = await supabase.rpc('ingest_pings', {
        g: gameId, pings, last_seen_seq: lastSeen,
      })
      if (error) {
        const wrapped = new Error(error.message)
        wrapped.code = error.code
        throw wrapped
      }
      return data ?? { accepted: pings.length }
    },
    onBatch: async (data) => {
      await AsyncStorage.setItem(LAST_SENT_KEY, new Date().toISOString())
      if (Array.isArray(data?.events) && data.events.length > 0) await notifyEvents(data.events)
      if (data?.profile?.mode) profileMode = data.profile.mode
    },
  })
  if (result.reason) {
    // Server said no (game finished / consent revoked / removed from game):
    // nothing for this game stays on the device.
    await store.purgeGame(gameId)
    await handleRejected(result.reason)
    return { accepted: result.accepted, queued: 0, reason: result.reason }
  }
  if (profileMode) await applyProfile(profileMode)
  return result
}

const REJECT_MESSAGES = {
  game_finished: 'The game has finished, so location sharing stopped.',
  no_consent: 'Location consent is off for this game, so sharing stopped.',
  not_member: 'You are no longer a member of this game, so sharing stopped.',
}

// Server said no (game finished / consent revoked / removed from game):
// stop burning GPS and tell the player once, with the actual reason.
async function handleRejected(reason) {
  try {
    await stopSharing()
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Location sharing stopped',
        body: REJECT_MESSAGES[reason] ?? 'The game is not accepting location pings any more.',
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
      notificationColor: '#47D6F0',
      killServiceOnDestroy: false,
    },
  })
}

export async function queueStatus() {
  const store = await getStore()
  const gameId = await AsyncStorage.getItem(GAME_KEY)
  const s = await store.status(gameId ?? undefined)
  const last = await AsyncStorage.getItem(LAST_SENT_KEY)
  const profile = (await AsyncStorage.getItem(PROFILE_KEY)) ?? 'near'
  return {
    queued: s.queued,
    lastSent: last,
    profile,
    // new fields (sync-health surface, additive — nothing existing reads them)
    oldestPendingAt: s.oldestPendingAt,
    failed: s.failed,
    lastError: s.lastError,
  }
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

// Stopping sharing is a consent action: any point recorded for this game that
// has not reached the server yet is deleted, including in-flight rows (their
// nack is a no-op after the purge). Previously leftover points survived in
// AsyncStorage and could even be flushed into a DIFFERENT game joined later.
export async function stopSharing() {
  try {
    const gameId = await AsyncStorage.getItem(GAME_KEY)
    if (gameId) {
      const store = await getStore()
      await store.purgeGame(gameId)
    }
  } catch {}
  await AsyncStorage.removeItem(GAME_KEY)
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}

export async function isSharing() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
