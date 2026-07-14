// SQLite-backed queue for location pings (replaces the AsyncStorage JSON array).
//
// Why: the old flush() read the whole queue, sent it, then wrote back '[]'.
// Any point enqueued between the read and the clear was silently erased.
// Here every point is a row; a flush claims a batch (pending -> in_flight)
// inside a transaction, sends ONLY that batch, and deletes ONLY those ids on
// success. A point can never be removed unless the server accepted the batch
// that contained that specific point, it was pruned as permanently
// unsendable (see below), or the player revoked consent.
//
// This module is dependency-free on purpose: it receives an already-opened
// database handle whose shape matches expo-sqlite's async API
// (execAsync / runAsync / getAllAsync / getFirstAsync /
// withExclusiveTransactionAsync). Tests drive it with a better-sqlite3
// adapter, so the SQL semantics under test are real.
//
// Server contract mirrored here (public.ingest_pings):
// - dedup key is (game_id, profile_id, recorded_at) -> we keep a matching
//   UNIQUE(game_id, recorded_at) locally, so retrying a batch is idempotent.
// - a single invalid point (bad coords/accuracy/battery/timestamp) fails the
//   WHOLE batch with an exception -> we validate at enqueue so garbage never
//   enters the queue.
// - points older than 24h or more than 5min in the future fail the WHOLE
//   batch -> we refuse future points at enqueue and prune points older than
//   MAX_AGE_MS before every claim, otherwise one stale point would poison
//   every batch forever ("bricked" location sharing).

export const PING_STATUS = { PENDING: 'pending', IN_FLIGHT: 'in_flight', FAILED: 'failed' }

const DEFAULTS = {
  maxQueue: 1000, // proposal allows 500-1000; oldest *pending* rows drop first
  batchSize: 100, // well under the server's 500-point / 256 KiB batch limits
  maxBatchesPerDrain: 20, // safety valve: 20 * 100 = 2000 points per drain
  maxValidationAttempts: 3, // server says the data itself is bad -> park as 'failed'
  maxAgeMs: 23 * 60 * 60 * 1000, // server rejects > 24h; 1h margin for clock skew + flight time
  maxFutureMs: 4 * 60 * 1000, // server rejects > 5min ahead; 1min margin
}

const SCHEMA = `
create table if not exists pending_pings (
  id text primary key,
  game_id text not null,
  lat real not null,
  lng real not null,
  accuracy real,
  battery integer,
  recorded_at text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  created_at text not null
);
create index if not exists idx_pending_pings_status_recorded
  on pending_pings(status, recorded_at);
create unique index if not exists idx_pending_pings_game_recorded
  on pending_pings(game_id, recorded_at);
`

let idCounter = 0
function makeId(now) {
  idCounter = (idCounter + 1) % 0xffff
  return `${now.toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

// Mirrors the validation in public.ingest_pings so a point we accept locally
// can never fail the server's whole-batch validation later.
export function validatePing(ping, nowMs, { maxAgeMs, maxFutureMs }) {
  if (!ping || typeof ping !== 'object') return 'not an object'
  if (!isFiniteNumber(ping.lat) || ping.lat < -90 || ping.lat > 90) return 'latitude out of range'
  if (!isFiniteNumber(ping.lng) || ping.lng < -180 || ping.lng > 180) return 'longitude out of range'
  if (ping.accuracy != null && (!isFiniteNumber(ping.accuracy) || ping.accuracy < 0 || ping.accuracy > 10000)) {
    return 'accuracy out of range'
  }
  if (ping.battery != null && (!isFiniteNumber(ping.battery) || ping.battery < 0 || ping.battery > 100)) {
    return 'battery out of range'
  }
  const recorded = Date.parse(ping.recorded_at)
  if (!Number.isFinite(recorded)) return 'invalid recorded_at'
  if (recorded < nowMs - maxAgeMs) return 'recorded_at too old'
  if (recorded > nowMs + maxFutureMs) return 'recorded_at in the future'
  return null
}

// The server raises errcode 22023 for data that can never become valid.
// Those must not be retried forever; transport/auth errors must be.
export function isValidationError(error) {
  if (!error) return false
  if (error.code === '22023' || error.code === '22P02') return true
  const message = String(error.message ?? '')
  return /pings must contain between|payload exceeds|ping \d+ (must be an object|contains an invalid value|latitude is out of range|longitude is out of range|accuracy is out of range|battery is out of range|timestamp is outside)/.test(message)
}

export function createPingStore({ db, now = () => Date.now(), ...options } = {}) {
  if (!db) throw new Error('createPingStore requires a db handle')
  const config = { ...DEFAULTS, ...options }
  let initialized = null
  let draining = null

  async function init() {
    if (!initialized) {
      initialized = (async () => {
        await db.execAsync(SCHEMA)
        // Startup recovery: rows a previous process marked in_flight but never
        // resolved (app killed mid-flush) go back to pending.
        await db.runAsync(
          `update pending_pings set status = ? where status = ?`,
          [PING_STATUS.PENDING, PING_STATUS.IN_FLIGHT],
        )
        await pruneStale()
      })()
    }
    return initialized
  }

  async function pruneStale() {
    const cutoff = new Date(now() - config.maxAgeMs).toISOString()
    await db.runAsync(`delete from pending_pings where recorded_at < ?`, [cutoff])
  }

  // Insert new points. Returns counts so callers/tests can observe policy.
  // - invalid points are rejected (would poison a whole server batch)
  // - duplicate (game_id, recorded_at) is ignored (matches server dedup key)
  // - when over maxQueue, oldest PENDING rows drop; in_flight rows are never
  //   dropped because their fate belongs to the flush that claimed them
  async function enqueue(gameId, pings) {
    await init()
    if (!gameId || !Array.isArray(pings) || pings.length === 0) {
      return { added: 0, ignored: 0, invalid: 0, dropped: 0 }
    }
    const nowMs = now()
    const nowIso = new Date(nowMs).toISOString()
    let added = 0
    let ignored = 0
    let invalid = 0
    let dropped = 0
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const ping of pings) {
        if (validatePing(ping, nowMs, config)) {
          invalid += 1
          continue
        }
        const result = await txn.runAsync(
          `insert or ignore into pending_pings
             (id, game_id, lat, lng, accuracy, battery, recorded_at, status, created_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            makeId(nowMs), gameId, ping.lat, ping.lng,
            ping.accuracy ?? null, ping.battery ?? null,
            ping.recorded_at, PING_STATUS.PENDING, nowIso,
          ],
        )
        if ((result?.changes ?? 0) > 0) added += 1
        else ignored += 1
      }
      const countRow = await txn.getFirstAsync(
        `select count(*) as n from pending_pings where game_id = ?`, [gameId],
      )
      const overflow = (countRow?.n ?? 0) - config.maxQueue
      if (overflow > 0) {
        const result = await txn.runAsync(
          `delete from pending_pings where id in (
             select id from pending_pings
             where game_id = ? and status = ?
             order by recorded_at asc limit ?
           )`,
          [gameId, PING_STATUS.PENDING, overflow],
        )
        dropped = result?.changes ?? 0
      }
    })
    return { added, ignored, invalid, dropped }
  }

  // Atomically claim the oldest pending batch for one game.
  async function claimBatch(gameId) {
    await init()
    let rows = []
    await db.withExclusiveTransactionAsync(async (txn) => {
      const cutoff = new Date(now() - config.maxAgeMs).toISOString()
      await txn.runAsync(`delete from pending_pings where recorded_at < ?`, [cutoff])
      rows = await txn.getAllAsync(
        `select * from pending_pings
         where game_id = ? and status = ?
         order by recorded_at asc limit ?`,
        [gameId, PING_STATUS.PENDING, config.batchSize],
      )
      if (rows.length > 0) {
        const marks = rows.map(() => '?').join(',')
        await txn.runAsync(
          `update pending_pings set status = ? where id in (${marks})`,
          [PING_STATUS.IN_FLIGHT, ...rows.map((r) => r.id)],
        )
      }
    })
    return rows
  }

  // Server accepted the batch (dedup counts as accepted): remove exactly it.
  async function ackBatch(ids) {
    if (!ids?.length) return
    const marks = ids.map(() => '?').join(',')
    await db.runAsync(`delete from pending_pings where id in (${marks})`, ids)
  }

  // Send failed. Transport errors go back to pending and retry indefinitely
  // (staleness pruning bounds them). Validation errors count toward a small
  // limit, then park as 'failed' so one bad batch cannot stall the queue.
  // `status = 'in_flight'` guard: if consent was revoked mid-send and the rows
  // were purged, this touches nothing and must not resurrect them.
  async function nackBatch(ids, message, permanent) {
    if (!ids?.length) return
    const marks = ids.map(() => '?').join(',')
    await db.runAsync(
      `update pending_pings
       set attempt_count = attempt_count + 1,
           last_error = ?,
           status = case
             when ? and attempt_count + 1 >= ? then '${PING_STATUS.FAILED}'
             else '${PING_STATUS.PENDING}'
           end
       where status = '${PING_STATUS.IN_FLIGHT}' and id in (${marks})`,
      [String(message ?? 'send failed').slice(0, 500), permanent ? 1 : 0, config.maxValidationAttempts, ...ids],
    )
  }

  // Consent revoked / left game / server said no: nothing for this game may
  // remain on the device, including rows a running flush has in flight.
  async function purgeGame(gameId) {
    await init()
    await db.runAsync(`delete from pending_pings where game_id = ?`, [gameId])
  }

  async function pendingCount(gameId) {
    const row = gameId
      ? await db.getFirstAsync(
        `select count(*) as n from pending_pings where game_id = ? and status = ?`,
        [gameId, PING_STATUS.PENDING],
      )
      : await db.getFirstAsync(
        `select count(*) as n from pending_pings where status = ?`,
        [PING_STATUS.PENDING],
      )
    return row?.n ?? 0
  }

  async function status(gameId) {
    await init()
    const filter = gameId ? 'game_id = ? and' : ''
    const params = gameId ? [gameId] : []
    const pending = await db.getFirstAsync(
      `select count(*) as n, min(recorded_at) as oldest from pending_pings
       where ${filter} status = '${PING_STATUS.PENDING}'`, params,
    )
    const failed = await db.getFirstAsync(
      `select count(*) as n from pending_pings where ${filter} status = '${PING_STATUS.FAILED}'`, params,
    )
    const lastError = await db.getFirstAsync(
      `select last_error from pending_pings
       where ${filter} last_error is not null
       order by recorded_at desc limit 1`, params,
    )
    return {
      queued: pending?.n ?? 0,
      oldestPendingAt: pending?.oldest ?? null,
      failed: failed?.n ?? 0,
      lastError: lastError?.last_error ?? null,
    }
  }

  function toWirePing(row) {
    return {
      lat: row.lat,
      lng: row.lng,
      recorded_at: row.recorded_at,
      ...(row.accuracy != null ? { accuracy: row.accuracy } : {}),
      ...(row.battery != null ? { battery: row.battery } : {}),
    }
  }

  // Drain the queue for one game. Single-flight: concurrent callers share the
  // running drain's promise, and the loop naturally picks up points enqueued
  // while it runs (it claims until no pending rows remain).
  //
  // send(pings) must resolve with the parsed ingest_pings response, or throw
  // an Error (optionally carrying .code) on transport/server failure.
  // onBatch(data) fires after each accepted batch (event/profile piggyback).
  function drain({ gameId, send, onBatch }) {
    if (draining) return draining
    draining = (async () => {
      await init()
      let accepted = 0
      let batches = 0
      try {
        while (batches < config.maxBatchesPerDrain) {
          const rows = await claimBatch(gameId)
          if (rows.length === 0) break
          batches += 1
          const ids = rows.map((r) => r.id)
          let data
          try {
            data = await send(rows.map(toWirePing))
          } catch (error) {
            await nackBatch(ids, error?.message, isValidationError(error))
            return {
              accepted,
              queued: await pendingCount(gameId),
              error: error?.message ?? 'send failed',
            }
          }
          if (data?.reason) {
            // Server refused (consent off / game over). Not an error and not
            // retryable: hand the rows back and let the caller purge + stop.
            await nackBatch(ids, `rejected: ${data.reason}`, false)
            return { accepted, queued: await pendingCount(gameId), reason: data.reason, data }
          }
          await ackBatch(ids)
          accepted += Number.isFinite(data?.accepted) ? data.accepted : rows.length
          if (onBatch) await onBatch(data)
        }
        return { accepted, queued: await pendingCount(gameId) }
      } finally {
        draining = null
      }
    })()
    return draining
  }

  return {
    init,
    enqueue,
    claimBatch,
    ackBatch,
    nackBatch,
    purgeGame,
    status,
    drain,
    _config: config,
  }
}
