import { createPingStore, isValidationError, PING_STATUS } from '../pingStore'
import { openTestDb } from './betterSqliteAdapter'

const GAME = 'game-aaaa'
const OTHER_GAME = 'game-bbbb'
const T0 = Date.parse('2026-07-14T12:00:00.000Z')

function makePing(offsetSeconds, extra = {}) {
  return {
    lat: 42.14 + offsetSeconds * 1e-6,
    lng: 24.75 + offsetSeconds * 1e-6,
    accuracy: 8,
    battery: 71,
    recorded_at: new Date(T0 + offsetSeconds * 1000).toISOString(),
    ...extra,
  }
}

function makePings(count, startOffset = 0) {
  return Array.from({ length: count }, (_, i) => makePing(startOffset + i))
}

// Deferred helper so tests can pause a send() mid-flight deterministically.
function gate() {
  let open
  const opened = new Promise((resolve) => { open = resolve })
  return { open, opened }
}

function acceptAll() {
  const calls = []
  const send = async (pings) => {
    calls.push(pings)
    return { accepted: pings.length, events: [], profile: { mode: 'near' } }
  }
  return { send, calls }
}

let db
let clock
let store

beforeEach(() => {
  db = openTestDb()
  clock = T0 + 60_000 // "now" is one minute after the pings above
  store = createPingStore({ db, now: () => clock, maxQueue: 1000, batchSize: 100 })
})

afterEach(() => {
  db.close()
})

async function rowsByStatus(status) {
  return db.getAllAsync('select * from pending_pings where status = ? order by recorded_at', [status])
}

describe('enqueue', () => {
  test('stores valid points and reports counts', async () => {
    const result = await store.enqueue(GAME, makePings(3))
    expect(result).toEqual({ added: 3, ignored: 0, invalid: 0, dropped: 0 })
    expect((await store.status(GAME)).queued).toBe(3)
  })

  test('duplicate recorded_at for the same game is ignored (matches server dedup key)', async () => {
    await store.enqueue(GAME, [makePing(1)])
    const result = await store.enqueue(GAME, [makePing(1, { lat: 50 })])
    expect(result.added).toBe(0)
    expect(result.ignored).toBe(1)
    expect((await store.status(GAME)).queued).toBe(1)
  })

  test('same recorded_at in a different game is a separate point', async () => {
    await store.enqueue(GAME, [makePing(1)])
    const result = await store.enqueue(OTHER_GAME, [makePing(1)])
    expect(result.added).toBe(1)
  })

  test('rejects points the server would reject, so batches can never be poisoned', async () => {
    const result = await store.enqueue(GAME, [
      makePing(1, { lat: 91 }),
      makePing(2, { lng: -181 }),
      makePing(3, { accuracy: 10001 }),
      makePing(4, { battery: 101 }),
      makePing(5, { recorded_at: 'garbage' }),
      // server rejects > 5 min in the future; store margin is 4 min
      makePing(6, { recorded_at: new Date(clock + 5 * 60_000).toISOString() }),
      // server rejects > 24 h old; store margin is 23 h
      makePing(7, { recorded_at: new Date(clock - 24 * 60 * 60_000).toISOString() }),
      makePing(8),
    ])
    expect(result.invalid).toBe(7)
    expect(result.added).toBe(1)
  })

  test('queue reaching maximum size drops only the OLDEST PENDING points', async () => {
    const small = createPingStore({ db, now: () => clock, maxQueue: 5, batchSize: 2 })
    await small.enqueue(GAME, makePings(4)) // t0..t3 pending
    const claimed = await small.claimBatch(GAME) // t0, t1 -> in_flight
    expect(claimed).toHaveLength(2)

    await small.enqueue(GAME, makePings(4, 10)) // t10..t13 -> total 8, cap 5
    const inFlight = await rowsByStatus(PING_STATUS.IN_FLIGHT)
    expect(inFlight).toHaveLength(2) // in-flight rows are NEVER dropped by the cap

    const pending = await rowsByStatus(PING_STATUS.PENDING)
    expect(pending).toHaveLength(3)
    // oldest pending (t2, t3, t10) dropped; the newest three remain
    expect(pending.map((r) => r.recorded_at)).toEqual(
      makePings(3, 11).map((p) => p.recorded_at),
    )
  })
})

describe('drain', () => {
  test('500-point offline backlog drains oldest-first in batches and empties the queue', async () => {
    clock = T0 + 520_000 // all 500 points (spanning ~500s) are now in the past
    await store.enqueue(GAME, makePings(500))
    const { send, calls } = acceptAll()
    const result = await store.drain({ gameId: GAME, send })

    expect(result).toEqual({ accepted: 500, queued: 0 })
    expect(calls).toHaveLength(5)
    expect(calls.every((batch) => batch.length === 100)).toBe(true)
    const sentOrder = calls.flat().map((p) => p.recorded_at)
    expect(sentOrder).toEqual([...sentOrder].sort())
    expect((await store.status(GAME)).queued).toBe(0)
  })

  test('wire format matches the current ingest_pings contract', async () => {
    await store.enqueue(GAME, [makePing(1), makePing(2, { accuracy: null, battery: null })])
    const { send, calls } = acceptAll()
    await store.drain({ gameId: GAME, send })
    expect(calls[0][0]).toEqual({
      lat: makePing(1).lat,
      lng: makePing(1).lng,
      recorded_at: makePing(1).recorded_at,
      accuracy: 8,
      battery: 71,
    })
    // null accuracy/battery are omitted, exactly like the old queue payloads
    expect(Object.keys(calls[0][1]).sort()).toEqual(['lat', 'lng', 'recorded_at'])
  })

  test('ACCEPTANCE: a point enqueued after a flush begins is never removed unless the server accepted it', async () => {
    await store.enqueue(GAME, makePings(3))
    const firstSend = gate()
    let sendCount = 0
    const send = async (pings) => {
      sendCount += 1
      if (sendCount === 1) await firstSend.opened // hold the first batch in flight
      return { accepted: pings.length }
    }

    const drainPromise = store.drain({ gameId: GAME, send })
    await new Promise((r) => setTimeout(r, 10)) // let drain claim batch 1

    // background tick enqueues while the flush is mid-send
    await store.enqueue(GAME, [makePing(100)])
    firstSend.open()
    const result = await drainPromise

    // the running drain picked the new point up in its next claim
    expect(result).toEqual({ accepted: 4, queued: 0 })
    expect(sendCount).toBe(2)
  })

  test('a point enqueued mid-flush survives even if the flush errors out', async () => {
    await store.enqueue(GAME, makePings(2))
    const firstSend = gate()
    const send = async () => {
      await firstSend.opened
      throw new Error('network request failed')
    }
    const drainPromise = store.drain({ gameId: GAME, send })
    await new Promise((r) => setTimeout(r, 10))
    await store.enqueue(GAME, [makePing(100)])
    firstSend.open()
    const result = await drainPromise

    expect(result.error).toBe('network request failed')
    // 2 original points back to pending + the new one: nothing lost
    expect((await store.status(GAME)).queued).toBe(3)
  })

  test('two simultaneous flush calls share one drain (no double send)', async () => {
    await store.enqueue(GAME, makePings(150))
    const firstSend = gate()
    let sendCount = 0
    const send = async (pings) => {
      sendCount += 1
      if (sendCount === 1) await firstSend.opened
      return { accepted: pings.length }
    }

    const first = store.drain({ gameId: GAME, send })
    const second = store.drain({ gameId: GAME, send })
    expect(second).toBe(first) // coalesced onto the same run
    firstSend.open()
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({ accepted: 150, queued: 0 })
    expect(b).toEqual(a)
    expect(sendCount).toBe(2) // 100 + 50, sent exactly once
  })

  test('server failure returns the batch to pending; the retry succeeds', async () => {
    await store.enqueue(GAME, makePings(3))
    const failing = async () => {
      const error = new Error('Failed to fetch')
      throw error
    }
    const failed = await store.drain({ gameId: GAME, send: failing })
    expect(failed.error).toBe('Failed to fetch')
    expect(failed.queued).toBe(3)

    const pendingRows = await rowsByStatus(PING_STATUS.PENDING)
    expect(pendingRows.every((r) => r.attempt_count === 1)).toBe(true)
    expect(pendingRows.every((r) => r.last_error === 'Failed to fetch')).toBe(true)

    const { send } = acceptAll()
    const retried = await store.drain({ gameId: GAME, send })
    expect(retried).toEqual({ accepted: 3, queued: 0 })
  })

  test('transport errors retry indefinitely — attempts never park points as failed', async () => {
    await store.enqueue(GAME, makePings(2))
    const failing = async () => { throw new Error('Network unavailable') }
    for (let i = 0; i < 6; i += 1) {
      await store.drain({ gameId: GAME, send: failing })
    }
    expect((await store.status(GAME)).queued).toBe(2)
    expect(await rowsByStatus(PING_STATUS.FAILED)).toHaveLength(0)
  })

  test('server validation errors park the batch as failed after the attempt limit (queue keeps moving)', async () => {
    await store.enqueue(GAME, makePings(2))
    const validationFailure = async () => {
      const error = new Error('ping 1 contains an invalid value')
      error.code = '22023'
      throw error
    }
    for (let i = 0; i < 3; i += 1) {
      await store.drain({ gameId: GAME, send: validationFailure })
    }
    expect((await store.status(GAME)).queued).toBe(0)
    expect((await store.status(GAME)).failed).toBe(2)

    // new points still flow after the bad batch is parked
    await store.enqueue(GAME, [makePing(200)])
    const { send } = acceptAll()
    const result = await store.drain({ gameId: GAME, send })
    expect(result).toEqual({ accepted: 1, queued: 0 })
  })

  test('a consent/game rejection stops the drain without spinning and reports the reason', async () => {
    await store.enqueue(GAME, makePings(250))
    let sendCount = 0
    const send = async () => {
      sendCount += 1
      return { accepted: 0, reason: 'no_active_consent_or_game' }
    }
    const result = await store.drain({ gameId: GAME, send })
    expect(result.reason).toBe('no_active_consent_or_game')
    expect(sendCount).toBe(1) // did not hammer the server with the remaining batches
  })
})

describe('consent revocation', () => {
  test('revoked while a flush is in progress: purge wins, nothing resurrects', async () => {
    await store.enqueue(GAME, makePings(120))
    const firstSend = gate()
    let sendCount = 0
    const send = async (pings) => {
      sendCount += 1
      if (sendCount === 1) await firstSend.opened
      return { accepted: pings.length }
    }
    const drainPromise = store.drain({ gameId: GAME, send })
    await new Promise((r) => setTimeout(r, 10))

    await store.purgeGame(GAME) // player flips the switch off mid-send
    firstSend.open()
    await drainPromise

    const remaining = await db.getAllAsync('select * from pending_pings where game_id = ?', [GAME])
    expect(remaining).toHaveLength(0)
  })

  test('revoked mid-flight with a FAILING send: the nack does not resurrect purged rows', async () => {
    await store.enqueue(GAME, makePings(5))
    const firstSend = gate()
    const send = async () => {
      await firstSend.opened
      throw new Error('network request failed')
    }
    const drainPromise = store.drain({ gameId: GAME, send })
    await new Promise((r) => setTimeout(r, 10))
    await store.purgeGame(GAME)
    firstSend.open()
    await drainPromise

    const remaining = await db.getAllAsync('select * from pending_pings where game_id = ?', [GAME])
    expect(remaining).toHaveLength(0) // nack's in_flight guard touched nothing
  })

  test('purging one game leaves other games untouched', async () => {
    await store.enqueue(GAME, makePings(3))
    await store.enqueue(OTHER_GAME, makePings(3))
    await store.purgeGame(GAME)
    expect((await store.status(GAME)).queued).toBe(0)
    expect((await store.status(OTHER_GAME)).queued).toBe(3)
  })
})

describe('restart recovery and retention', () => {
  test('app terminated with in_flight records: a fresh store recovers them to pending', async () => {
    await store.enqueue(GAME, makePings(7))
    const claimed = await store.claimBatch(GAME)
    expect(claimed).toHaveLength(7)
    expect(await rowsByStatus(PING_STATUS.IN_FLIGHT)).toHaveLength(7)

    // simulate process death + restart: new store over the same database file
    const restarted = createPingStore({ db, now: () => clock })
    await restarted.init()
    expect(await rowsByStatus(PING_STATUS.IN_FLIGHT)).toHaveLength(0)
    expect((await restarted.status(GAME)).queued).toBe(7)
  })

  test('points older than the server acceptance window are pruned instead of poisoning batches', async () => {
    await store.enqueue(GAME, makePings(3))
    clock += 22 * 60 * 60_000 // 22h later: points still valid, kept
    expect(await store.claimBatch(GAME)).toHaveLength(3)
    await store.nackBatch((await rowsByStatus(PING_STATUS.IN_FLIGHT)).map((r) => r.id), 'net', false)

    clock += 2 * 60 * 60_000 // now 24h+: server would reject the whole batch forever
    expect(await store.claimBatch(GAME)).toHaveLength(0)
    expect((await store.status(GAME)).queued).toBe(0)
  })

  test('drain per-game isolation: only the flushed game leaves the device', async () => {
    await store.enqueue(GAME, makePings(3))
    await store.enqueue(OTHER_GAME, makePings(3))
    const { send, calls } = acceptAll()
    await store.drain({ gameId: GAME, send })
    expect(calls.flat()).toHaveLength(3)
    expect((await store.status(OTHER_GAME)).queued).toBe(3)
  })
})

describe('status surface', () => {
  test('reports pending count, oldest pending age and last error', async () => {
    await store.enqueue(GAME, makePings(2))
    const failing = async () => { throw new Error('Network unavailable') }
    await store.drain({ gameId: GAME, send: failing })
    const s = await store.status(GAME)
    expect(s.queued).toBe(2)
    expect(s.oldestPendingAt).toBe(makePing(0).recorded_at)
    expect(s.lastError).toBe('Network unavailable')
    expect(s.failed).toBe(0)
  })
})

describe('isValidationError', () => {
  test('classifies server validation codes and messages', () => {
    expect(isValidationError({ code: '22023' })).toBe(true)
    expect(isValidationError({ message: 'ping 3 latitude is out of range' })).toBe(true)
    expect(isValidationError({ message: 'pings payload exceeds 256 KiB' })).toBe(true)
    expect(isValidationError({ message: 'Failed to fetch' })).toBe(false)
    expect(isValidationError({ message: 'JWT expired', code: 'PGRST301' })).toBe(false)
  })
})
