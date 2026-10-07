const { variant } = require('./variant')

module.exports = ({ config }) => ({
  ...config,
  name: variant.name,
  android: { ...config.android, package: variant.androidPackage },
  extra: { ...config.extra, variant: variant.id },
})
