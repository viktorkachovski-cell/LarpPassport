export async function readGameSnapshot(client, gameId, userId, gameColumns) {
  const [game, character, events] = await Promise.all([
    client.from('games').select(gameColumns).eq('id', gameId).single(),
    client.from('characters').select('*').eq('game_id', gameId).eq('user_id', userId).eq('is_npc', false).maybeSingle(),
    client.from('game_events').select('*').eq('game_id', gameId).order('delivery_seq', { ascending: false }).limit(50),
  ])
  const failure = [game, character, events].find((result) => result.error)
  if (failure) throw failure.error
  if (!game.data) throw new Error('This game is no longer available.')
  return { game: game.data, character: character.data ?? null, events: events.data ?? [] }
}
