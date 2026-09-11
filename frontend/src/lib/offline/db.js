/**
 * IndexedDB persistence layer for GramSathi.
 *
 * Provides isolated, user-scoped offline storage for:
 * - Assistant chat threads (preserving v1 store)
 * - User-scoped resource cache (appointments, patient records, profile)
 * - Offline mutation queue (safe Category B operations to be synchronized)
 * - Sync metadata
 *
 * SECURITY:
 * All cached data is indexed by userId.
 * On logout, clearAllUserData(userId) ensures no data leaks across shared rural devices.
 * Passwords, tokens, and backend secrets are NEVER written here.
 */

const DB_NAME = 'gramsathi'
const DB_VERSION = 2

export const STORES = {
  ASSISTANT: 'assistant-threads',
  USER_CACHE: 'userCache',
  MUTATION_QUEUE: 'mutationQueue',
  SYNC_METADATA: 'syncMetadata'
}

let dbPromise = null

export function isIndexedDBAvailable() {
  return typeof indexedDB !== 'undefined'
}

export function getDB() {
  if (!isIndexedDBAvailable()) {
    return Promise.reject(new Error('IndexedDB not supported in this environment'))
  }
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = (event) => {
      const db = req.result
      const oldVersion = event.oldVersion

      // V1: Assistant transcripts
      if (!db.objectStoreNames.contains(STORES.ASSISTANT)) {
        db.createObjectStore(STORES.ASSISTANT, { keyPath: 'userId' })
      }

      // V2: Offline-first stores
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORES.USER_CACHE)) {
          const cacheStore = db.createObjectStore(STORES.USER_CACHE, { keyPath: 'id' })
          cacheStore.createIndex('userId', 'userId', { unique: false })
          cacheStore.createIndex('resource', 'resource', { unique: false })
        }

        if (!db.objectStoreNames.contains(STORES.MUTATION_QUEUE)) {
          const queueStore = db.createObjectStore(STORES.MUTATION_QUEUE, { keyPath: 'id' })
          queueStore.createIndex('userId', 'userId', { unique: false })
          queueStore.createIndex('status', 'status', { unique: false })
          queueStore.createIndex('createdAt', 'createdAt', { unique: false })
        }

        if (!db.objectStoreNames.contains(STORES.SYNC_METADATA)) {
          db.createObjectStore(STORES.SYNC_METADATA, { keyPath: 'key' })
        }
      }
    }

    req.onsuccess = () => {
      const db = req.result
      db.onclose = () => {
        dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })

  return dbPromise
}

export function resetDBConnection() {
  dbPromise = null
}

function runTx(storeName, mode, callback) {
  return getDB().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const store = tx.objectStore(storeName)
      let result = null

      try {
        result = callback(store, tx)
      } catch (err) {
        reject(err)
        return
      }

      tx.oncomplete = () => resolve(result?.result ?? result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(new Error('Transaction aborted'))
    })
  })
}

// ─── USER CACHE (ISOLATED BY USER ID) ─────────────────────────────────────────

export async function cacheUserData(userId, resource, data) {
  if (!userId || !resource || data === undefined) return
  const record = {
    id: `${userId}:${resource}`,
    userId,
    resource,
    data,
    cachedAt: Date.now()
  }
  return runTx(STORES.USER_CACHE, 'readwrite', (store) => {
    return store.put(record)
  })
}

export async function getCachedUserData(userId, resource) {
  if (!userId || !resource) return null
  try {
    const record = await runTx(STORES.USER_CACHE, 'readonly', (store) => {
      const req = store.get(`${userId}:${resource}`)
      return new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result?.data ?? null)
        req.onerror = () => resolve(null)
      })
    })
    return record
  } catch {
    return null
  }
}

export async function clearUserCache(userId) {
  if (!userId) return
  return runTx(STORES.USER_CACHE, 'readwrite', (store) => {
    const index = store.index('userId')
    const req = index.openCursor(IDBKeyRange.only(userId))
    req.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
  })
}

// ─── MUTATION QUEUE ───────────────────────────────────────────────────────────

export async function enqueueMutation(mutation) {
  if (!mutation?.id || !mutation?.userId) {
    throw new Error('Invalid mutation record: id and userId required')
  }
  const entry = {
    ...mutation,
    status: mutation.status || 'pending',
    retryCount: mutation.retryCount || 0,
    createdAt: mutation.createdAt || Date.now()
  }
  await runTx(STORES.MUTATION_QUEUE, 'readwrite', (store) => store.put(entry))
  return entry
}

export async function getPendingMutations(userId = null) {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.MUTATION_QUEUE, 'readonly')
      const store = tx.objectStore(STORES.MUTATION_QUEUE)
      const results = []

      let req
      if (userId) {
        const index = store.index('userId')
        req = index.openCursor(IDBKeyRange.only(userId))
      } else {
        req = store.openCursor()
      }

      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor) {
          if (cursor.value.status === 'pending' || cursor.value.status === 'syncing') {
            results.push(cursor.value)
          }
          cursor.continue()
        } else {
          // Sort oldest first
          results.sort((a, b) => a.createdAt - b.createdAt)
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.error('[IndexedDB] Failed to load pending mutations:', err)
    return []
  }
}

export async function getAllMutations(userId = null) {
  try {
    const db = await getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.MUTATION_QUEUE, 'readonly')
      const store = tx.objectStore(STORES.MUTATION_QUEUE)
      const results = []

      let req
      if (userId) {
        const index = store.index('userId')
        req = index.openCursor(IDBKeyRange.only(userId))
      } else {
        req = store.openCursor()
      }

      req.onsuccess = (e) => {
        const cursor = e.target.result
        if (cursor) {
          results.push(cursor.value)
          cursor.continue()
        } else {
          results.sort((a, b) => a.createdAt - b.createdAt)
          resolve(results)
        }
      }
      req.onerror = () => reject(req.error)
    })
  } catch (err) {
    console.error('[IndexedDB] Failed to load all mutations:', err)
    return []
  }
}

export async function updateMutation(id, patch) {
  if (!id) return
  return runTx(STORES.MUTATION_QUEUE, 'readwrite', (store) => {
    const req = store.get(id)
    req.onsuccess = () => {
      const current = req.result
      if (current) {
        store.put({ ...current, ...patch, updatedAt: Date.now() })
      }
    }
  })
}

export async function removeMutation(id) {
  if (!id) return
  return runTx(STORES.MUTATION_QUEUE, 'readwrite', (store) => store.delete(id))
}

export async function clearUserMutations(userId) {
  if (!userId) return
  return runTx(STORES.MUTATION_QUEUE, 'readwrite', (store) => {
    const index = store.index('userId')
    const req = index.openCursor(IDBKeyRange.only(userId))
    req.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) {
        cursor.delete()
        cursor.continue()
      }
    }
  })
}

// ─── SYNC METADATA ────────────────────────────────────────────────────────────

export async function setSyncMeta(key, value) {
  if (!key) return
  return runTx(STORES.SYNC_METADATA, 'readwrite', (store) => {
    return store.put({ key, value, updatedAt: Date.now() })
  })
}

export async function getSyncMeta(key) {
  if (!key) return null
  try {
    const res = await runTx(STORES.SYNC_METADATA, 'readonly', (store) => {
      const req = store.get(key)
      return new Promise((resolve) => {
        req.onsuccess = () => resolve(req.result?.value ?? null)
        req.onerror = () => resolve(null)
      })
    })
    return res
  } catch {
    return null
  }
}

// ─── COMPLETE USER ISOLATION / PURGE (FOR LOGOUT) ─────────────────────────────

export async function clearAllUserData(userId) {
  if (!userId) return
  try {
    await clearUserCache(userId)
    await clearUserMutations(userId)

    // Clear assistant transcripts
    await runTx(STORES.ASSISTANT, 'readwrite', (store) => store.delete(userId))
    console.log(`[IndexedDB] Cleared all local data for user ${userId}`)
  } catch (err) {
    console.error(`[IndexedDB] Error clearing data for user ${userId}:`, err)
  }
}
