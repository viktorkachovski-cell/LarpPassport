import { createEventDelivery } from '../eventDelivery'

function fixture() {
  const values = new Map()
  const deps = {
    storage: { getItem: async (k) => values.get(k), setItem: async (k, v) => values.set(k, v) },
    fetchPage: jest.fn(async () => []), notify: jest.fn(), isCurrent: jest.fn(async () => true),
  }
  return { ...deps, delivery: createEventDelivery(deps) }
}
test('concurrent realtime and background wakeups deliver once', async () => {
  const f = fixture()
  f.fetchPage.mockResolvedValueOnce([{ id: 'a', delivery_seq: 1 }])
  await Promise.all([f.delivery.sync('alice:A'), f.delivery.sync('alice:A')])
  expect(f.notify).toHaveBeenCalledTimes(1)
})
test('late visibility delivers an older timeline event and scopes cursors to account/game', async () => {
  const f = fixture()
  f.fetchPage.mockResolvedValueOnce([{ id: 'new', seq: 20, delivery_seq: 20 }])
  await f.delivery.sync('alice:A')
  f.fetchPage.mockResolvedValueOnce([{ id: 'old', seq: 2, delivery_seq: 21 }])
  await f.delivery.sync('alice:A')
  await f.delivery.sync('bob:A')
  await f.delivery.sync('alice:B')
  expect(f.notify).toHaveBeenCalledTimes(2)
  expect(f.fetchPage).toHaveBeenCalledWith('alice:A', 20)
  expect(f.fetchPage).toHaveBeenCalledWith('bob:A', 0)
  expect(f.fetchPage).toHaveBeenCalledWith('alice:B', 0)
})
test('failed delivery retries without losing the cursor and account changes stop delivery', async () => {
  const f = fixture()
  f.fetchPage.mockResolvedValue([{ id: 'a', delivery_seq: 1 }])
  f.notify.mockRejectedValueOnce(new Error('unavailable'))
  await expect(f.delivery.sync('alice:A')).rejects.toThrow('unavailable')
  f.fetchPage.mockResolvedValueOnce([{ id: 'a', delivery_seq: 1 }]).mockResolvedValueOnce([])
  await f.delivery.sync('alice:A')
  expect(f.fetchPage.mock.calls[1][1]).toBe(0)
  f.isCurrent.mockResolvedValue(false)
  await f.delivery.sync('alice:A')
  expect(f.notify).toHaveBeenCalledTimes(2)
})
