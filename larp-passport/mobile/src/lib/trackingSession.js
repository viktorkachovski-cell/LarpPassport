// Serialize native lifecycle changes and reject stale in-flight responses.
export function createTrackingSession({ storage, key, start, stop, purge, currentUser }) {
  let tail = Promise.resolve()
  const serial = (fn) => {
    const work = tail.then(fn)
    tail = work.catch(() => {})
    return work
  }
  const read = async () => JSON.parse(await storage.getItem(key) || 'null')
  const matches = (a, b) => !!a && !!b && a.id === b.id
  async function current(owner) {
    return matches(owner, await read()) && owner.userId === await currentUser()
  }
  async function clear(owner) {
    await storage.removeItem(key)
    try { await stop() } finally { if (owner) await purge(owner) }
  }
  return {
    read, current,
    start: (gameId) => serial(async () => {
      const userId = await currentUser()
      if (!userId) throw new Error('Sign in before sharing location.')
      const old = await read()
      await clear(old)
      const owner = { userId, gameId, id: `${Date.now()}-${Math.random()}`, startedAt: Date.now() }
      await storage.setItem(key, JSON.stringify(owner))
      try {
        await start('near')
        if (!await current(owner)) throw new Error('Account changed while starting location sharing.')
      } catch (error) { await clear(owner); throw error }
      return owner
    }),
    stop: (expected) => serial(async () => {
      const owner = await read()
      if (expected && !matches(owner, expected)) return false
      await clear(owner)
      return true
    }),
    reconcile: () => serial(async () => {
      const owner = await read()
      if (!owner || owner.userId !== await currentUser()) await clear(owner)
    }),
    changeProfile: (owner, mode) => serial(async () => {
      if (!await current(owner)) return
      await stop()
      if (!await current(owner)) return
      try { await start(mode) } catch (error) { await clear(owner); throw error }
    }),
  }
}
