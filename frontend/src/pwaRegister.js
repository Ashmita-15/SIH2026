import { registerSW } from 'virtual:pwa-register'

let updateServiceWorker = null

export const updateSW = () => {
  if (typeof updateServiceWorker === 'function') {
    updateServiceWorker(true)
  }
}

export function initPWA() {
  if ('serviceWorker' in navigator) {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        console.log('[PWA] New GramSathi version detected, update available.')
        window.dispatchEvent(new CustomEvent('pwa:need-refresh', {
          detail: { updateSW: () => updateServiceWorker?.(true) }
        }))
      },
      onOfflineReady() {
        console.log('[PWA] GramSathi is cached and ready to work offline.')
        window.dispatchEvent(new CustomEvent('pwa:offline-ready'))
      },
      onRegistered(registration) {
        console.log('[PWA] Service worker registered successfully:', registration?.scope)
        // Periodically check for updates every 60 minutes
        if (registration) {
          setInterval(() => {
            registration.update().catch(err => console.debug('[PWA] Auto-update check skipped:', err))
          }, 60 * 60 * 1000)
        }
      },
      onRegisterError(error) {
        console.error('[PWA] Service worker registration failed:', error)
      }
    })
  }
}

// Auto-initialize when imported
initPWA()
