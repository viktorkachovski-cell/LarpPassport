import 'react-native-url-polyfill/auto'
import * as Sentry from '@sentry/react-native'
import { SENTRY_DSN } from './src/lib/config'

// init before anything else loads so boot crashes are captured
if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false })

import { registerRootComponent } from 'expo'
import './src/lib/locationTask'
import App from './App'

registerRootComponent(SENTRY_DSN ? Sentry.wrap(App) : App)
