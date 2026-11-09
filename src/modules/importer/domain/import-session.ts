import type { QuestionDraft, Subject, VerificationState, QuestionOption } from '../../question-bank/domain/question'

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

/**
 * Normalizes option identifiers across numeric (1, 2, 3, 4) and alphabetic (A, B, C, D) formats.
 */
export function normalizeOptionId(id: string, index = 0): string {
  const clean = id.trim().toUpperCase().replace(/^[([{<]+|[)\]}>]+$/g, '')
  if (clean === '1' || clean === 'A') return 'A'
  if (clean === '2' || clean === 'B') return 'B'
  if (clean === '3' || clean === 'C') return 'C'
  if (clean === '4' || clean === 'D') return 'D'
  if (/^[A-Z]$/.test(clean)) return clean
  return ['A', 'B', 'C', 'D'][index] || clean || 'A'
}

/**
 * Normalizes draft options and correctOptionIds to standard A, B, C, D format.
 */
export function normalizeDraftOptionsAndKey(draft: ImportedQuestionDraft): ImportedQuestionDraft {
  if (draft.type === 'numerical') {
    return {
      ...draft,
      options: [],
      correctOptionIds: [],
    }
  }

  const baseOptions: QuestionOption[] = draft.options.length > 0
    ? draft.options
    : ['A', 'B', 'C', 'D'].map(id => ({ id, text: '', diagramAssetId: null }))

  const normalizedOptions = baseOptions.map((opt, idx) => ({
    ...opt,
    id: normalizeOptionId(opt.id, idx),
    text: opt.text.trim() || (opt.diagramAssetId ? '' : `(Option ${normalizeOptionId(opt.id, idx)})`),
    diagramAssetId: opt.diagramAssetId ?? null,
  }))

  const seen = new Set<string>()
  const dedupedOptions = normalizedOptions.filter((opt, idx) => {
    if (seen.has(opt.id)) {
      opt.id = ['A', 'B', 'C', 'D'][idx] || `OPT${idx + 1}`
    }
    seen.add(opt.id)
    return true
  })

  const normalizedCorrectOptionIds = draft.correctOptionIds
    .map((id, idx) => normalizeOptionId(id, idx))
    .filter(Boolean)

  return {
    ...draft,
    options: dedupedOptions,
    correctOptionIds: normalizedCorrectOptionIds,
  }
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
    const emptyOptions = draft.options.filter(o => !o.text.trim() && !o.diagramAssetId)
    if (emptyOptions.length > 0) {
      errors.push(`Options ${emptyOptions.map(o => o.id).join(', ')} cannot be empty (must contain text or a diagram).`)
    }
    // Check that any selected correct options exist in options (normalizing 1->A, 2->B, etc.)
    if (draft.options.length > 0 && draft.correctOptionIds.length > 0) {
      const optionIds = new Set(draft.options.map((o, idx) => normalizeOptionId(o.id, idx)))
      const missing = draft.correctOptionIds
        .map((id, idx) => normalizeOptionId(id, idx))
        .filter(id => id && !optionIds.has(id))
      if (missing.length > 0) {
        errors.push(`Correct option ${missing.join(', ')} does not match any existing option ID.`)
      }
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
    // Auto-normalize question draft before checking
    const normalizedQ = normalizeDraftOptionsAndKey(q)
    const struct = validateQuestionStructure(normalizedQ)
    if (!struct.valid) {
      structuralErrors.push({ index: idx, questionNumber: qNum, errors: struct.errors })
    }

    const keyStatus = inferAnswerKeyStatus(normalizedQ)
    if (keyStatus === 'verified') {
      verifiedCount++
    } else {
      let reason = 'Answer key needs review / correction'
      if (keyStatus === 'missing') reason = 'No correct answer provided'
      if (keyStatus === 'ambiguous') reason = 'Answer mapping is ambiguous'
      unverifiedIssues.push({
        index: idx,
        questionNumber: qNum,
        subject: normalizedQ.subject,
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
 * Auto-repairs missing option references and guarantees schema conformance.
 */
export function toCleanQuestionDraft(
  draft: ImportedQuestionDraft,
  options?: { allowUngraded?: boolean },
): QuestionDraft {
  const normalized = normalizeDraftOptionsAndKey(draft)
  const isNumerical = normalized.type === 'numerical'
  const keyStatus = inferAnswerKeyStatus(normalized)
  const isAnswerVerified = keyStatus === 'verified'

  const answerVerification: VerificationState = isAnswerVerified
    ? 'verified'
    : keyStatus === 'missing'
      ? 'incomplete'
      : 'needs-review'

  // Question verification is 'verified' only if both structure is verified AND answer is verified,
  // OR if the user explicitly chose to finalize with ungraded, it remains 'needs-review'
  const questionVerification: VerificationState =
    normalized.verification === 'verified' && isAnswerVerified
      ? 'verified'
      : (options?.allowUngraded ? 'needs-review' : normalized.verification)

  let cleanOptions: Array<{ id: string; text: string }> = []
  let cleanCorrectOptionIds: string[] = []

  if (!isNumerical) {
    // 1. If options list is empty, initialize standard A, B, C, D
    const baseOptions = normalized.options.length > 0
      ? normalized.options
      : ['A', 'B', 'C', 'D'].map(id => ({ id, text: `(Option ${id})` }))

    // 2. Standardize IDs (uppercase, stripped brackets, 1-4 mapped to A-D) and ensure non-blank text
    cleanOptions = baseOptions.map((o, idx) => {
      const cleanId = normalizeOptionId(o.id, idx)
      const cleanText = o.text.trim() || `(Option ${cleanId})`
      return { id: cleanId, text: cleanText }
    })

    // 3. Deduplicate options by ID
    const seenIds = new Set<string>()
    cleanOptions = cleanOptions.filter(o => {
      if (seenIds.has(o.id)) return false
      seenIds.add(o.id)
      return true
    })

    // 4. Clean correctOptionIds (mapped 1-4 to A-D)
    const rawCorrect = normalized.correctOptionIds
      .map((id, idx) => normalizeOptionId(id, idx))
      .filter(Boolean)

    // 5. GUARANTEE: Every correctOptionId MUST exist in cleanOptions!
    for (const corrId of rawCorrect) {
      if (!seenIds.has(corrId)) {
        cleanOptions.push({ id: corrId, text: `(Option ${corrId})` })
        seenIds.add(corrId)
      }
    }

    // 6. Guarantee at least 2 options for choice questions
    if (cleanOptions.length < 2) {
      for (const standardId of ['A', 'B', 'C', 'D']) {
        if (!seenIds.has(standardId)) {
          cleanOptions.push({ id: standardId, text: `(Option ${standardId})` })
          seenIds.add(standardId)
          if (cleanOptions.length >= 2) break
        }
      }
    }

    // 7. Ensure correctOptionIds only contains IDs that exist in cleanOptions
    const validOptionIds = new Set(cleanOptions.map(o => o.id))
    cleanCorrectOptionIds = rawCorrect.filter(id => validOptionIds.has(id))

    // 8. If single-correct, ensure at most 1 correct option
    if (normalized.type === 'single-correct' && cleanCorrectOptionIds.length > 1) {
      cleanCorrectOptionIds = [cleanCorrectOptionIds[0]!]
    }
  }

  // Fallback for prompt if empty but has crops
  const cleanPrompt = normalized.prompt.trim() || (normalized.assets.length > 0 ? '(Refer to attached question diagram)' : '')

  return {
    subject: normalized.subject,
    type: normalized.type,
    chapter: normalized.chapter,
    topic: normalized.topic,
    year: normalized.year,
    session: normalized.session,
    difficulty: normalized.difficulty,
    prompt: cleanPrompt,
    options: cleanOptions,
    correctOptionIds: cleanCorrectOptionIds,
    numericalAnswer: isNumerical ? normalized.numericalAnswer.trim() : '',
    numericalTolerance: isNumerical ? (normalized.numericalTolerance.trim() || '0') : '',
    solution: normalized.solution,
    verification: questionVerification,
    answerVerification,
    notes: normalized.notes,
    sourceLabel: normalized.sourceLabel,
    sourceQuestionNumber: normalized.sourceQuestionNumber,
    assets: normalized.assets.map(a => ({
      assetId: a.assetId,
      role: a.role,
      pageNumber: a.pageNumber,
    })),
  }
}
