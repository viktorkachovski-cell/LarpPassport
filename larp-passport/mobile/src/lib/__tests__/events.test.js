import { eventInfo } from '../events'

test('the player never gets a push for their own message', () => {
  expect(eventInfo('player_message').notifies).toBe(false)
  expect(eventInfo('gm_note').notifies).toBe(true)
})

test('hunt types this build does not know still get the hunt tag', () => {
  expect(eventInfo('hunt_paused').tag.label).toBe('HUNT')
  expect(eventInfo('elimination_voided').tag.label).toBe('HUNT')
  expect(eventInfo('zone_boundary_exit').boundary).toBe(true)
})

test('unknown or missing types fall back to neutral wording', () => {
  for (const type of ['something_new', undefined, 'toString']) {
    expect(eventInfo(type)).toMatchObject({
      title: 'Field state changed', notification: 'New passport event', body: '', tag: { label: 'FIELD EVENT' },
    })
  }
})

test('pirate events have crew-safe wording', () => {
  expect(eventInfo('pirate_claim')).toMatchObject({
    title: 'Your crew claimed a site', tag: { label: 'CREW' },
  })
  expect(eventInfo('pirate_reading').body).toContain('compass')
  expect(eventInfo('pirate_ruling')).toMatchObject({ tag: { label: 'ADMIRALTY' } })
  expect(eventInfo('pirate_parley').tag.label).toBe('PARLEY')
  expect(eventInfo('pirate_captain').body).toContain('compass')
  expect(eventInfo('pirate_something_new').tag.label).toBe('TIDE')
  expect(eventInfo('zone_enter')).toMatchObject({ title: 'A tale on the tide', tag: { label: 'LORE' } })
})
