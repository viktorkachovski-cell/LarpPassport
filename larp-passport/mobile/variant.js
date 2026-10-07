// The two player apps built from this project. APP_VARIANT is read at config
// and bundle time; Metro resolves `*.<variant>.js` before `*.js`, so the other
// game mode's screens never enter the bundle.
const VARIANTS = {
  // Keeps the original package ID, so it replaces an installed LARP Passport.
  pirate: { id: 'pirate', name: 'The Black Tide', androidPackage: 'com.larppassport.app' },
  hunt: { id: 'hunt', name: 'LARP Time Hunt', androidPackage: 'com.larppassport.timehunt' },
}

const id = process.env.APP_VARIANT || 'pirate'
if (!VARIANTS[id]) {
  throw new Error(`APP_VARIANT must be one of: ${Object.keys(VARIANTS).join(', ')} (got "${id}")`)
}

module.exports = { variant: VARIANTS[id] }
