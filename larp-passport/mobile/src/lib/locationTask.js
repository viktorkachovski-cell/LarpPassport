import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import * as Battery from 'expo-battery'
import * as Notifications from 'expo-notifications'
import * as SQLite from 'expo-sqlite'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'
import { createPingStore } from './pingStore'
import { createTrackingSession } from './trackingSession'
import { createEventDelivery } from './eventDelivery'

export const LOCATION_TASK = 'larp-passport-location'
const OWNER_KEY = 'larp_tracking_owner_v2'
const scopeOf = (owner) => `${owner.userId}:${owner.gameId}:${owner.id}`
const session = async () => {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}
const tracking = createTrackingSession({
  storage: AsyncStorage, key: OWNER_KEY,
  currentUser: async () => (await session())?.user.id,
  start: startUpdates,
  stop: async () => {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK)
    }
  },
  purge: async (owner) => (await getStore()).purgeGame(scopeOf(owner)),
})
export const reconcileTracking = () => tracking.reconcile()
const delivery = createEventDelivery({
  storage: AsyncStorage,
  isCurrent: async (scope) => scope.split(':')[0] === (await session())?.user.id,
  fetchPage: async (scope, cursor) => {
    const auth = await session()
    if (auth?.user.id !== scope.split(':')[0]) return []
    const { data, error } = await supabase.rpc('get_player_event_delivery', {
      g: scope.split(':')[1], after_seq: cursor,
    }).setHeader('Authorization', `Bearer ${auth.access_token}`)
    if (error) throw error
    return data ?? []
  },
  notify: (event) => Notifications.scheduleNotificationAsync({
    identifier: `larp-${event.id}-${event.delivery_seq}`,
    content: { title: notificationTitle(event.type), body: event.payload?.message ?? 'Check your passport.' },
    trigger: null,
  }),
})
export async function syncNotifications(gameId) {
  const auth = await session()
  if (auth && gameId) await delivery.sync(`${auth.user.id}:${gameId}`)
}

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
      const db = await SQLite.openDatabaseAsync('larp_owned_pings_v2.db')
      await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;')
      const store = createPingStore({ db })
      await store.init()
      // Unowned legacy points cannot safely be attributed to the signed-in account.
      await AsyncStorage.removeItem('larp_ping_queue_v1')
      await SQLite.deleteDatabaseAsync('larp_pings.db').catch(() => {})
      return store
    })().catch((error) => { storePromise = null; throw error })
  }
  return storePromise
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return
  try {
    const owner = await tracking.read()
    if (!owner || !await tracking.current(owner)) { await tracking.reconcile(); return }
    let battery = null
    try { battery = Math.round((await Battery.getBatteryLevelAsync()) * 100) } catch {}
    const pings = (data.locations ?? []).filter((l) => l.timestamp >= owner.startedAt).map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy,
      recorded_at: new Date(l.timestamp).toISOString(),
      ...(battery != null && battery >= 0 ? { battery } : {}),
    }))
    if (pings.length === 0) return
    const store = await getStore()
    if (!await tracking.current(owner)) return
    await store.enqueue(scopeOf(owner), pings)
    if (!await tracking.current(owner)) { await store.purgeGame(scopeOf(owner)); return }
    await flush(owner.gameId)
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
  const owner = await tracking.read()
  if (!owner || owner.gameId !== gameId || !await tracking.current(owner)) return { accepted: 0, queued: 0 }
  const scope = scopeOf(owner)
  const store = await getStore()
  let profileMode = null
  const result = await store.drain({
    gameId: scope,
    send: async (pings) => {
      const auth = await session()
      if (!await tracking.current(owner) || auth?.user.id !== owner.userId) throw new Error('Tracking session ended.')
      const { data, error } = await supabase.rpc('ingest_pings', {
        g: gameId, pings, last_seen_seq: null,
      }).setHeader('Authorization', `Bearer ${auth.access_token}`)
      if (error) {
        const wrapped = new Error(error.message)
        wrapped.code = error.code
        throw wrapped
      }
      return data ?? { accepted: pings.length }
    },
    onBatch: async (data) => {
      if (!await tracking.current(owner)) return
      await AsyncStorage.setItem(`larp_last_sent_v2:${scope}`, new Date().toISOString())
      await syncNotifications(gameId).catch(() => {})
      if (data?.profile?.mode) profileMode = data.profile.mode
    },
  })
  if (result.reason) {
    // Server said no (game finished / consent revoked / removed from game):
    // nothing for this game stays on the device.
    await store.purgeGame(scope)
    await handleRejected(result.reason, owner)
    return { accepted: result.accepted, queued: 0, reason: result.reason }
  }
  if (profileMode) await applyProfile(profileMode, owner)
  return result
}

const REJECT_MESSAGES = {
  game_finished: 'The game has finished, so location sharing stopped.',
  eliminated: 'You have been eliminated, so location sharing stopped.',
  no_consent: 'Location consent is off for this game, so sharing stopped.',
  not_member: 'You are no longer a member of this game, so sharing stopped.',
}

// Server said no (game finished / consent revoked / removed from game):
// stop burning GPS and tell the player once, with the actual reason.
async function handleRejected(reason, owner) {
  try {
    if (!await tracking.stop(owner)) return
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Location sharing stopped',
        body: REJECT_MESSAGES[reason] ?? 'The game is not accepting location pings any more.',
      },
      trigger: null,
    })
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

async function applyProfile(mode, owner) {
  if (!GPS_PROFILES[mode] || !await tracking.current(owner)) return
  const key = `larp_profile_v2:${scopeOf(owner)}`
  if ((await AsyncStorage.getItem(key) ?? 'near') === mode) return
  await tracking.changeProfile(owner, mode)
  if (await tracking.current(owner)) await AsyncStorage.setItem(key, mode)
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

export async function queueStatus(gameId) {
  const auth = await session()
  if (!auth || !gameId) return { queued: 0, lastSent: null, profile: 'near' }
  const owner = await tracking.read()
  if (!owner || owner.gameId !== gameId || owner.userId !== auth.user.id) return { queued: 0, lastSent: null, profile: 'near' }
  const scope = scopeOf(owner)
  const status = await (await getStore()).status(scope)
  return { ...status,
    lastSent: await AsyncStorage.getItem(`larp_last_sent_v2:${scope}`),
    profile: await AsyncStorage.getItem(`larp_profile_v2:${scope}`) ?? 'near',
  }
}

export async function startSharing(gameId) {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') throw new Error('Location permission was denied.')
  const bg = await Location.requestBackgroundPermissionsAsync()
  if (bg.status !== 'granted') throw new Error('Choose "Allow all the time" in system settings for background location.')
  const owner = await tracking.start(gameId)
  await AsyncStorage.setItem(`larp_profile_v2:${scopeOf(owner)}`, 'near')
}

export async function stopSharing(gameId) {
  const owner = await tracking.read()
  if (gameId && (!owner || owner.gameId !== gameId || !await tracking.current(owner))) return
  await tracking.stop(owner)
}

export async function isSharing(gameId) {
  const owner = await tracking.read()
  return !!owner && owner.gameId === gameId && await tracking.current(owner)
    && await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
