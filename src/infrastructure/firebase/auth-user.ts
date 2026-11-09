import { z } from 'zod'
import { uuidSchema } from '../../modules/question-bank/domain/common'

export interface ExamPreferences {
  targetYear: number
  defaultDurationMinutes: number
  preferredSubjects: Array<'Physics' | 'Chemistry' | 'Mathematics'>
  timerAlertMinutes: number
}

export const defaultExamPreferences: ExamPreferences = {
  targetYear: new Date().getFullYear() + 1,
  defaultDurationMinutes: 180,
  preferredSubjects: ['Physics', 'Chemistry', 'Mathematics'],
  timerAlertMinutes: 15,
}

export interface AuthUserProfile {
  uid: string
  accountUuid: string
  email: string
  displayName: string
  photoURL: string | null
  emailVerified: boolean
  createdAt: string
  updatedAt: string
  examPreferences: ExamPreferences
}

export const examPreferencesSchema = z.object({
  targetYear: z.number().int().min(2020).max(2050),
  defaultDurationMinutes: z.number().int().min(1).max(10080),
  preferredSubjects: z.array(z.enum(['Physics', 'Chemistry', 'Mathematics'])).min(1).max(3),
  timerAlertMinutes: z.number().int().min(1).max(60),
}).strict()

export const authUserProfileSchema = z.object({
  uid: z.string().min(1),
  accountUuid: uuidSchema,
  email: z.string().email(),
  displayName: z.string().max(100),
  photoURL: z.string().nullable(),
  emailVerified: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  examPreferences: examPreferencesSchema,
}).strict()

/**
 * Derives a deterministic RFC-4122 v5 UUID from a Firebase Auth UID.
 * Ensures the exact same UUID is computed across all devices for consistent ownerId matching.
 */
export async function getDeterministicAccountUuid(firebaseUid: string): Promise<string> {
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(`examora-account-namespace:${firebaseUid}`))
  const bytes = new Uint8Array(hash)
  // Set version 5 (name-based SHA)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  // Set variant (RFC 4122)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
