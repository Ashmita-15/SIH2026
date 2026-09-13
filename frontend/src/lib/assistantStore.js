/**
 * Transcript persistence. The old checker threw the whole exchange away on
 * reset, so a patient who closed the app lost what they had described —
 * expensive when it took two minutes to type on a feature phone.
 *
 * IndexedDB rather than localStorage because a transcript carries image
 * blobs, which would blow the 5MB string quota within a few turns.
 */

import { getDB, STORES, isIndexedDBAvailable } from './offline/db.js'

const STORE = STORES.ASSISTANT

function tx(mode, run) {
  return getDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

/** Private browsing and some in-app webviews block IndexedDB outright. */
const available = () => typeof indexedDB !== 'undefined'

export async function loadThread(userId) {
  if (!available() || !userId) return []
  try {
    const row = await tx('readonly', store => store.get(userId))
    return row?.messages || []
  } catch {
    return []
  }
}

export async function saveThread(userId, messages) {
  if (!available() || !userId) return
  try {
    await tx('readwrite', store => store.put({ userId, messages, updatedAt: Date.now() }))
  } catch {
    /* a transcript we cannot persist is still usable in memory */
  }
}

export async function clearThread(userId) {
  if (!available() || !userId) return
  try {
    await tx('readwrite', store => store.delete(userId))
  } catch {
    /* nothing to recover from */
  }
}
