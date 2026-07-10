import React from 'react'
import ReactDOM from 'react-dom/client'
import * as Sentry from '@sentry/react'
import { SENTRY_DSN } from './lib/config'
import App from './App'
import './styles.css'

if (SENTRY_DSN) Sentry.init({ dsn: SENTRY_DSN, sendDefaultPii: false })
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
