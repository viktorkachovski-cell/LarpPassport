const { variant } = require('./variant')

// The Black Tide carries its own compass icon set and follows the phone's
// light/dark setting (deck by day, lantern by night; see brand.pirate.js).
// Time Hunt keeps app.json as it is.
const PIRATE = {
  icon: './assets/pirate/icon.png',
  userInterfaceStyle: 'automatic',
  backgroundColor: '#1C120A',
  adaptiveIcon: {
    foregroundImage: './assets/pirate/adaptive-icon.png',
    backgroundImage: './assets/pirate/adaptive-background.png',
    monochromeImage: './assets/pirate/adaptive-monochrome.png',
    backgroundColor: '#1C120A',
  },
  notificationIcon: ['expo-notifications', { icon: './assets/pirate/notification-icon.png', color: '#C9A23F' }],
}

module.exports = ({ config }) => {
  const base = {
    ...config,
    name: variant.name,
    android: { ...config.android, package: variant.androidPackage },
    extra: { ...config.extra, variant: variant.id },
  }
  if (variant.id !== 'pirate') return base
  return {
    ...base,
    icon: PIRATE.icon,
    userInterfaceStyle: PIRATE.userInterfaceStyle,
    backgroundColor: PIRATE.backgroundColor,
    android: { ...base.android, adaptiveIcon: PIRATE.adaptiveIcon },
    plugins: (config.plugins ?? []).map((plugin) => (plugin === 'expo-notifications' ? PIRATE.notificationIcon : plugin)),
  }
}
