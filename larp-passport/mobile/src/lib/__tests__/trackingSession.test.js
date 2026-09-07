import { createTrackingSession } from '../trackingSession'

function fixture() {
  const values = new Map()
  const deps = {
    storage: { getItem: async (k) => values.get(k), setItem: async (k, v) => values.set(k, v), removeItem: async (k) => values.delete(k) },
    key: 'owner', start: jest.fn(), stop: jest.fn(), purge: jest.fn(), currentUser: jest.fn(async () => 'alice'),
  }
  return { ...deps, tracking: createTrackingSession(deps) }
}

test('switching games stops the old service and purges only its queue', async () => {
  const f = fixture()
  const a = await f.tracking.start('A')
  const b = await f.tracking.start('B')
  expect(f.purge).toHaveBeenCalledWith(a)
  expect(await f.tracking.current(a)).toBe(false)
  expect(await f.tracking.current(b)).toBe(true)
})

test('a rejected in-flight response cannot stop a newer session in the same game', async () => {
  const f = fixture()
  const old = await f.tracking.start('A')
  const current = await f.tracking.start('A')
  expect(await f.tracking.stop(old)).toBe(false)
  await f.tracking.changeProfile(old, 'far')
  expect(await f.tracking.current(current)).toBe(true)
  expect(f.start.mock.calls).toEqual([['near'], ['near']])
})

test('account changes immediately invalidate ownership and reconcile native tracking', async () => {
  const f = fixture()
  const owner = await f.tracking.start('A')
  f.currentUser.mockResolvedValue('bob')
  expect(await f.tracking.current(owner)).toBe(false)
  await f.tracking.reconcile()
  expect(await f.tracking.read()).toBe(null)
  expect(f.purge).toHaveBeenCalledWith(owner)
})

test('stop arriving during startup wins and failed startup clears ownership', async () => {
  const f = fixture()
  let release
  f.start.mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  const starting = f.tracking.start('A')
  while (!release) await Promise.resolve()
  const stopping = f.tracking.stop()
  release()
  await Promise.all([starting, stopping])
  expect(await f.tracking.read()).toBe(null)
  f.start.mockRejectedValueOnce(new Error('permission revoked'))
  await expect(f.tracking.start('A')).rejects.toThrow('permission revoked')
  expect(await f.tracking.read()).toBe(null)
})
