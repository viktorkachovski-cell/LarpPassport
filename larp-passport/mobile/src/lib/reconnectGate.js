// Spreads the first automatic flush after a failure across a random window.
//
// Why: at a LARP the whole field loses and regains cell coverage together.
// Every device keeps recording while offline (GPS works fine without a
// network), so each one accumulates a backlog and then flushes it the moment
// connectivity returns. Twenty phones reconnecting within the same few seconds
// send twenty backlog drains at once, and each drain is expensive on the server
// -- ingest_pings evaluates zones per accepted point (up to 50), and each
// evaluation runs several statements per active zone. That is a correlated
// spike against a free-tier database, not a throughput problem: the same total
// work spread over 30 seconds is unremarkable.
//
// The fix is to decorrelate, not to slow anything down. After a failed flush
// the next AUTOMATIC flush is deferred by a random 0-30s. Deferring is chosen
// over sleeping deliberately: the background location task fires every 15-90s
// anyway, so a deferred flush is picked up by the following tick without
// holding a timer open in Doze, where timers are unreliable and a sleeping task
// can be killed outright.
//
// Deferring is safe with respect to the queue's data-loss invariant. It does
// not touch rows: points simply stay 'pending' until the gate opens. Nothing is
// claimed, acked or dropped here.
//
// The gate is in-memory on purpose. It only ever needs to survive between
// location-task ticks within one JS process, and process death is not
// correlated across devices -- so losing the deadline on restart cannot
// recreate the stampede it exists to prevent, and persisting it would add an
// AsyncStorage write to the hot path for nothing.
//
// Dependency-free by design (like pingStore) so it is unit-testable without
// mocking Expo. `now` and `random` are injectable for deterministic tests.

export const RECONNECT_JITTER_MAX_MS = 30000

export function createReconnectGate({
  now = () => Date.now(),
  random = Math.random,
  jitterMaxMs = RECONNECT_JITTER_MAX_MS,
} = {}) {
  const maxMs = Number.isFinite(jitterMaxMs) && jitterMaxMs > 0 ? jitterMaxMs : 0
  let notBefore = 0

  // True when an automatic flush should stand down for now. Manual "SEND NOW"
  // must ignore this: an explicit user action always wins.
  function isBlocked() {
    return now() < notBefore
  }

  function remainingMs() {
    return Math.max(0, notBefore - now())
  }

  // Call after a flush attempt fails. Re-arming on every failure (rather than
  // only the first) also spreads repeated retries during a long outage.
  function armAfterFailure() {
    const delay = Math.floor(random() * maxMs)
    notBefore = now() + delay
    return delay
  }

  // Call after a successful flush: we are demonstrably reconnected.
  function clear() {
    notBefore = 0
  }

  return { isBlocked, remainingMs, armAfterFailure, clear, _jitterMaxMs: maxMs }
}
