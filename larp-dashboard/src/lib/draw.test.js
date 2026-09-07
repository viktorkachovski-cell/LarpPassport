import { describe, expect, it } from 'vitest'
import { canFinishPolygon, dedupeVertices, distinctVertexCount } from './draw'
import { polygonEwkt } from './geo'

describe('polygon drawing helpers', () => {
  it('counts distinct committed vertices only', () => {
    expect(distinctVertexCount([])).toBe(0)
    expect(distinctVertexCount([[1, 1], [1, 1], [2, 2]])).toBe(2)
    expect(canFinishPolygon([[1, 1], [2, 2], [1, 1]])).toBe(false)
    expect(canFinishPolygon([[1, 1], [2, 2], [3, 1]])).toBe(true)
  })

  it('drops double-click duplicates and an explicit closing vertex', () => {
    expect(dedupeVertices([[1, 1], [2, 2], [2, 2], [3, 1], [1, 1]])).toEqual([[1, 1], [2, 2], [3, 1]])
  })

  it('closes the ring exactly once through the existing geometry conversion', () => {
    const ring = dedupeVertices([[1, 1], [2, 2], [3, 1], [3, 1]])
    expect(polygonEwkt(ring)).toBe('SRID=4326;POLYGON((1 1, 2 2, 3 1, 1 1))')
  })
})
