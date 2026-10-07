const { getDefaultConfig } = require('expo/metro-config')
const { variant } = require('./variant')

const config = getDefaultConfig(__dirname)
config.resolver.sourceExts = [`${variant.id}.js`, ...config.resolver.sourceExts]

module.exports = config
