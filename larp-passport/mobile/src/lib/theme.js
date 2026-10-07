import { palette } from './brand'

// Colours come from the build's brand file (brand.pirate.js or brand.hunt.js).
export const C = palette

export const F = {
  displayMedium: 'ChakraPetch_500Medium',
  displaySemiBold: 'ChakraPetch_600SemiBold',
  displayBold: 'ChakraPetch_700Bold',
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemiBold: 'IBMPlexSans_600SemiBold',
  bodyBold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
}

// Type scale (logical px). Operational text never goes below `label`; only
// genuinely decorative kickers may use `micro`. Native font scaling stays on.
export const T = {
  micro: 11,
  label: 12,
  body: 14,
  bodyLarge: 15,
  button: 14,
  title: 20,
  hero: 26,
  lineBody: 20,
  lineLabel: 16,
}

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
