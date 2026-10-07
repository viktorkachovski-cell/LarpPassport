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

export const EYEBROW = 'TEMPORAL FIELD AUTHORITY'
export const SHARING_FOOTNOTE = 'Sharing stops and your map position is removed on elimination. History follows the retention period above.'

// Pirate games carry a phase; this app plays every other game.
export const ownsGame = (game) => !game.phase
export const OTHER_APP = 'The Black Tide'
