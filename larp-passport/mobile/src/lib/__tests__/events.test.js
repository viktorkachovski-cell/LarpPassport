import { eventInfo } from '../events'

test('the player never gets a push for their own message', () => {
  expect(eventInfo('player_message').notifies).toBe(false)
  expect(eventInfo('gm_note').notifies).toBe(true)
})

test('hunt-changing events reload the hunt, including types this build does not know', () => {
  expect(eventInfo('eliminated').affectsHunt).toBe(true)
  expect(eventInfo('zone_boundary_exit').affectsHunt).toBe(true)
  expect(eventInfo('hunt_paused')).toMatchObject({ affectsHunt: true, tag: { label: 'HUNT' } })
  expect(eventInfo('elimination_voided')).toMatchObject({ affectsHunt: true, tag: { label: 'HUNT' } })
  expect(eventInfo('zone_enter').affectsHunt).toBe(false)
})

test('unknown or missing types fall back to neutral wording', () => {
  for (const type of ['something_new', undefined, 'toString']) {
    expect(eventInfo(type)).toMatchObject({
      title: 'Field state changed', notification: 'New passport event', body: '', tag: { label: 'FIELD EVENT' },
    })
  }
})

test('pirate events have crew-safe wording and never reload Time Hunt', () => {
  expect(eventInfo('pirate_claim')).toMatchObject({
    title: 'Your crew claimed a site', affectsHunt: false, tag: { label: 'PIRATE' },
  })
  expect(eventInfo('pirate_reading').body).toContain('compass logbook')
  expect(eventInfo('pirate_ruling')).toMatchObject({ affectsHunt: false, tag: { label: 'PIRATE' } })
})
