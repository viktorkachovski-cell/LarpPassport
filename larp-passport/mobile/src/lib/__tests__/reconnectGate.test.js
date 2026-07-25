import { createReconnectGate, RECONNECT_JITTER_MAX_MS } from '../reconnectGate'

// Deterministic clock + random so every assertion below is exact.
function harness(randomValues = [0.5]) {
  let clock = 1_000_000
  let i = 0
  const gate = createReconnectGate({
    now: () => clock,
    random: () => randomValues[i++ % randomValues.length],
  })
  return { gate, advance: (ms) => { clock += ms }, at: () => clock }
}

describe('reconnect gate', () => {
  it('is open before anything fails, so normal flushing is unaffected', () => {
    const { gate } = harness()
    expect(gate.isBlocked()).toBe(false)
    expect(gate.remainingMs()).toBe(0)
  })

  it('blocks the next automatic flush for a jittered delay after a failure', () => {
    const { gate, advance } = harness([0.5])
    const delay = gate.armAfterFailure()

    expect(delay).toBe(RECONNECT_JITTER_MAX_MS / 2)
    expect(gate.isBlocked()).toBe(true)
    expect(gate.remainingMs()).toBe(delay)

    advance(delay - 1)
    expect(gate.isBlocked()).toBe(true)

    advance(1)
    expect(gate.isBlocked()).toBe(false)
    expect(gate.remainingMs()).toBe(0)
  })

  it('never delays longer than the jitter window', () => {
    const { gate } = harness([0.999999])
    expect(gate.armAfterFailure()).toBeLessThan(RECONNECT_JITTER_MAX_MS)
  })

  it('a zero draw means no delay at all, so one device always retries at once', () => {
    const { gate } = harness([0])
    expect(gate.armAfterFailure()).toBe(0)
    expect(gate.isBlocked()).toBe(false)
  })

  it('clears on success so a reconnected device flushes without delay', () => {
    const { gate } = harness([0.9])
    gate.armAfterFailure()
    expect(gate.isBlocked()).toBe(true)
    gate.clear()
    expect(gate.isBlocked()).toBe(false)
    expect(gate.remainingMs()).toBe(0)
  })

  it('re-arms on repeated failures so a long outage keeps spreading retries', () => {
    const { gate, advance } = harness([0.2, 0.8])
    const first = gate.armAfterFailure()
    advance(first)
    expect(gate.isBlocked()).toBe(false)

    const second = gate.armAfterFailure()
    expect(second).not.toBe(first)
    expect(gate.isBlocked()).toBe(true)
  })

  it('remainingMs never reports a negative delay once the window has passed', () => {
    const { gate, advance } = harness([0.1])
    gate.armAfterFailure()
    advance(RECONNECT_JITTER_MAX_MS * 10)
    expect(gate.remainingMs()).toBe(0)
  })

  // The point of the whole exercise: 20 devices that failed at the same instant
  // must not retry at the same instant.
  it('decorrelates a field of devices reconnecting together', () => {
    const deviceCount = 20
    const delays = []
    for (let d = 0; d < deviceCount; d += 1) {
      const { gate } = harness([d / deviceCount])
      delays.push(gate.armAfterFailure())
    }

    const unique = new Set(delays)
    expect(unique.size).toBe(deviceCount)
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...delays)).toBeLessThan(RECONNECT_JITTER_MAX_MS)

    // No more than a couple of devices land in any one second of the window.
    const perSecond = new Map()
    for (const delay of delays) {
      const bucket = Math.floor(delay / 1000)
      perSecond.set(bucket, (perSecond.get(bucket) ?? 0) + 1)
    }
    expect(Math.max(...perSecond.values())).toBeLessThanOrEqual(2)
  })

  it('a non-positive jitter window degrades to no delay rather than misbehaving', () => {
    const gate = createReconnectGate({ jitterMaxMs: 0, random: () => 0.9 })
    expect(gate.armAfterFailure()).toBe(0)
    expect(gate.isBlocked()).toBe(false)
  })
})
