// A single ordered feed is shared by foreground and background wakeups.
// Realtime only wakes the feed; it must never advance its cursor past gaps.
export function createEventDelivery({ storage, fetchPage, notify, isCurrent }) {
  const flights = new Map()
  function sync(scope) {
    if (flights.has(scope)) return flights.get(scope)
    const work = (async () => {
      const key = `larp_delivery_v2:${scope}`
      let cursor = Number(await storage.getItem(key)) || 0
      for (let page = 0; page < 20 && await isCurrent(scope); page += 1) {
        const events = await fetchPage(scope, cursor)
        if (!events.length) break
        for (const event of events) {
          if (!await isCurrent(scope)) return
          if (event.delivery_seq <= cursor) continue
          if (event.type !== 'player_message') await notify(event)
          cursor = event.delivery_seq
          await storage.setItem(key, String(cursor))
        }
      }
    })().finally(() => flights.delete(scope))
    flights.set(scope, work)
    return work
  }
  return { sync }
}
