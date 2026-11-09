import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore'
import { getStorage, connectStorageEmulator, type FirebaseStorage } from 'firebase/storage'
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions'

const env = typeof import.meta !== 'undefined'
  ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}
  : {}

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: env.VITE_FIREBASE_APP_ID || '',
}

export function isFirebaseConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.projectId &&
    !firebaseConfig.apiKey.includes('your_') &&
    firebaseConfig.apiKey.length > 5,
  )
}

let appInstance: FirebaseApp | null = null
let authInstance: Auth | null = null
let firestoreInstance: Firestore | null = null
let storageInstance: FirebaseStorage | null = null
let functionsInstance: Functions | null = null

export function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseConfigured()) return null
  if (!appInstance) {
    const existing = getApps()
    appInstance = existing.length > 0 ? (existing[0] ?? null) : initializeApp(firebaseConfig)
  }
  return appInstance
}

export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp()
  if (!app) return null
  if (!authInstance) {
    authInstance = getAuth(app)
    if (env.VITE_FIREBASE_EMULATOR === 'true') {
      try {
        connectAuthEmulator(authInstance, 'http://127.0.0.1:9099', { disableWarnings: true })
      } catch {
        // already connected
      }
    }
  }
  return authInstance
}

export function getFirebaseFirestore(): Firestore | null {
  const app = getFirebaseApp()
  if (!app) return null
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(app)
    if (env.VITE_FIREBASE_EMULATOR === 'true') {
      try {
        connectFirestoreEmulator(firestoreInstance, '127.0.0.1', 8080)
      } catch {
        // already connected
      }
    }
  }
  return firestoreInstance
}

export function getFirebaseStorage(): FirebaseStorage | null {
  const app = getFirebaseApp()
  if (!app) return null
  if (!storageInstance) {
    storageInstance = getStorage(app)
    if (env.VITE_FIREBASE_EMULATOR === 'true') {
      try {
        connectStorageEmulator(storageInstance, '127.0.0.1', 9199)
      } catch {
        // already connected
      }
    }
  }
  return storageInstance
}

export function getFirebaseFunctions(): Functions | null {
  const app = getFirebaseApp()
  if (!app) return null
  if (!functionsInstance) {
    functionsInstance = getFunctions(app)
    if (env.VITE_FIREBASE_EMULATOR === 'true') {
      try {
        connectFunctionsEmulator(functionsInstance, '127.0.0.1', 5001)
      } catch {
        // already connected
      }
    }
  }
  return functionsInstance
}
