import { z } from 'zod'
import {
  commonMetadataShape, isFiniteDecimal, questionTypeSchema, subjectSchema,
  uuidSchema, validateMetadata, validateUnique, verificationStateSchema,
} from './common'

export type Subject = 'Physics' | 'Chemistry' | 'Mathematics'
export type QuestionType = 'single-correct' | 'multiple-correct' | 'numerical'
export type VerificationState = 'verified' | 'needs-review' | 'incomplete'
export type Difficulty = 'unspecified' | 'easy' | 'medium' | 'hard'

export interface QuestionDraft {
  subject: Subject
  type: QuestionType
  chapter: string
  topic: string
  year: number | null
  session: string
  difficulty: Difficulty
  prompt: string
  options: Array<{ id: string; text: string }>
  correctOptionIds: string[]
  numericalAnswer: string
  numericalTolerance: string
  solution: string
  verification: VerificationState
  answerVerification: VerificationState
  notes: string
  sourceLabel: string
  sourceQuestionNumber: string
  assets: Array<{ assetId: string; role: 'page' | 'crop' | 'diagram'; pageNumber: number | null }>
}

export interface Question extends QuestionDraft {
  id: string
  schemaVersion: 1
  ownerId: string | null
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  remoteRevision: string | null
}

export const optionIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, 'Invalid option identity.')
const questionDraftShape = {
  subject: subjectSchema,
  type: questionTypeSchema,
  chapter: z.string().trim().max(300),
  topic: z.string().trim().max(300),
  year: z.number().int().min(1900).max(9999).nullable(),
  session: z.string().trim().max(200),
  difficulty: z.enum(['unspecified', 'easy', 'medium', 'hard']),
  // Do not transform authored content, including whitespace and mathematical notation.
  prompt: z.string().max(200_000),
  options: z.array(z.object({ id: optionIdSchema, text: z.string().max(100_000) }).strict()).max(100),
  correctOptionIds: z.array(optionIdSchema).max(100),
  numericalAnswer: z.string().max(128),
  numericalTolerance: z.string().max(128),
  solution: z.string().max(200_000),
  verification: verificationStateSchema,
  answerVerification: verificationStateSchema,
  notes: z.string().max(100_000),
  sourceLabel: z.string().trim().max(500),
  sourceQuestionNumber: z.string().trim().max(100),
  assets: z.array(z.object({
    assetId: uuidSchema,
    role: z.enum(['page', 'crop', 'diagram']),
    pageNumber: z.number().int().min(1).max(100_000).nullable(),
  }).strict()).max(1_000),
}

function validateQuestion(value: QuestionDraft, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  validateUnique(value.options.map(option => option.id), ctx, ['options'], 'Option IDs')
  validateUnique(value.correctOptionIds, ctx, ['correctOptionIds'], 'Correct option IDs')
  validateUnique(value.assets.map(asset => asset.assetId), ctx, ['assets'], 'Asset IDs')
  const optionIds = new Set(value.options.map(option => option.id))
  if (value.correctOptionIds.some(id => !optionIds.has(id))) {
    issue(['correctOptionIds'], 'Every correct option must reference an existing option.')
  }
  const complete = value.verification !== 'incomplete'
  const verifiedKey = value.answerVerification === 'verified'
  if (complete && !value.prompt.trim() && !value.assets.some(asset => asset.role === 'page' || asset.role === 'crop')) {
    issue(['prompt'], 'A non-incomplete question requires a prompt or an original page/crop.')
  }
  if (value.verification === 'verified') {
    if (!value.prompt.trim()) issue(['prompt'], 'Verified questions require a transcribed prompt; images cannot replace transcription.')
    if (!verifiedKey) issue(['answerVerification'], 'A verified question requires a verified answer key.')
  }
  if (complete || (verifiedKey && value.type !== 'numerical')) {
    value.options.forEach((option, index) => {
      if (!option.text.trim()) issue(['options', index, 'text'], 'Every choice needs nonblank text when the question is non-incomplete or its answer key is verified.')
    })
  }
  if (value.type === 'numerical') {
    if (value.options.length) issue(['options'], 'Numerical questions cannot have choices.')
    if (value.correctOptionIds.length) issue(['correctOptionIds'], 'Numerical questions cannot have correct option IDs.')
    if (value.numericalAnswer && !isFiniteDecimal(value.numericalAnswer)) {
      issue(['numericalAnswer'], 'The answer must be a finite decimal string, not scientific notation or an expression.')
    }
    if (value.numericalTolerance && (!isFiniteDecimal(value.numericalTolerance) || Number(value.numericalTolerance) < 0)) {
      issue(['numericalTolerance'], 'Tolerance must be a finite non-negative decimal string.')
    }
    if (verifiedKey && (!value.numericalAnswer || !value.numericalTolerance)) {
      issue(['numericalAnswer'], 'A verified numerical key requires both an answer and a tolerance (zero is allowed).')
    }
  } else {
    if ((complete || verifiedKey) && value.options.length < 2) issue(['options'], 'Choice questions require at least two options.')
    if (value.numericalAnswer || value.numericalTolerance) issue(['numericalAnswer'], 'Choice questions cannot carry a numerical key.')
    if (value.type === 'single-correct' && value.correctOptionIds.length > 1) {
      issue(['correctOptionIds'], 'Single-correct questions allow only one correct option.')
    }
    if (verifiedKey && (value.type === 'single-correct' ? value.correctOptionIds.length !== 1 : value.correctOptionIds.length < 1)) {
      issue(['correctOptionIds'], 'A verified key requires the type-appropriate correct option set.')
    }
  }
}

export const questionDraftSchema = z.object(questionDraftShape).strict().superRefine(validateQuestion)
export const questionSchema = z.object({ ...commonMetadataShape, ...questionDraftShape }).strict()
  .superRefine((value, ctx) => { validateMetadata(value, ctx); validateQuestion(value, ctx) })

export function createEmptyQuestionDraft(): QuestionDraft {
  return {
    subject: 'Physics', type: 'single-correct', chapter: '', topic: '', year: null,
    session: '', difficulty: 'unspecified', prompt: '',
    options: ['A', 'B', 'C', 'D'].map(id => ({ id, text: '' })),
    correctOptionIds: [], numericalAnswer: '', numericalTolerance: '', solution: '',
    verification: 'incomplete', answerVerification: 'incomplete', notes: '',
    sourceLabel: '', sourceQuestionNumber: '', assets: [],
  }
}
