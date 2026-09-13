import './polyfills.js'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { ToastProvider } from './components/ui/Toast.jsx'
import './styles/tailwind.css'
import './translations/i18n.js'
import './pwaRegister.js'
import { initSyncManager } from './lib/offline/syncManager.js'

initSyncManager()

const root = createRoot(document.getElementById('root'))
root.render(
  <ErrorBoundary>
    <HashRouter future={{ v7_relativeSplatPath: true }}>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </HashRouter>
  </ErrorBoundary>
)
