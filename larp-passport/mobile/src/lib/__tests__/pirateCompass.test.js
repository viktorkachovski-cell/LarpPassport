import { arcPath, bearingRangeLabel, smoothHeading } from '../pirateCompass'

describe('Pirate compass geometry', () => {
  it('formats ranges across the north seam', () => {
    expect(bearingRangeLabel(10, 45)).toBe('325°–055°')
    expect(bearingRangeLabel(47, 25)).toBe('022°–072°')
    expect(bearingRangeLabel(null, 25)).toBeNull()
  })

  it.each([5, 12, 25, 45, 90])('draws a bounded wedge at half-width %i', (width) => {
    const path = arcPath(359, width, 80)
    expect(path).toMatch(/^M 80 80 L .+ A 80 80 0 0 1 .+ Z$/)
    expect(path).not.toContain('NaN')
  })

  it('smooths through 359 to 1 by the short path', () => {
    expect(smoothHeading(359, 1, 0.25)).toBe(359.5)
    expect(smoothHeading(359, 1, 1)).toBe(361)
    expect(smoothHeading(1, 359, 1)).toBe(-1)
  })
})
