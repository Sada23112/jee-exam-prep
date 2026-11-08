import { z } from 'zod'

/** Every persisted identity is a UUID; revisions are local optimistic-lock tokens. */
export const uuidSchema = z.uuid()
export const timestampSchema = z.iso.datetime({ offset: true })
export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const verificationStateSchema = z.enum(['verified', 'needs-review', 'incomplete'])
export const subjectSchema = z.enum(['Physics', 'Chemistry', 'Mathematics'])
export const questionTypeSchema = z.enum(['single-correct', 'multiple-correct', 'numerical'])

export const commonMetadataShape = {
  id: uuidSchema,
  schemaVersion: z.literal(1),
  ownerId: uuidSchema.nullable(),
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deletedAt: timestampSchema.nullable(),
  remoteRevision: z.string().min(1).max(256).nullable(),
}

export interface CommonMetadata {
  id: string
  schemaVersion: 1
  ownerId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  remoteRevision: string | null
}

export function validateMetadata(value: CommonMetadata, ctx: z.RefinementCtx): void {
  const created = Date.parse(value.createdAt)
  const updated = Date.parse(value.updatedAt)
  if (updated < created) {
    ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'Updated time cannot precede creation.' })
  }
  if (value.deletedAt !== null) {
    const deleted = Date.parse(value.deletedAt)
    if (deleted < created || deleted > updated) {
      ctx.addIssue({ code: 'custom', path: ['deletedAt'], message: 'Deletion must be between creation and the last update.' })
    }
  }
}

/** Decimal strings only: no exponent, expression, Infinity, NaN, or trailing decimal point. */
export const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/
export function isFiniteDecimal(value: string): boolean {
  return value.length <= 128 && DECIMAL_PATTERN.test(value) && Number.isFinite(Number(value))
}

export function validateUnique(values: readonly string[], ctx: z.RefinementCtx, path: (string | number)[], label: string): void {
  if (new Set(values).size !== values.length) {
    ctx.addIssue({ code: 'custom', path, message: `${label} must not contain duplicates.` })
  }
}
