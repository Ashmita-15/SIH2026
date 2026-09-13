import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { syncNow, subscribeSyncStatus, SYNC_STATUS } from '../../lib/offline/syncManager.js'
import { getPendingMutations } from '../../lib/offline/db.js'
import { useAuth } from '../../context/AuthContext.jsx'

export default function NetworkStatusBanner() {
  const { t } = useTranslation()
  const { userId } = useAuth()

  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))
  const [syncStatus, setSyncStatus] = useState(SYNC_STATUS.IDLE)
  const [pendingCount, setPendingCount] = useState(0)
  const [dismissedOffline, setDismissedOffline] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)

  // Refresh pending count
  const refreshPendingCount = async () => {
    try {
      const items = await getPendingMutations(userId)
      setPendingCount(items.length)
    } catch {
      setPendingCount(0)
    }
  }

  useEffect(() => {
    refreshPendingCount()

    const handleOnline = () => {
      setIsOnline(true)
      setDismissedOffline(false)
      refreshPendingCount()
    }

    const handleOffline = () => {
      setIsOnline(false)
      setDismissedOffline(false)
      refreshPendingCount()
    }

    const handleMutationQueued = () => {
      refreshPendingCount()
    }

    const handleItemSynced = () => {
      refreshPendingCount()
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('mutation:queued', handleMutationQueued)
    window.addEventListener('sync:item-synced', handleItemSynced)

    const unsubscribe = subscribeSyncStatus((status, details) => {
      setSyncStatus(status)
      if (details?.pendingCount !== undefined) {
        setPendingCount(details.pendingCount)
      } else {
        refreshPendingCount()
      }

      if (status === SYNC_STATUS.SUCCESS && details?.successCount > 0) {
        setShowSuccessToast(true)
        const timer = setTimeout(() => setShowSuccessToast(false), 3500)
        return () => clearTimeout(timer)
      }
    })

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('mutation:queued', handleMutationQueued)
      window.removeEventListener('sync:item-synced', handleItemSynced)
      unsubscribe()
    }
  }, [userId])

  // Nothing to display if online and idle with no active success toast or error
  if (isOnline && syncStatus === SYNC_STATUS.IDLE && !showSuccessToast) {
    return null
  }

  // If user explicitly dismissed the offline banner in this session, keep it minimal
  if (!isOnline && dismissedOffline && pendingCount === 0) {
    return (
      <aside aria-label="Offline status pill" className="fixed bottom-3 right-3 z-50">
        <button
          onClick={() => setDismissedOffline(false)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-caption font-medium bg-amber-100 border border-amber-300 text-amber-900 shadow-rest hover:bg-amber-200 transition-colors"
          title="Click to view offline details"
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>Offline</span>
        </button>
      </aside>
    )
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md z-50 transition-all duration-300 transform translate-y-0"
    >
      {/* 1. OFFLINE STATE */}
      {!isOnline && (
        <div className="rounded-card border border-amber-200 bg-amber-50 p-3.5 shadow-raised text-small text-amber-900 flex items-start gap-3">
          <div className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber-200 text-amber-800 flex items-center justify-center font-bold text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">You are offline</p>
            <p className="text-caption text-amber-800 mt-0.5 leading-relaxed">
              Supported changes (bookings, clinical records, encounters) will be saved and synchronized when internet returns.
            </p>
            {pendingCount > 0 && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium bg-amber-200/80 text-amber-900">
                <span>{pendingCount}</span>
                <span>{pendingCount === 1 ? 'change waiting to sync' : 'changes waiting to sync'}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setDismissedOffline(true)}
            className="text-amber-700 hover:text-amber-900 p-1 -mr-1 -mt-1 rounded focus:outline-none"
            aria-label="Dismiss offline banner"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 2. SYNCING IN PROGRESS */}
      {isOnline && syncStatus === SYNC_STATUS.SYNCING && (
        <div className="rounded-card border border-primary-200 bg-primary-50 p-3.5 shadow-raised text-small text-primary-900 flex items-center gap-3 animate-fade-in">
          <div className="w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-primary-900">Back online</p>
            <p className="text-caption text-primary-700">Synchronizing your offline changes...</p>
          </div>
        </div>
      )}

      {/* 3. SYNC SUCCESS STATE */}
      {isOnline && showSuccessToast && syncStatus !== SYNC_STATUS.SYNCING && (
        <div className="rounded-card border border-emerald-200 bg-emerald-50 p-3.5 shadow-raised text-small text-emerald-900 flex items-center gap-3 animate-fade-in">
          <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-xs shrink-0">
            ✓
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-emerald-900">All changes synchronized</p>
            <p className="text-caption text-emerald-700">Your records are now up to date with the server.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowSuccessToast(false)}
            className="text-emerald-700 hover:text-emerald-900 p-1 -mr-1 rounded"
          >
            ×
          </button>
        </div>
      )}

      {/* 4. SYNC ERROR / RETRY STATE */}
      {isOnline && syncStatus === SYNC_STATUS.ERROR && (
        <div className="rounded-card border border-rose-200 bg-rose-50 p-3.5 shadow-raised text-small text-rose-900 flex items-start gap-3">
          <div className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-rose-200 text-rose-800 flex items-center justify-center font-bold text-xs">
            !
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-ink">Sync problem</p>
            <p className="text-caption text-rose-800 mt-0.5">
              Some changes could not be synchronized automatically.
            </p>
            <button
              type="button"
              onClick={() => syncNow()}
              className="mt-2 text-caption font-semibold px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-control shadow-sm transition-colors"
            >
              Retry Sync Now
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
