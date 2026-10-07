import { fonts, palette, typeScale } from './brand'

// Colours come from the build's brand file (brand.pirate.js or brand.hunt.js).
export const C = palette

// Fonts and type scale also come from the brand file, so each app carries
// only its own faces.
export const F = fonts
export const T = typeScale

// Text colour for a status tone from the syncStatus describers.
export function toneColor(tone) {
  if (tone === 'ok') return C.green
  if (tone === 'error') return C.red
  if (tone === 'warning') return C.amber
  return C.muted
}

// Spacing and touch-target minimums.
export const S = {
  touch: 48,
  gap: 8,
  pad: 14,
}
