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
    title: 'Your crew claimed a site', tag: { label: 'PIRATE' },
  })
  expect(eventInfo('pirate_reading').body).toContain('compass logbook')
  expect(eventInfo('pirate_ruling')).toMatchObject({ tag: { label: 'PIRATE' } })
})
