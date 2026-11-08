import { z } from 'zod'
import { commonMetadataShape, isFiniteDecimal, timestampSchema, uuidSchema, validateMetadata, validateUnique } from '../../question-bank/domain/common'
import type { CommonMetadata } from '../../question-bank/domain/common'
import { optionIdSchema, questionSchema } from '../../question-bank/domain/question'
import type { Question } from '../../question-bank/domain/question'
import { presetSchema } from '../../exam-engine/domain/preset'
import type { ExamPreset } from '../../exam-engine/domain/preset'

/** Backup/read model for future actual attempts. No attempt creation, execution, or scoring is implemented. */
export interface ExamHistoryRecord extends CommonMetadata {
  name: string
  presetSnapshot: ExamPreset
  questionSnapshots: Question[]
  startedAt: string
  deadlineAt: string
  submittedAt: string | null
  status: 'in-progress' | 'submitted'
  responses: Array<{
    questionId: string
    selectedOptionIds: string[]
    numericalAnswer: string
    visited: boolean
    markedForReview: boolean
    timeSpentMs: number
  }>
  /** Null means not scored, including submitted attempts with unverified keys. */
  totalScore: number | null
}

export const historySchema = z.object({
  ...commonMetadataShape,
  name: z.string().trim().min(1).max(200),
  presetSnapshot: presetSchema,
  questionSnapshots: z.array(questionSchema).min(1).max(10_000),
  startedAt: timestampSchema,
  deadlineAt: timestampSchema,
  submittedAt: timestampSchema.nullable(),
  status: z.enum(['in-progress', 'submitted']),
  responses: z.array(z.object({
    questionId: uuidSchema,
    selectedOptionIds: z.array(optionIdSchema).max(100),
    numericalAnswer: z.string().max(128),
    visited: z.boolean(),
    markedForReview: z.boolean(),
    timeSpentMs: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }).strict()).max(10_000),
  totalScore: z.number().finite().nullable(),
}).strict().superRefine((value, ctx) => {
  validateMetadata(value, ctx)
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  const started = Date.parse(value.startedAt)
  if (Date.parse(value.deadlineAt) <= started) issue(['deadlineAt'], 'Deadline must be after the start.')
  if (started < Date.parse(value.createdAt) || started > Date.parse(value.updatedAt)) issue(['startedAt'], 'Start must be between record creation and its last update.')
  if (value.status === 'in-progress' && (value.submittedAt !== null || value.totalScore !== null)) {
    issue(['status'], 'An in-progress attempt cannot have a submission or score.')
  }
  if (value.status === 'submitted' && value.submittedAt === null) issue(['submittedAt'], 'Submitted attempts require a submission time.')
  // Late processing/submission is representable for future offline deadline handling;
  // Phase 1 does not enforce timing or calculate scores.
  if (value.submittedAt !== null && (Date.parse(value.submittedAt) < started || Date.parse(value.submittedAt) > Date.parse(value.updatedAt))) {
    issue(['submittedAt'], 'Submission must be between start and the last update.')
  }
  validateUnique(value.questionSnapshots.map(question => question.id), ctx, ['questionSnapshots'], 'Snapshot question IDs')
  validateUnique(value.responses.map(response => response.questionId), ctx, ['responses'], 'Response question IDs')
  const questions = new Map(value.questionSnapshots.map(question => [question.id, question]))
  if (value.presetSnapshot.deletedAt !== null || Date.parse(value.presetSnapshot.updatedAt) > started) {
    issue(['presetSnapshot'], 'An attempt must preserve a live preset snapshot that existed at its start.')
  }
  value.questionSnapshots.forEach((question, index) => {
    if (!value.presetSnapshot.subjects.includes(question.subject)) issue(['questionSnapshots', index, 'subject'], 'Snapshot subject is outside the preset.')
    if (question.deletedAt !== null || Date.parse(question.updatedAt) > started) {
      issue(['questionSnapshots', index], 'An attempt must preserve live question snapshots that existed at its start.')
    }
  })
  value.responses.forEach((response, index) => {
    const path: (string | number)[] = ['responses', index]
    validateUnique(response.selectedOptionIds, ctx, [...path, 'selectedOptionIds'], 'Selected option IDs')
    const question = questions.get(response.questionId)
    if (!question) { issue([...path, 'questionId'], 'Response must reference a question snapshot.'); return }
    if (question.type === 'numerical') {
      if (response.selectedOptionIds.length) issue([...path, 'selectedOptionIds'], 'Numerical responses cannot select options.')
      if (response.numericalAnswer && !isFiniteDecimal(response.numericalAnswer)) issue([...path, 'numericalAnswer'], 'Numerical responses require finite decimal syntax.')
    } else {
      if (response.numericalAnswer) issue([...path, 'numericalAnswer'], 'Choice responses cannot contain a numerical answer.')
      if (question.type === 'single-correct' && response.selectedOptionIds.length > 1) issue([...path, 'selectedOptionIds'], 'Single-correct responses allow at most one selection.')
      if (response.selectedOptionIds.some(id => !question.options.some(option => option.id === id))) issue([...path, 'selectedOptionIds'], 'Selected options must exist in the snapshot.')
    }
  })
  if (value.totalScore !== null && value.questionSnapshots.some(question => question.verification !== 'verified' || question.answerVerification !== 'verified')) {
    issue(['totalScore'], 'Unverified question/key snapshots cannot supply an authoritative total score.')
  }
})

export const examHistorySchema = historySchema
export const examHistoryRecordSchema = historySchema
