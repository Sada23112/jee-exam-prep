import type { QuestionDraft, Subject } from '../../question-bank/domain/question'

export interface ImportedQuestionDraft extends QuestionDraft {
  tempId: string
  sourcePageNumber: number
  rawText: string
  uncertainFlags: string[]
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
    notes: '',
    sourceLabel: '',
    sourceQuestionNumber,
    assets: [],
    sourcePageNumber,
    rawText: '',
    uncertainFlags: [],
  }
}

export function validateImportedQuestionForBank(draft: ImportedQuestionDraft): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  if (!draft.prompt.trim()) {
    errors.push('Question prompt cannot be empty.')
  }

  if (draft.type === 'single-correct') {
    if (draft.options.length < 2) {
      errors.push('Single correct question must have at least 2 options.')
    }
    const emptyOptions = draft.options.filter(o => !o.text.trim())
    if (emptyOptions.length > 0) {
      errors.push(`Options ${emptyOptions.map(o => o.id).join(', ')} cannot be empty.`)
    }
    if (draft.answerVerification === 'verified' && draft.correctOptionIds.length !== 1) {
      errors.push('A verified single-correct question must have exactly one correct option selected.')
    }
  } else if (draft.type === 'multiple-correct') {
    if (draft.options.length < 2) {
      errors.push('Multiple correct question must have at least 2 options.')
    }
    if (draft.answerVerification === 'verified' && draft.correctOptionIds.length < 1) {
      errors.push('A verified multiple-correct question must have at least one correct option.')
    }
  } else if (draft.type === 'numerical') {
    if (draft.answerVerification === 'verified') {
      if (!draft.numericalAnswer.trim()) {
        errors.push('Numerical question requires a numerical answer when verified.')
      } else if (!/^-?\d+(?:\.\d+)?$/.test(draft.numericalAnswer.trim())) {
        errors.push('Numerical answer must be a valid decimal number.')
      }
    }
  }

  if (draft.verification === 'verified' && draft.answerVerification !== 'verified') {
    errors.push('Question cannot be verified unless its answer key is also verified.')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function toCleanQuestionDraft(draft: ImportedQuestionDraft): QuestionDraft {
  const isNumerical = draft.type === 'numerical'
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
    verification: draft.verification,
    answerVerification: draft.answerVerification,
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
