import type { ImportSession } from '../domain/import-session'
import { normalizeDraftOptionsAndKey } from '../domain/import-session'

const DB_NAME = 'jee_cbt_importer_cache'
const DB_VERSION = 1
const STORE_NAME = 'session_store'
const LOCAL_STORAGE_KEY = 'jee_cbt_active_import_session_meta'

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported in this environment.'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export interface CachedImportData {
  session: ImportSession
  fileBuffer: ArrayBuffer | null
  fileName: string
  fileType: 'pdf' | 'image'
}

/**
 * Saves the active import session and raw document buffer to IndexedDB + localStorage.
 */
export async function saveActiveImportSession(
  session: ImportSession,
  fileBuffer?: ArrayBuffer | null,
): Promise<void> {
  try {
    const normalizedSession: ImportSession = {
      ...session,
      questions: session.questions.map(normalizeDraftOptionsAndKey),
    }

    // 1. Save metadata / session JSON to localStorage for instantaneous synchronous access
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizedSession))
    }

    // 2. Save session + document buffer to IndexedDB
    const db = await openCacheDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      store.put(normalizedSession, 'active_session')
      if (fileBuffer) {
        store.put(fileBuffer, 'active_document_buffer')
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Failed to cache import session:', err)
  }
}

/**
 * Loads the active import session and raw document buffer from storage.
 */
export async function loadActiveImportSession(): Promise<CachedImportData | null> {
  try {
    // Check IndexedDB first
    const db = await openCacheDb()
    const result = await new Promise<CachedImportData | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)

      const sessionReq = store.get('active_session')
      const bufferReq = store.get('active_document_buffer')

      tx.oncomplete = () => {
        const session = sessionReq.result as ImportSession | undefined
        const fileBuffer = (bufferReq.result as ArrayBuffer | undefined) || null

        if (session && Array.isArray(session.questions) && session.questions.length > 0) {
          session.questions = session.questions.map(normalizeDraftOptionsAndKey)
          resolve({
            session,
            fileBuffer,
            fileName: session.fileName,
            fileType: session.fileType,
          })
        } else {
          resolve(null)
        }
      }

      tx.onerror = () => reject(tx.error)
    })

    if (result) return result

    // Fallback to localStorage if IndexedDB had no session
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
      if (stored) {
        const session = JSON.parse(stored) as ImportSession
        if (session && Array.isArray(session.questions) && session.questions.length > 0) {
          session.questions = session.questions.map(normalizeDraftOptionsAndKey)
          return {
            session,
            fileBuffer: null,
            fileName: session.fileName,
            fileType: session.fileType,
          }
        }
      }
    }

    return null
  } catch (err) {
    console.warn('Could not read cached import session:', err)
    // Attempt localStorage fallback on error
    try {
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY)
        if (stored) {
          const session = JSON.parse(stored) as ImportSession
          if (session && Array.isArray(session.questions) && session.questions.length > 0) {
            session.questions = session.questions.map(normalizeDraftOptionsAndKey)
            return {
              session,
              fileBuffer: null,
              fileName: session.fileName,
              fileType: session.fileType,
            }
          }
        }
      }
    } catch {
      // ignore
    }
    return null
  }
}

/**
 * Clears the active import session cache after successful finalization or discard.
 */
export async function clearActiveImportSession(): Promise<void> {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_STORAGE_KEY)
    }

    const db = await openCacheDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete('active_session')
      store.delete('active_document_buffer')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Could not clear cached import session:', err)
  }
}
