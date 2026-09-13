import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { updateSW } from '../../pwaRegister.js'

export default function UpdatePrompt() {
  const { t } = useTranslation()
  const [needRefresh, setNeedRefresh] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  useEffect(() => {
    const handleNeedRefresh = (event) => {
      // Do not interrupt during active video consultation
      const inConsultation = Boolean(document.querySelector('[data-active-consultation="true"]'))
      if (inConsultation) {
        console.log('[PWA Update] Active consultation detected, delaying update prompt until call completes.')
        return
      }
      setNeedRefresh(true)
    }

    window.addEventListener('pwa:need-refresh', handleNeedRefresh)
    return () => window.removeEventListener('pwa:need-refresh', handleNeedRefresh)
  }, [])

  const handleUpdate = () => {
    setIsUpdating(true)
    try {
      updateSW()
    } catch (err) {
      console.error('[PWA Update] Failed to update service worker:', err)
      window.location.reload()
    }
  }

  if (!needRefresh) return null

  return (
    <aside
      role="alert"
      aria-live="assertive"
      className="fixed top-4 left-1/2 -translate-x-1/2 w-[92%] sm:w-auto sm:min-w-[360px] z-[100] animate-bounce-short"
    >
      <div className="rounded-card border border-primary-300 bg-surface p-3 sm:p-4 shadow-lifted flex items-center justify-between gap-3 text-small">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-ink truncate">Update available</p>
            <p className="text-caption text-muted truncate">A new version of GramSathi is ready.</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleUpdate}
            disabled={isUpdating}
            className="btn btn-primary btn-sm font-medium whitespace-nowrap"
          >
            {isUpdating ? 'Updating…' : 'Update now'}
          </button>
          <button
            type="button"
            onClick={() => setNeedRefresh(false)}
            className="p-1.5 text-muted hover:text-ink rounded"
            aria-label="Dismiss update notification"
          >
            ×
          </button>
        </div>
      </div>
    </aside>
  )
}
