import api, { friendlyError } from '../../services/api.js'
import {
  getPendingMutations,
  updateMutation,
  removeMutation,
  setSyncMeta,
  getSyncMeta
} from './db.js'

export const SYNC_STATUS = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  ERROR: 'error',
  SUCCESS: 'success'
}

const MAX_RETRIES = 3

let currentStatus = SYNC_STATUS.IDLE
let isSyncInProgress = false
let syncListeners = new Set()

export function getSyncStatus() {
  return currentStatus
}

export function subscribeSyncStatus(listener) {
  syncListeners.add(listener)
  listener(currentStatus)
  return () => syncListeners.delete(listener)
}

function notifyStatus(status, details = {}) {
  currentStatus = status
  for (const listener of syncListeners) {
    try {
      listener(status, details)
    } catch (err) {
      console.error('[SyncManager] Listener error:', err)
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('sync:status-changed', { detail: { status, ...details } })
    )
  }
}

/**
 * Reconstructs FormData when a mutation includes attachments.
 */
function reconstructPayload(mutation) {
  if (!mutation.isFormData || !mutation.payload) {
    return mutation.payload
  }

  const { fields = {}, files = [] } = mutation.payload
  const formData = new FormData()

  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value)
  }

  for (const file of files) {
    if (file.blob) {
      formData.append(file.key || 'attachments', file.blob, file.name || 'attachment')
    }
  }

  return formData
}

/**
 * Processes all pending mutations in FIFO order.
 * Prevents concurrent runs to avoid duplicate execution.
 */
export async function processQueue(userId = null) {
  if (isSyncInProgress) {
    console.debug('[SyncManager] Sync already in progress, skipping duplicate call.')
    return { skipped: true, reason: 'in_progress' }
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    console.debug('[SyncManager] Device is offline, skipping sync.')
    notifyStatus(SYNC_STATUS.IDLE, { pendingCount: 0 })
    return { skipped: true, reason: 'offline' }
  }

  isSyncInProgress = true
  notifyStatus(SYNC_STATUS.SYNCING)

  let successCount = 0
  let errorCount = 0

  try {
    const queue = await getPendingMutations(userId)

    if (!queue || queue.length === 0) {
      notifyStatus(SYNC_STATUS.IDLE, { pendingCount: 0 })
      await setSyncMeta('lastSyncTimestamp', Date.now())
      return { success: true, processed: 0 }
    }

    console.log(`[SyncManager] Processing ${queue.length} pending mutations...`)

    for (const mutation of queue) {
      // If mutation was permanently flagged as non-retriable, skip automatic retry
      if (mutation.nonRetriable) {
        errorCount++
        continue
      }

      await updateMutation(mutation.id, { status: 'syncing' })

      try {
        const payload = reconstructPayload(mutation)
        const headers = {
          'X-Client-Operation-Id': mutation.clientOperationId,
          ...(mutation.headers || {})
        }

        const method = mutation.method.toLowerCase()
        let res

        if (method === 'post') {
          res = await api.post(mutation.endpoint, payload, { headers })
        } else if (method === 'put') {
          res = await api.put(mutation.endpoint, payload, { headers })
        } else if (method === 'patch') {
          res = await api.patch(mutation.endpoint, payload, { headers })
        } else if (method === 'delete') {
          res = await api.delete(mutation.endpoint, { data: payload, headers })
        } else {
          res = await api.get(mutation.endpoint, { headers })
        }

        // Successfully executed on server
        await removeMutation(mutation.id)
        successCount++

        console.log(`[SyncManager] Successfully synced mutation ${mutation.id} (${mutation.type})`)

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('sync:item-synced', { detail: { mutation, data: res.data } })
          )
          // Notify any listening views (e.g. appointments list) to refresh data
          if (mutation.type === 'BOOK_APPOINTMENT' || mutation.type?.startsWith('APPOINTMENT_')) {
            window.dispatchEvent(new CustomEvent('appointments:changed'))
          }
        }
      } catch (err) {
        errorCount++
        const status = err.response?.status
        const message = friendlyError(err)

        console.warn(`[SyncManager] Error syncing mutation ${mutation.id}:`, err.message)

        // 1. 401 Unauthorized — stop processing until re-login
        if (status === 401) {
          await updateMutation(mutation.id, {
            status: 'pending',
            lastError: 'Session expired'
          })
          notifyStatus(SYNC_STATUS.ERROR, { error: 'Session expired. Please sign in to sync.' })
          return { success: false, reason: 'unauthorized' }
        }

        // 2. 409 Conflict (e.g. slot taken)
        if (status === 409) {
          await updateMutation(mutation.id, {
            status: 'failed',
            nonRetriable: true,
            lastError: 'This appointment slot or session is no longer available.',
            resolvedAt: Date.now()
          })
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('sync:conflict', { detail: { mutation, error: message } })
            )
          }
          continue
        }

        // 3. 400 / 422 Client Validation Error — Non-retriable, do not loop forever
        if (status >= 400 && status < 500) {
          await updateMutation(mutation.id, {
            status: 'failed',
            nonRetriable: true,
            lastError: message,
            resolvedAt: Date.now()
          })
          continue
        }

        // 4. Temporary Network Error or 5xx Server Error — Exponential backoff retry
        const nextRetry = (mutation.retryCount || 0) + 1
        if (nextRetry >= MAX_RETRIES) {
          await updateMutation(mutation.id, {
            status: 'failed',
            retryCount: nextRetry,
            lastError: 'Server unavailable after maximum retries. Please retry manually.'
          })
        } else {
          await updateMutation(mutation.id, {
            status: 'pending',
            retryCount: nextRetry,
            lastError: message
          })
          // Backoff pause before next item if server is struggling
          const delayMs = Math.min(1000 * Math.pow(2, nextRetry), 8000)
          await new Promise((r) => setTimeout(r, delayMs))
        }
      }
    }

    await setSyncMeta('lastSyncTimestamp', Date.now())

    const remaining = await getPendingMutations(userId)
    const finalStatus = errorCount > 0 && remaining.length > 0 ? SYNC_STATUS.ERROR : SYNC_STATUS.SUCCESS
    notifyStatus(finalStatus, {
      successCount,
      errorCount,
      pendingCount: remaining.length
    })

    // Reset to idle after 4 seconds
    setTimeout(() => {
      if (currentStatus === SYNC_STATUS.SUCCESS) {
        notifyStatus(SYNC_STATUS.IDLE, { pendingCount: remaining.length })
      }
    }, 4000)

    return { success: true, processed: successCount, errors: errorCount }
  } finally {
    isSyncInProgress = false
  }
}

/**
 * Initializes listeners for online/offline events.
 */
export function initSyncManager() {
  if (typeof window === 'undefined') return

  // Sync automatically when network returns
  window.addEventListener('online', () => {
    console.log('[SyncManager] Network restored (online event). Initiating sync...')
    processQueue().catch((err) => console.error('[SyncManager] Online sync failed:', err))
  })

  // Also sync on window focus if online
  window.addEventListener('focus', () => {
    if (navigator.onLine) {
      processQueue().catch(() => {})
    }
  })

  // Initial trigger on startup
  if (navigator.onLine) {
    setTimeout(() => {
      processQueue().catch(() => {})
    }, 2000)
  }
}

export function syncNow() {
  return processQueue()
}
