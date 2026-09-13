import api, { friendlyError } from '../../services/api.js'
import { enqueueMutation, getPendingMutations } from './db.js'

export function generateOperationId(prefix = 'op') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export function isDeviceOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

/**
 * Executes a mutation if online, or queues it in IndexedDB if offline or on network failure.
 *
 * @param {Object} params
 * @param {string} params.userId - Authenticated user ID
 * @param {string} params.type - Semantic action type (e.g. 'BOOK_APPOINTMENT', 'SAVE_RECORD')
 * @param {string} params.endpoint - Relative API endpoint (e.g. '/appointments/book')
 * @param {string} [params.method='POST'] - HTTP verb
 * @param {Object|FormData} params.payload - Payload to submit
 * @param {Object} [params.headers] - Additional headers
 * @returns {Promise<{ success: boolean, online: boolean, queued: boolean, data?: any, clientOperationId: string }>}
 */
export async function queueOrExecute({
  userId,
  type,
  endpoint,
  method = 'POST',
  payload,
  headers = {}
}) {
  if (!userId) {
    throw new Error('User must be authenticated to queue or execute mutations')
  }

  const clientOperationId = generateOperationId(type.toLowerCase().slice(0, 6))

  // Serialize FormData or file attachments if present
  let serializablePayload = payload
  let hasAttachments = false

  if (payload instanceof FormData) {
    hasAttachments = true
    const entries = {}
    const files = []
    for (const [key, value] of payload.entries()) {
      if (value instanceof Blob || value instanceof File) {
        files.push({ key, blob: value, name: value.name, type: value.type })
      } else {
        entries[key] = value
      }
    }
    serializablePayload = { fields: entries, files }
  }

  const mutationRecord = {
    id: clientOperationId,
    clientOperationId,
    userId,
    type,
    endpoint,
    method: method.toUpperCase(),
    payload: serializablePayload,
    isFormData: hasAttachments,
    createdAt: Date.now(),
    retryCount: 0,
    status: 'pending'
  }

  // 1. If currently offline, queue immediately
  if (!isDeviceOnline()) {
    await enqueueMutation(mutationRecord)
    window.dispatchEvent(new CustomEvent('mutation:queued', { detail: mutationRecord }))
    return {
      success: true,
      online: false,
      queued: true,
      clientOperationId,
      message: 'Saved offline. Will synchronize automatically when connection is restored.'
    }
  }

  // 2. If online, attempt direct execution
  try {
    const requestHeaders = {
      ...headers,
      'X-Client-Operation-Id': clientOperationId
    }

    let response
    const httpMethod = method.toLowerCase()

    if (httpMethod === 'post') {
      response = await api.post(endpoint, payload, { headers: requestHeaders })
    } else if (httpMethod === 'put') {
      response = await api.put(endpoint, payload, { headers: requestHeaders })
    } else if (httpMethod === 'patch') {
      response = await api.patch(endpoint, payload, { headers: requestHeaders })
    } else if (httpMethod === 'delete') {
      response = await api.delete(endpoint, { data: payload, headers: requestHeaders })
    } else {
      response = await api.get(endpoint, { headers: requestHeaders })
    }

    return {
      success: true,
      online: true,
      queued: false,
      data: response.data,
      clientOperationId
    }
  } catch (err) {
    // Check if error is network failure (e.g. server unreachable, connection dropped during send)
    const isNetworkError =
      !err.response ||
      err.code === 'ERR_NETWORK' ||
      err.message === 'Network Error' ||
      err.response?.status >= 502

    if (isNetworkError) {
      console.warn('[Offline Queue] Network error encountered, queueing mutation offline:', err.message)
      await enqueueMutation(mutationRecord)
      window.dispatchEvent(new CustomEvent('mutation:queued', { detail: mutationRecord }))
      return {
        success: true,
        online: false,
        queued: true,
        clientOperationId,
        message: 'Network unreachable. Saved offline and queued for automatic sync.'
      }
    }

    // 4xx validation or business errors should NOT be queued — propagate to UI
    throw err
  }
}

export async function getPendingMutationCount(userId) {
  if (!userId) return 0
  const pending = await getPendingMutations(userId)
  return pending.length
}
