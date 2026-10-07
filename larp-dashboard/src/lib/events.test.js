import { describe, expect, it } from 'vitest'
import { eventInfo, eventKind } from './events'

describe('event catalogue', () => {
  it('labels a boundary breach and marks it pending until ruled on', () => {
    expect(eventKind({ type: 'zone_boundary_exit', status: 'pending' })).toBe('BREACH // PENDING')
    expect(eventKind({ type: 'zone_boundary_exit', status: 'confirmed' })).toBe('BREACH')
    expect(eventInfo('zone_boundary_exit')).toMatchObject({ breach: true, tone: 'critical' })
  })

  it('describes zone events with the zone name', () => {
    const zoneNameOf = () => 'Northern anomaly'
    expect(eventInfo('zone_enter').describe({ type: 'zone_enter' }, zoneNameOf)).toBe('entered Northern anomaly')
    expect(eventInfo('zone_boundary_exit').describe({ type: 'zone_boundary_exit' }, zoneNameOf)).toBe('left Northern anomaly')
  })

  it('labels types the dashboard does not know yet from the type', () => {
    expect(eventInfo('something_new')).toMatchObject({ kind: 'SOMETHING NEW', tone: '', breach: false })
  })
})
