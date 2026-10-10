// Pirate app identity ("The Black Tide": wood, parchment and brass). Its
// counterpart is brand.hunt.js; Metro picks one per build (see variant.js).
// Values come from The Black Tide design system.

import { phaseName } from '../pirate/phases'

// Two themes with the same token names: `deck` (daylight parchment) and
// `lantern` (night: dark vellum, so the sheet never glares). Chosen once at
// launch from the phone's light/dark setting.
const DECK = {
  // Wood, brass and parchment tokens used by the pirate screens.
  wood900: '#1C120A',
  wood800: '#2B1C10',
  wood700: '#3D2816',
  wood600: '#563A20',
  woodSeam: '#140C06',
  brass: '#C9A23F',
  brassLight: '#ECD58C',
  brassDeep: '#7A5B1E',
  onWood: '#F3E4BF',
  onWoodMuted: '#C9B28A',
  sheet: '#F1E4BF',
  sheetShade: '#E2CF9C',
  sheetEdge: '#B08A4E',
  sheetRule: '#CBB68A',
  sheetInk: '#2A1B0E',
  sheetMuted: '#5F4A2E',
  tide: '#335F30',
  tideInk: '#2F5F2C',
  blood: '#8B2A1C',
  bloodFill: '#7A2416',
  lamp: '#8A5A12',
  lampGlow: '#E8A33A',
  sea: '#275F66',

  // Shared keys read by the screens both apps use (sign-in, games list,
  // character, events, sharing): dark wood surfaces with brass signals.
  ink: '#2B1C10',
  panel: '#3D2816',
  panel2: '#563A20',
  line: '#7A5B1E',
  lineStrong: '#B08F45', // 4.5:1 on panel: input and button boundaries
  text: '#F3E4BF',
  muted: '#D2BC94',
  cyan: '#D9B24F', // the brass signal: primary buttons, kickers, focus
  cyanBorder: '#7A5B1E',
  orange: '#E8A33A',
  orangeBright: '#F5C27A',
  amber: '#F0B45A',
  amberBorder: '#8A5A12',
  red: '#F0806C',
  redBorder: '#7A2416',
  green: '#A6D696',
  greenBorder: '#335F30',
}

const LANTERN = {
  wood900: '#0F0A06',
  wood800: '#19110A',
  wood700: '#24180D',
  wood600: '#352312',
  woodSeam: '#070403',
  brass: '#B08A38',
  brassLight: '#D6BC76',
  brassDeep: '#5E4517',
  onWood: '#E6D4A8',
  onWoodMuted: '#A8936C',
  sheet: '#231A10',
  sheetShade: '#2C2115',
  sheetEdge: '#120C06',
  sheetRule: '#46371F',
  sheetInk: '#EAD9B0',
  sheetMuted: '#B39F7A',
  tide: '#2C5428',
  tideInk: '#9FCF8F',
  blood: '#E0725F',
  bloodFill: '#6E2014',
  lamp: '#E8B25A',
  lampGlow: '#E8A33A',
  sea: '#7FBFC4',

  ink: '#19110A',
  panel: '#24180D',
  panel2: '#352312',
  line: '#5E4517',
  lineStrong: '#9A7A35',
  text: '#E6D4A8',
  muted: '#B8A27A',
  cyan: '#C9A446',
  cyanBorder: '#5E4517',
  orange: '#E8A33A',
  orangeBright: '#EFBB72',
  amber: '#E8B25A',
  amberBorder: '#8A5A12',
  red: '#E0725F',
  redBorder: '#6E2014',
  green: '#9FCF8F',
  greenBorder: '#2C5428',
}

// Read the phone's colour scheme without importing react-native, so plain
// Node (the Jest suite) can load this file.
function phoneScheme() {
  if (typeof navigator === 'undefined' || navigator.product !== 'ReactNative') return 'light'
  try {
    return require('react-native').Appearance.getColorScheme() ?? 'light'
  } catch {
    return 'light'
  }
}

export const themeName = phoneScheme() === 'dark' ? 'lantern' : 'deck'
export const palette = themeName === 'lantern' ? LANTERN : DECK

// Font roles. `display*` and `mono*` are the label voice (IM Fell English SC),
// `body*` the reading face (Alegreya Sans), `blackletter` names only.
export const fonts = {
  displayMedium: 'IMFellEnglishSC_400Regular',
  displaySemiBold: 'IMFellEnglishSC_400Regular',
  displayBold: 'IMFellEnglishSC_400Regular',
  body: 'AlegreyaSans_400Regular',
  bodyMedium: 'AlegreyaSans_500Medium',
  bodySemiBold: 'AlegreyaSans_700Bold',
  bodyBold: 'AlegreyaSans_700Bold',
  mono: 'IMFellEnglishSC_400Regular',
  monoMedium: 'IMFellEnglishSC_400Regular',
  monoSemiBold: 'IMFellEnglishSC_400Regular',
  numeric: 'AlegreyaSans_700Bold',
  blackletter: 'PirataOne_400Regular',
}

// Read outdoors, walking, at night: one step larger than the Time Hunt scale.
export const typeScale = {
  micro: 13,
  label: 14,
  body: 16,
  bodyLarge: 17,
  button: 17,
  title: 24,
  hero: 30,
  lineBody: 23,
  lineLabel: 18,
}

// The Admiralty is the GM in this fiction, so player screens carry no eyebrow.
export const EYEBROW = ''
// The sharing card already states the retention period once.
export const SHARING_FOOTNOTE = ''

// Pirate games carry a phase; ordinary and Time Hunt games belong to the other app.
export const ownsGame = (game) => !!game.phase
export const OTHER_APP = 'LARP Time Hunt'

const GAME_STATUS = { draft: 'Not started', active: 'Under way', finished: 'Over' }

// Player-facing wording and small layout choices the shared screens read.
// System status stays quiet unless something is wrong.
export const COPY = {
  booting: 'Loading…',
  loadingGame: 'Loading the game…',
  auth: {
    eyebrow: '',
    title: 'The Black Tide',
    tagline: 'Sign in to join your crew',
    signinKicker: '',
    signupKicker: '',
    emailPlaceholder: 'you@example.com',
    submitSignin: 'Sign in',
    submitSignup: 'Create account',
    busySignin: 'Signing in…',
    busySignup: 'Creating account…',
    footer: '',
  },
  games: {
    eyebrow: '',
    title: 'Your games',
    section: '',
    showCount: false,
    decor: false,
    quietSync: true,
    autoOpenSingle: true,
    status: (game) => {
      const status = GAME_STATUS[game.status] ?? 'Waiting'
      return game.status === 'active' && game.phase ? `${status} · ${phaseName(game.phase).long}` : status
    },
  },
  character: {
    createKicker: 'Your pirate',
    createTitle: 'Name your pirate',
    namePlaceholder: 'Pirate name',
    bioPlaceholder: 'One line about your pirate',
    gmStatsCaption: '',
    lockedLabel: 'SET BY THE GM',
    editLabel: 'YOURS TO EDIT',
    createButton: 'Save your pirate',
    creatingButton: 'Saving…',
  },
  log: {
    messageCaption: 'Only the GMs see this.',
    // Silent sites never reach the player; a notify site carries the GM's lore.
    hiddenTypes: ['zone_exit', 'consent_granted', 'consent_revoked'],
    zoneEnter: {
      tag: { label: 'LORE', color: palette.amber, borderColor: palette.amberBorder },
      title: 'A tale on the tide',
      notification: 'A tale on the tide',
    },
    showReasons: true,
  },
  sharing: { collapseDetails: true },
}
