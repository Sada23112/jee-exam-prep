import { createContext } from 'react'
import type { User } from 'firebase/auth'
import type { AuthUserProfile, ExamPreferences } from './auth-user'

export interface AuthContextValue {
  user: User | null
  profile: AuthUserProfile | null
  loading: boolean
  isConfigured: boolean
  error: string | null
  loginWithEmail: (email: string, pass: string) => Promise<void>
  registerWithEmail: (name: string, email: string, pass: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  resendVerificationEmail: () => Promise<void>
  updateProfileData: (updates: { displayName?: string; photoURL?: string; preferences?: Partial<ExamPreferences> }) => Promise<void>
  logout: () => Promise<void>
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
