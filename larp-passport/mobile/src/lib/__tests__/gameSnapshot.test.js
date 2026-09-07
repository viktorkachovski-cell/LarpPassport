import { readGameSnapshot } from '../gameSnapshot'

function client(results) {
  return { from: (table) => {
    const chain = { then: (resolve, reject) => Promise.resolve(results[table]).then(resolve, reject) }
    for (const method of ['select', 'eq', 'single', 'maybeSingle', 'order', 'limit']) chain[method] = () => chain
    return chain
  } }
}
test('a failed character read never becomes permission to create a new character', async () => {
  await expect(readGameSnapshot(client({ games: { data: { id: 'g' } }, characters: { error: new Error('offline') }, game_events: { data: [] } }), 'g', 'u', '*')).rejects.toThrow('offline')
})
test('only a successful empty character read returns null', async () => {
  const result = await readGameSnapshot(client({ games: { data: { id: 'g' } }, characters: { data: null }, game_events: { data: [] } }), 'g', 'u', '*')
  expect(result.character).toBe(null)
  expect(result.game.id).toBe('g')
})
test('missing access and transport rejection remain errors', async () => {
  await expect(readGameSnapshot(client({ games: { data: null }, characters: { data: null }, game_events: { data: [] } }), 'g', 'u', '*')).rejects.toThrow('no longer available')
  await expect(readGameSnapshot({ from: () => { throw new Error('connection lost') } }, 'g', 'u', '*')).rejects.toThrow('connection lost')
})
