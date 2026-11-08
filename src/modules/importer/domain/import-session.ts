import type { QuestionDraft, Subject, VerificationState } from '../../question-bank/domain/question'

export type AnswerKeyStatus = 'verified' | 'needs-correction' | 'missing' | 'ambiguous'
export type AnswerSource = 'provided-answer-key' | 'ai-extracted' | 'manually-entered' | 'unspecified'

export interface ImportedQuestionDraft extends QuestionDraft {
  tempId: string
  sourcePageNumber: number
  rawText: string
  uncertainFlags: string[]
  answerKeyStatus?: AnswerKeyStatus
  answerSource?: AnswerSource
}

export interface ImportSession {
  id: string
  fileName: string
  fileType: 'pdf' | 'image'
  totalPages: number
  pageAssetIds: Record<number, string> // pageNumber (1-based) -> assetId
  questions: ImportedQuestionDraft[]
  rawAnswerKey: string
  createdAt: string
  updatedAt: string
}

export function createEmptyImportedQuestion(
  sourcePageNumber = 1,
  sourceQuestionNumber = '',
  subject: Subject = 'Physics',
): ImportedQuestionDraft {
  return {
    tempId: crypto.randomUUID(),
    subject,
    type: 'single-correct',
    chapter: '',
    topic: '',
    year: null,
    session: '',
    difficulty: 'unspecified',
    prompt: '',
    options: [
      { id: 'A', text: '' },
      { id: 'B', text: '' },
      { id: 'C', text: '' },
      { id: 'D', text: '' },
    ],
    correctOptionIds: [],
    numericalAnswer: '',
    numericalTolerance: '0',
    solution: '',
    verification: 'needs-review',
    answerVerification: 'needs-review',
    answerKeyStatus: 'missing',
    answerSource: 'unspecified',
    notes: '',
    sourceLabel: '',
    sourceQuestionNumber,
    assets: [],
    sourcePageNumber,
    rawText: '',
    uncertainFlags: [],
  }
}

/**
 * Derives the active answer key status from draft fields.
 */
export function inferAnswerKeyStatus(draft: ImportedQuestionDraft): AnswerKeyStatus {
  // If explicitly verified or verified in verification state, it is verified
  if (draft.answerKeyStatus === 'verified' || draft.answerVerification === 'verified') {
    return 'verified'
  }
  if (draft.answerKeyStatus === 'ambiguous') {
    return 'ambiguous'
  }

  if (draft.type === 'single-correct') {
    if (draft.correctOptionIds.length === 0) return 'missing'
    if (draft.correctOptionIds.length > 1) return 'ambiguous'
    return 'needs-correction'
  }
  if (draft.type === 'multiple-correct') {
    if (draft.correctOptionIds.length === 0) return 'missing'
    return 'needs-correction'
  }
  if (draft.type === 'numerical') {
    if (!draft.numericalAnswer.trim()) return 'missing'
    return 'needs-correction'
  }
  return draft.answerKeyStatus || 'missing'
}

/**
 * Validates question transcription structure (prompt, options, diagrams)
 * independently from the answer key, allowing spoiler-free transcription verification.
 */
export function validateQuestionStructure(draft: ImportedQuestionDraft): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!draft.prompt.trim()) {
    errors.push('Question prompt cannot be empty.')
  }

  if (draft.type === 'single-correct' || draft.type === 'multiple-correct') {
    if (draft.options.length < 2) {
      errors.push(`${draft.type === 'single-correct' ? 'Single' : 'Multiple'} correct question must have at least 2 options.`)
    }
    const emptyOptions = draft.options.filter(o => !o.text.trim())
    if (emptyOptions.length > 0) {
      errors.push(`Options ${emptyOptions.map(o => o.id).join(', ')} cannot be empty.`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Legacy validator for backward compatibility: checks both structure and answer key.
 */
export function validateImportedQuestionForBank(draft: ImportedQuestionDraft): {
  valid: boolean
  errors: string[]
} {
  const structureCheck = validateQuestionStructure(draft)
  const errors: string[] = [...structureCheck.errors]

  const status = inferAnswerKeyStatus(draft)

  if (draft.type === 'single-correct') {
    if (status === 'verified' && draft.correctOptionIds.length !== 1) {
      errors.push('A verified single-correct question must have exactly one correct option selected.')
    }
  } else if (draft.type === 'multiple-correct') {
    if (status === 'verified' && draft.correctOptionIds.length < 1) {
      errors.push('A verified multiple-correct question must have at least one correct option.')
    }
  } else if (draft.type === 'numerical') {
    if (status === 'verified') {
      if (!draft.numericalAnswer.trim()) {
        errors.push('Numerical question requires a numerical answer when verified.')
      } else if (!/^-?\d+(?:\.\d+)?$/.test(draft.numericalAnswer.trim())) {
        errors.push('Numerical answer must be a valid decimal number.')
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export interface PaperFinalizationIssue {
  index: number
  questionNumber: string
  subject: Subject
  status: AnswerKeyStatus
  reason: string
}

export interface PaperFinalizationReport {
  totalQuestions: number
  structuralErrors: Array<{ index: number; questionNumber: string; errors: string[] }>
  verifiedCount: number
  unverifiedCount: number
  unverifiedIssues: PaperFinalizationIssue[]
  canFinalize: boolean
  requiresUngradedConfirmation: boolean
}

/**
 * Preflight validation before finalizing question paper into Question Bank.
 */
export function validatePaperForFinalization(questions: ImportedQuestionDraft[]): PaperFinalizationReport {
  const structuralErrors: Array<{ index: number; questionNumber: string; errors: string[] }> = []
  const unverifiedIssues: PaperFinalizationIssue[] = []
  let verifiedCount = 0

  questions.forEach((q, idx) => {
    const qNum = q.sourceQuestionNumber || String(idx + 1)
    const struct = validateQuestionStructure(q)
    if (!struct.valid) {
      structuralErrors.push({ index: idx, questionNumber: qNum, errors: struct.errors })
    }

    const keyStatus = inferAnswerKeyStatus(q)
    if (keyStatus === 'verified') {
      verifiedCount++
    } else {
      let reason = 'Answer key needs review / correction'
      if (keyStatus === 'missing') reason = 'No correct answer provided'
      if (keyStatus === 'ambiguous') reason = 'Answer mapping is ambiguous'
      unverifiedIssues.push({
        index: idx,
        questionNumber: qNum,
        subject: q.subject,
        status: keyStatus,
        reason,
      })
    }
  })

  return {
    totalQuestions: questions.length,
    structuralErrors,
    verifiedCount,
    unverifiedCount: unverifiedIssues.length,
    unverifiedIssues,
    canFinalize: questions.length > 0 && structuralErrors.length === 0,
    requiresUngradedConfirmation: unverifiedIssues.length > 0,
  }
}

/**
 * Converts an imported draft into a clean QuestionDraft for storage.
 * Strips UI-only fields and sets proper verification states.
 */
export function toCleanQuestionDraft(
  draft: ImportedQuestionDraft,
  options?: { allowUngraded?: boolean },
): QuestionDraft {
  const isNumerical = draft.type === 'numerical'
  const keyStatus = inferAnswerKeyStatus(draft)
  const isAnswerVerified = keyStatus === 'verified'

  const answerVerification: VerificationState = isAnswerVerified
    ? 'verified'
    : keyStatus === 'missing'
      ? 'incomplete'
      : 'needs-review'

  // Question verification is 'verified' only if both structure is verified AND answer is verified,
  // OR if the user explicitly chose to finalize with ungraded, it remains 'needs-review'
  const questionVerification: VerificationState =
    draft.verification === 'verified' && isAnswerVerified
      ? 'verified'
      : (options?.allowUngraded ? 'needs-review' : draft.verification)

  return {
    subject: draft.subject,
    type: draft.type,
    chapter: draft.chapter,
    topic: draft.topic,
    year: draft.year,
    session: draft.session,
    difficulty: draft.difficulty,
    prompt: draft.prompt,
    options: isNumerical ? [] : draft.options.map(o => ({ id: o.id, text: o.text })),
    correctOptionIds: isNumerical ? [] : [...draft.correctOptionIds],
    numericalAnswer: isNumerical ? draft.numericalAnswer : '',
    numericalTolerance: isNumerical ? draft.numericalTolerance : '',
    solution: draft.solution,
    verification: questionVerification,
    answerVerification,
    notes: draft.notes,
    sourceLabel: draft.sourceLabel,
    sourceQuestionNumber: draft.sourceQuestionNumber,
    assets: draft.assets.map(a => ({
      assetId: a.assetId,
      role: a.role,
      pageNumber: a.pageNumber,
    })),
  }
}
