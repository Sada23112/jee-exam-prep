import { z } from 'zod'
import { commonMetadataShape, uuidSchema, validateMetadata, validateUnique } from './common'
import type { CommonMetadata } from './common'

export interface CollectionDraft { name: string; description: string; questionIds: string[] }
export type QuestionCollection = CommonMetadata & CollectionDraft

const collectionDraftShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  questionIds: z.array(uuidSchema).max(100_000),
}
export const collectionDraftSchema = z.object(collectionDraftShape).strict()
  .superRefine((value, ctx) => validateUnique(value.questionIds, ctx, ['questionIds'], 'Question IDs'))
export const collectionSchema = z.object({ ...commonMetadataShape, ...collectionDraftShape }).strict()
  .superRefine((value, ctx) => {
    validateMetadata(value, ctx)
    validateUnique(value.questionIds, ctx, ['questionIds'], 'Question IDs')
  })
