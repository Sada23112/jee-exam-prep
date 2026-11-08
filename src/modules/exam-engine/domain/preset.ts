import { z } from 'zod'
import { commonMetadataShape, revisionSchema, subjectSchema, uuidSchema, validateMetadata, validateUnique } from '../../question-bank/domain/common'
import type { CommonMetadata } from '../../question-bank/domain/common'
import type { QuestionType, Subject } from '../../question-bank/domain/question'

/** User-authored rules only. Phase 1 neither claims official JEE rules nor executes them. */
export interface PresetDraft {
  name: string
  description: string
  durationMinutes: number
  subjects: Subject[]
  questionOrder: 'original' | 'randomised'
  navigation: 'free' | 'linear'
  resumePolicy: 'continue-deadline' | 'disallow'
  marking: Record<QuestionType, { correct: number; incorrect: number; unattempted: number }>
  multipleCorrectPolicy: 'exact-set'
}
export interface ExamPreset extends CommonMetadata, PresetDraft { familyId: string; version: number }

const mark = z.number().finite().min(-1_000_000).max(1_000_000)
const markingRuleSchema = z.object({ correct: mark, incorrect: mark, unattempted: mark }).strict()
const presetDraftShape = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(10_000),
  durationMinutes: z.number().int().min(1).max(10_080),
  subjects: z.array(subjectSchema).min(1).max(3),
  questionOrder: z.enum(['original', 'randomised']),
  navigation: z.enum(['free', 'linear']),
  resumePolicy: z.enum(['continue-deadline', 'disallow']),
  marking: z.object({
    'single-correct': markingRuleSchema,
    'multiple-correct': markingRuleSchema,
    numerical: markingRuleSchema,
  }).strict(),
  multipleCorrectPolicy: z.literal('exact-set'),
}
export const presetDraftSchema = z.object(presetDraftShape).strict()
  .superRefine((value, ctx) => validateUnique(value.subjects, ctx, ['subjects'], 'Subjects'))
export const presetSchema = z.object({ ...commonMetadataShape, familyId: uuidSchema, version: revisionSchema, ...presetDraftShape }).strict()
  .superRefine((value, ctx) => {
    validateMetadata(value, ctx)
    validateUnique(value.subjects, ctx, ['subjects'], 'Subjects')
    if (value.revision !== 1) ctx.addIssue({ code: 'custom', path: ['revision'], message: 'Preset versions are immutable and always have revision 1.' })
  })
