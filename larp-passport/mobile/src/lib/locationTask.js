import * as TaskManager from 'expo-task-manager'
import * as Location from 'expo-location'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { supabase } from './supabase'

export const LOCATION_TASK = 'larp-passport-location'
const QUEUE_KEY = 'larp_ping_queue_v1'
const GAME_KEY = 'larp_active_game_v1'
const LAST_SENT_KEY = 'larp_last_sent_v1'
const MAX_QUEUE = 500

// Headless task — runs while the foreground service keeps the app alive,
// including with the screen off or the app backgrounded.
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return
  try {
    const gameId = await AsyncStorage.getItem(GAME_KEY)
    if (!gameId) return
    const pings = (data.locations ?? []).map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      accuracy: l.coords.accuracy,
      recorded_at: new Date(l.timestamp).toISOString(),
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

// Sends everything queued. On failure (no signal, server down) the queue is kept
// and retried on the next location tick — the forest-dead-spot path.
export async function flush(gameId) {
  const cur = await readQueue()
  if (cur.length === 0) return { accepted: 0, queued: 0 }
  const { data, error } = await supabase.rpc('ingest_pings', { g: gameId, pings: cur })
  if (error) return { accepted: 0, queued: cur.length, error: error.message }
  await AsyncStorage.setItem(QUEUE_KEY, '[]')
  await AsyncStorage.setItem(LAST_SENT_KEY, new Date().toISOString())
  return { ...(data ?? { accepted: 0 }), queued: 0 }
}

export async function queueStatus() {
  const q = await readQueue()
  const last = await AsyncStorage.getItem(LAST_SENT_KEY)
  return { queued: q.length, lastSent: last }
}

export async function startSharing(gameId) {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') throw new Error('Location permission was denied.')
  const bg = await Location.requestBackgroundPermissionsAsync()
  if (bg.status !== 'granted') {
    throw new Error('Background location was denied. Choose "Allow all the time" in system settings so tracking works with the screen off.')
  }
  await AsyncStorage.setItem(GAME_KEY, gameId)
  const already = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (already) return
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000,
    distanceInterval: 5,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'LARP Passport is sharing your location',
      notificationBody: 'Your game masters can see where you are. Stop sharing any time in the app.',
      notificationColor: '#c9a227',
      killServiceOnDestroy: false,
    },
  })
}

export async function stopSharing() {
  await AsyncStorage.removeItem(GAME_KEY)
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
  if (started) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
}

export async function isSharing() {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK).catch(() => false)
}
