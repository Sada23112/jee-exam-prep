import {
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile as updateFirebaseProfile,
  type User,
} from 'firebase/auth'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured } from './firebase'
import {
  getDeterministicAccountUuid,
  defaultExamPreferences,
  type AuthUserProfile,
  type ExamPreferences,
} from './auth-user'
import { AuthContext } from './auth-context-definition'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthUserProfile | null>(null)
  const [loading, setLoading] = useState(() => isFirebaseConfigured())
  const [error, setError] = useState<string | null>(null)

  const isConfigured = isFirebaseConfigured()

  const syncUserProfile = useCallback(async (firebaseUser: User | null) => {
    if (!firebaseUser) {
      setProfile(null)
      return
    }

    const firestore = getFirebaseFirestore()
    if (!firestore) return

    try {
      const accountUuid = await getDeterministicAccountUuid(firebaseUser.uid)
      const profileRef = doc(firestore, 'users', firebaseUser.uid, 'profile', 'main')
      const profileSnap = await getDoc(profileRef)

      const now = new Date().toISOString()
      if (profileSnap.exists()) {
        const data = profileSnap.data() as Partial<AuthUserProfile>
        const mergedProfile: AuthUserProfile = {
          uid: firebaseUser.uid,
          accountUuid: data.accountUuid || accountUuid,
          email: firebaseUser.email || data.email || '',
          displayName: firebaseUser.displayName || data.displayName || 'Candidate',
          photoURL: firebaseUser.photoURL || data.photoURL || null,
          emailVerified: firebaseUser.emailVerified,
          createdAt: data.createdAt || now,
          updatedAt: now,
          examPreferences: {
            ...defaultExamPreferences,
            ...(data.examPreferences || {}),
          },
        }
        setProfile(mergedProfile)
      } else {
        const newProfile: AuthUserProfile = {
          uid: firebaseUser.uid,
          accountUuid,
          email: firebaseUser.email || '',
          displayName: firebaseUser.displayName || 'Candidate',
          photoURL: firebaseUser.photoURL || null,
          emailVerified: firebaseUser.emailVerified,
          createdAt: now,
          updatedAt: now,
          examPreferences: defaultExamPreferences,
        }
        await setDoc(profileRef, newProfile)
        setProfile(newProfile)
      }
    } catch (err) {
      console.warn('Failed to fetch/save user profile in Firestore:', err)
      // Fallback local profile in memory
      const accountUuid = await getDeterministicAccountUuid(firebaseUser.uid)
      setProfile({
        uid: firebaseUser.uid,
        accountUuid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName || 'Candidate',
        photoURL: firebaseUser.photoURL || null,
        emailVerified: firebaseUser.emailVerified,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        examPreferences: defaultExamPreferences,
      })
    }
  }, [])

  useEffect(() => {
    const auth = getFirebaseAuth()
    if (!auth) return

    const unsubscribe = onAuthStateChanged(
      auth,
      currentUser => {
        setUser(currentUser)
        void syncUserProfile(currentUser).finally(() => setLoading(false))
      },
      err => {
        setError(err.message)
        setLoading(false)
      },
    )

    return () => unsubscribe()
  }, [syncUserProfile])

  const clearError = useCallback(() => setError(null), [])

  const loginWithEmail = useCallback(async (email: string, pass: string) => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase Authentication is not configured.')
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pass)
    } catch (err) {
      const msg = mapAuthErrorMessage(err)
      setError(msg)
      throw new Error(msg, { cause: err })
    }
  }, [])

  const registerWithEmail = useCallback(async (name: string, email: string, pass: string) => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase Authentication is not configured.')
    setError(null)
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass)
      if (name.trim()) {
        await updateFirebaseProfile(cred.user, { displayName: name.trim() })
      }
      try {
        await sendEmailVerification(cred.user)
      } catch {
        // Non-blocking
      }
    } catch (err) {
      const msg = mapAuthErrorMessage(err)
      setError(msg)
      throw new Error(msg, { cause: err })
    }
  }, [])

  const loginWithGoogle = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase Authentication is not configured.')
    setError(null)
    try {
      const provider = new GoogleAuthProvider()
      provider.setCustomParameters({ prompt: 'select_account' })
      await signInWithPopup(auth, provider)
    } catch (err) {
      const msg = mapAuthErrorMessage(err)
      setError(msg)
      throw new Error(msg, { cause: err })
    }
  }, [])

  const sendPasswordReset = useCallback(async (email: string) => {
    const auth = getFirebaseAuth()
    if (!auth) throw new Error('Firebase Authentication is not configured.')
    setError(null)
    try {
      await sendPasswordResetEmail(auth, email.trim())
    } catch (err) {
      const msg = mapAuthErrorMessage(err)
      setError(msg)
      throw new Error(msg, { cause: err })
    }
  }, [])

  const resendVerificationEmail = useCallback(async () => {
    if (!user) throw new Error('No user is currently signed in.')
    setError(null)
    try {
      await sendEmailVerification(user)
    } catch (err) {
      const msg = mapAuthErrorMessage(err)
      setError(msg)
      throw new Error(msg, { cause: err })
    }
  }, [user])

  const updateProfileData = useCallback(
    async (updates: { displayName?: string; photoURL?: string; preferences?: Partial<ExamPreferences> }) => {
      if (!user) throw new Error('No user is currently signed in.')
      const firestore = getFirebaseFirestore()

      const authUpdates: { displayName?: string; photoURL?: string } = {}
      if (updates.displayName !== undefined) authUpdates.displayName = updates.displayName.trim()
      if (updates.photoURL !== undefined) authUpdates.photoURL = updates.photoURL

      if (Object.keys(authUpdates).length > 0) {
        await updateFirebaseProfile(user, authUpdates)
      }

      if (firestore && profile) {
        const nextPreferences: ExamPreferences = {
          ...profile.examPreferences,
          ...(updates.preferences || {}),
        }

        const nextProfile: AuthUserProfile = {
          ...profile,
          displayName: updates.displayName?.trim() ?? profile.displayName,
          photoURL: updates.photoURL ?? profile.photoURL,
          examPreferences: nextPreferences,
          updatedAt: new Date().toISOString(),
        }

        const profileRef = doc(firestore, 'users', user.uid, 'profile', 'main')
        await setDoc(profileRef, nextProfile, { merge: true })
        setProfile(nextProfile)
      }
    },
    [user, profile],
  )

  const logout = useCallback(async () => {
    const auth = getFirebaseAuth()
    if (auth) {
      await signOut(auth)
    }
    setUser(null)
    setProfile(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isConfigured,
        error,
        loginWithEmail,
        registerWithEmail,
        loginWithGoogle,
        sendPasswordReset,
        resendVerificationEmail,
        updateProfileData,
        logout,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

function mapAuthErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'An unexpected authentication error occurred.'
  const message = err.message
  if (message.includes('auth/invalid-credential') || message.includes('auth/wrong-password') || message.includes('auth/user-not-found')) {
    return 'Invalid email or password. Please verify your credentials and try again.'
  }
  if (message.includes('auth/email-already-in-use')) {
    return 'An account already exists with this email address. Please sign in instead.'
  }
  if (message.includes('auth/weak-password')) {
    return 'Password is too weak. Please choose at least 6 characters with a combination of letters and numbers.'
  }
  if (message.includes('auth/invalid-email')) {
    return 'Please enter a valid email address.'
  }
  if (message.includes('auth/popup-closed-by-user')) {
    return 'Sign in was cancelled (popup closed).'
  }
  if (message.includes('auth/too-many-requests')) {
    return 'Too many unsuccessful attempts. Access temporarily disabled; please try again later or reset password.'
  }
  if (message.includes('auth/network-request-failed')) {
    return 'Network connection failed. Please check your internet connection.'
  }
  return message
}
