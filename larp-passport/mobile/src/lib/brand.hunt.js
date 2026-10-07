// Time Hunt app identity. Its counterpart is brand.pirate.js; Metro picks one
// per build (see variant.js).
export const palette = {
  ink: '#0A0E15',
  panel: '#131A26',
  panel2: '#1B2434',
  line: '#34435C',
  lineStrong: '#5B6F93', // 3.4:1 on panel: input and button boundaries
  text: '#EDF2FA',
  muted: '#9DACC4',
  cyan: '#47D6F0',
  cyanBorder: '#2C6B7C',
  orange: '#FF7A33',
  orangeBright: '#FF9A5C',
  amber: '#FFB020',
  amberBorder: '#6B5121',
  red: '#FF5449',
  redBorder: '#7C3A34',
  green: '#3FD68F',
  greenBorder: '#2B6B4F',
}

export const themeName = 'hunt'

export const fonts = {
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
  numeric: 'ChakraPetch_700Bold',
  blackletter: 'ChakraPetch_700Bold',
}

// Type scale (logical px). Operational text never goes below `label`; only
// genuinely decorative kickers may use `micro`. Native font scaling stays on.
export const typeScale = {
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

export const EYEBROW = 'TEMPORAL FIELD AUTHORITY'
export const SHARING_FOOTNOTE = 'Sharing stops and your map position is removed on elimination. History follows the retention period above.'

// Pirate games carry a phase; this app plays every other game.
export const ownsGame = (game) => !game.phase
export const OTHER_APP = 'The Black Tide'
