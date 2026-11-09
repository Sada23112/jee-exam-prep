import { describe, it, expect } from 'vitest'
import {
  getDeterministicAccountUuid,
  authUserProfileSchema,
  examPreferencesSchema,
  defaultExamPreferences,
} from '../../src/infrastructure/firebase/auth-user'
import { uuidSchema } from '../../src/modules/question-bank/domain/common'

describe('Firebase Auth User & Deterministic UUID Architecture', () => {
  it('generates a strictly valid RFC-4122 v5 UUID from a Firebase UID', async () => {
    const firebaseUid = 'AlphanumericFirebaseUid123456789'
    const accountUuid = await getDeterministicAccountUuid(firebaseUid)

    // Must validate against domain uuidSchema without throwing
    expect(() => uuidSchema.parse(accountUuid)).not.toThrow()
    expect(accountUuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('generates identical UUIDs for the same Firebase UID across different runs/devices', async () => {
    const uid = 'candidate_uid_nta_2026'
    const uuid1 = await getDeterministicAccountUuid(uid)
    const uuid2 = await getDeterministicAccountUuid(uid)
    expect(uuid1).toBe(uuid2)
  })

  it('generates distinct UUIDs for different Firebase accounts', async () => {
    const uuidA = await getDeterministicAccountUuid('user_laptop_A')
    const uuidB = await getDeterministicAccountUuid('user_laptop_B')
    expect(uuidA).not.toBe(uuidB)
  })

  it('validates default examination preferences', () => {
    expect(() => examPreferencesSchema.parse(defaultExamPreferences)).not.toThrow()
    expect(defaultExamPreferences.preferredSubjects).toEqual(['Physics', 'Chemistry', 'Mathematics'])
    expect(defaultExamPreferences.defaultDurationMinutes).toBe(180)
  })

  it('validates a complete user profile model', async () => {
    const accountUuid = await getDeterministicAccountUuid('mock_firebase_user_789')
    const sampleProfile = {
      uid: 'mock_firebase_user_789',
      accountUuid,
      email: 'student@example.com',
      displayName: 'Aditi Sharma',
      photoURL: null,
      emailVerified: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      examPreferences: defaultExamPreferences,
    }

    expect(() => authUserProfileSchema.parse(sampleProfile)).not.toThrow()
  })
})
