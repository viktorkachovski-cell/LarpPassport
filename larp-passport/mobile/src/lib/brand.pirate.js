// Pirate app identity. Its counterpart is brand.hunt.js; Metro picks one per
// build (see variant.js).
export const palette = {
  ink: '#0D1C24',
  panel: '#142A32',
  panel2: '#1E3540',
  line: '#48636A',
  lineStrong: '#83A6A5',
  text: '#F4E8CB',
  muted: '#C8C6B3',
  cyan: '#80DDD0',
  cyanBorder: '#5C9993',
  orange: '#F3AF69',
  orangeBright: '#FFC482',
  amber: '#FFD080',
  amberBorder: '#A57C42',
  red: '#FF8279',
  redBorder: '#B35D57',
  green: '#96D9A7',
  greenBorder: '#59956D',
}

export const EYEBROW = 'THE ADMIRALTY'
export const SHARING_FOOTNOTE = 'Location sharing is voluntary. History follows the retention period above.'

// Pirate games carry a phase; ordinary and Time Hunt games belong to the other app.
export const ownsGame = (game) => !!game.phase
export const OTHER_APP = 'LARP Time Hunt'
