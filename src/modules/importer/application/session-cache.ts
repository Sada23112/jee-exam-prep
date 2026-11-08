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
  currentPage?: number
}

function readBlobWithFileReader(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      reject(new Error('FileReader not available'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

async function convertBlobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    try {
      return await blob.arrayBuffer()
    } catch {
      return readBlobWithFileReader(blob)
    }
  }
  return readBlobWithFileReader(blob)
}

/**
 * Saves the active import session and raw document buffer to IndexedDB + localStorage.
 */
export async function saveActiveImportSession(
  session: ImportSession,
  fileOrBuffer?: Blob | ArrayBuffer | ArrayBufferView | null,
  activePage = 1,
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

    let arrayBufferToStore: ArrayBuffer | null = null
    let blobToStore: Blob | null = null

    if (fileOrBuffer) {
      if (fileOrBuffer instanceof ArrayBuffer) {
        arrayBufferToStore = fileOrBuffer.slice(0)
        if (typeof Blob !== 'undefined' && arrayBufferToStore) {
          blobToStore = new Blob([arrayBufferToStore])
        }
      } else if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(fileOrBuffer)) {
        const u8 = new Uint8Array(fileOrBuffer.byteLength)
        u8.set(new Uint8Array(fileOrBuffer.buffer, fileOrBuffer.byteOffset, fileOrBuffer.byteLength))
        arrayBufferToStore = u8.buffer
        if (typeof Blob !== 'undefined' && arrayBufferToStore) {
          blobToStore = new Blob([arrayBufferToStore])
        }
      } else if (
        (typeof Blob !== 'undefined' && fileOrBuffer instanceof Blob) ||
        (fileOrBuffer && typeof (fileOrBuffer as Blob).size === 'number')
      ) {
        const b = fileOrBuffer as Blob
        blobToStore = b
        try {
          arrayBufferToStore = await convertBlobToArrayBuffer(b)
        } catch {
          // ignore
        }
      }
    }

    // 2. Save session + document buffer to IndexedDB
    const db = await openCacheDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      store.put(normalizedSession, 'active_session')
      store.put(activePage, 'active_page_number')

      if (arrayBufferToStore && arrayBufferToStore.byteLength > 0) {
        store.put(arrayBufferToStore.slice(0), 'active_document_buffer')
      }
      if (blobToStore) {
        try {
          store.put(blobToStore, 'active_document_blob')
        } catch {
          // ignore if environment does not support Blob in IndexedDB
        }
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
      const pageReq = store.get('active_page_number')

      tx.oncomplete = () => {
        const session = sessionReq.result as ImportSession | undefined
        const buffer = bufferReq.result as ArrayBuffer | undefined
        const page = typeof pageReq.result === 'number' ? pageReq.result : 1

        let fileBuffer: ArrayBuffer | null = null
        if (buffer && buffer.byteLength > 0) {
          fileBuffer = buffer.slice(0)
        }

        if (session && Array.isArray(session.questions) && session.questions.length > 0) {
          session.questions = session.questions.map(normalizeDraftOptionsAndKey)
          resolve({
            session,
            fileBuffer,
            fileName: session.fileName,
            fileType: session.fileType,
            currentPage: page,
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
          return {
            session: {
              ...session,
              questions: session.questions.map(normalizeDraftOptionsAndKey),
            },
            fileBuffer: null,
            fileName: session.fileName,
            fileType: session.fileType,
            currentPage: 1,
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
            return {
              session: {
                ...session,
                questions: session.questions.map(normalizeDraftOptionsAndKey),
              },
              fileBuffer: null,
              fileName: session.fileName,
              fileType: session.fileType,
              currentPage: 1,
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
      store.delete('active_document_blob')
      store.delete('active_page_number')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Could not clear cached import session:', err)
  }
}
