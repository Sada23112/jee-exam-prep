import { describe, expect, it } from 'vitest'
import { createEmptyQuestionDraft, questionDraftSchema, questionSchema } from '../../src/modules/question-bank/domain/question'
import type { Question, QuestionDraft } from '../../src/modules/question-bank/domain/question'
import { collectionSchema } from '../../src/modules/question-bank/domain/collection'
import { presetDraftSchema, presetSchema } from '../../src/modules/exam-engine/domain/preset'
import type { ExamPreset, PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { historySchema } from '../../src/modules/results/domain/history'

const time = '2026-01-01T00:00:00.000Z'
const metadata = () => ({ id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, revision: 1, createdAt: time, updatedAt: time, deletedAt: null, remoteRevision: null })
function choice(type: 'single-correct' | 'multiple-correct' = 'single-correct'): QuestionDraft {
  return {
    ...createEmptyQuestionDraft(), type, verification: 'verified', answerVerification: 'verified',
    prompt: '  Find $x$.\nDo not change this wording.  ',
    options: [{ id: 'A', text: '  $1$ ' }, { id: 'B', text: '\n$2$\n' }],
    correctOptionIds: type === 'single-correct' ? ['A'] : ['A', 'B'], solution: '  Original solution\n',
  }
}
function numerical(): QuestionDraft {
  return { ...choice(), type: 'numerical', options: [], correctOptionIds: [], numericalAnswer: '-.25', numericalTolerance: '0.001' }
}
const presetDraft: PresetDraft = {
  name: 'Custom practice', description: 'User-authored rules', durationMinutes: 180, subjects: ['Physics'],
  questionOrder: 'original', navigation: 'free', resumePolicy: 'continue-deadline', multipleCorrectPolicy: 'exact-set',
  marking: {
    'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
    'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 },
    numerical: { correct: 4, incorrect: 0, unattempted: 0 },
  },
}
function historyFixture() {
  const question: Question = { ...metadata(), ...choice() }
  const preset: ExamPreset = { ...metadata(), ...presetDraft, familyId: crypto.randomUUID(), version: 1 }
  return {
    ...metadata(), name: 'Actual attempt', presetSnapshot: preset, questionSnapshots: [question],
    startedAt: time, deadlineAt: '2026-01-01T03:00:00.000Z', submittedAt: null, status: 'in-progress' as const,
    responses: [{ questionId: question.id, selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 1_000 }],
    totalScore: null,
  }
}

describe('question contracts and semantic validation', () => {
  it('allows incomplete drafts for every type with missing transcription and key', () => {
    for (const type of ['single-correct', 'multiple-correct', 'numerical'] as const) {
      expect(questionDraftSchema.safeParse({ ...createEmptyQuestionDraft(), type, options: [] }).success).toBe(true)
    }
    expect(createEmptyQuestionDraft()).not.toBe(createEmptyQuestionDraft())
  })
  it.each([choice(), choice('multiple-correct'), numerical()])('accepts full verified content for $type', draft => {
    expect(questionDraftSchema.safeParse(draft).success).toBe(true)
    expect(questionSchema.safeParse({ ...metadata(), ...draft }).success).toBe(true)
  })
  it('preserves prompt, choices, and solution byte-for-byte while normalizing metadata', () => {
    const input = { ...choice(), chapter: '  Mechanics  ', sourceLabel: '  My scan  ' }
    const parsed = questionDraftSchema.parse(input)
    expect(parsed.prompt).toBe(input.prompt)
    expect(parsed.options).toEqual(input.options)
    expect(parsed.solution).toBe(input.solution)
    expect(parsed.chapter).toBe('Mechanics')
    expect(parsed.sourceLabel).toBe('My scan')
  })
  it('separates transcription verification from answer-key verification', () => {
    expect(questionDraftSchema.safeParse({ ...choice(), answerVerification: 'needs-review' }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...choice(), verification: 'incomplete', prompt: '' }).success).toBe(true)
    expect(questionDraftSchema.safeParse({ ...choice(), correctOptionIds: [] }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...choice(), verification: 'needs-review', answerVerification: 'needs-review', correctOptionIds: [] }).success).toBe(true)
  })
  it('requires page/crop or prompt when non-incomplete and transcription when verified', () => {
    const scanned = { ...numerical(), prompt: '', verification: 'needs-review', assets: [{ assetId: crypto.randomUUID(), role: 'page', pageNumber: 1 }] }
    expect(questionDraftSchema.safeParse(scanned).success).toBe(true)
    expect(questionDraftSchema.safeParse({ ...scanned, verification: 'verified' }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...scanned, assets: [] }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...scanned, assets: [{ ...scanned.assets[0], role: 'diagram' }] }).success).toBe(false)
  })
  it.each([
    { correctOptionIds: ['A', 'A'] }, { correctOptionIds: ['missing'] }, { correctOptionIds: ['A', 'B'] },
    { options: [{ id: 'A', text: 'one' }, { id: 'A', text: 'two' }] },
    { options: [{ id: 'A', text: '   ' }, { id: 'B', text: 'two' }] },
    { options: [{ id: 'A', text: 'one' }] }, { numericalAnswer: '1' }, { numericalTolerance: '0' },
  ])('rejects invalid choices/keys: %j', patch => expect(questionDraftSchema.safeParse({ ...choice(), ...patch }).success).toBe(false))
  it.each(['NaN', 'Infinity', '-Infinity', '1e3', '1e-3', '1+2', '1.', '0x10', ' 1', '1/2'])('rejects unsafe numerical syntax %s even in drafts', numericalAnswer => {
    expect(questionDraftSchema.safeParse({ ...numerical(), verification: 'incomplete', answerVerification: 'incomplete', numericalAnswer }).success).toBe(false)
  })
  it('enforces numerical type keys and nonnegative explicit tolerance', () => {
    for (const patch of [{ numericalAnswer: '' }, { numericalTolerance: '' }, { numericalTolerance: '-0.1' }, { numericalTolerance: 'NaN' }, { correctOptionIds: ['A'] }, { options: [{ id: 'A', text: '1' }] }]) {
      expect(questionDraftSchema.safeParse({ ...numerical(), ...patch }).success).toBe(false)
    }
    expect(questionDraftSchema.safeParse({ ...numerical(), numericalTolerance: '0', numericalAnswer: '+12.50' }).success).toBe(true)
  })
  it('rejects future schemas, malformed identities, dates, duplicates, and unknown fields', () => {
    const question = { ...metadata(), ...choice() }
    for (const patch of [{ schemaVersion: 2 }, { id: 'not-a-uuid' }, { ownerId: 'someone' }, { revision: 0 }, { updatedAt: 'bad-date' }, { updatedAt: '2025-01-01T00:00:00.000Z' }, { deletedAt: '2027-01-01T00:00:00.000Z' }, { unexpected: true }]) {
      expect(questionSchema.safeParse({ ...question, ...patch }).success).toBe(false)
    }
    expect(questionDraftSchema.safeParse({ ...choice(), options: [{ id: 'A', text: 'one', extra: true }, { id: 'B', text: 'two' }] }).success).toBe(false)
    const asset = { assetId: crypto.randomUUID(), role: 'page', pageNumber: 1 }
    expect(questionDraftSchema.safeParse({ ...choice(), assets: [asset, asset] }).success).toBe(false)
  })
  it('supports and validates option diagrams for graph and diagram-based choices', () => {
    const assetA = { assetId: crypto.randomUUID(), role: 'diagram' as const, pageNumber: null }
    const assetB = { assetId: crypto.randomUUID(), role: 'diagram' as const, pageNumber: null }

    // Valid: Options with text and diagram
    const qWithDiagrams = {
      ...choice(),
      assets: [assetA, assetB],
      options: [
        { id: 'A', text: 'Graph A', diagramAssetId: assetA.assetId },
        { id: 'B', text: 'Graph B', diagramAssetId: assetB.assetId },
      ],
    }
    expect(questionDraftSchema.safeParse(qWithDiagrams).success).toBe(true)

    // Valid: Diagram-only options (blank text allowed when diagramAssetId is present)
    const qDiagramOnly = {
      ...choice(),
      assets: [assetA, assetB],
      options: [
        { id: 'A', text: '', diagramAssetId: assetA.assetId },
        { id: 'B', text: '', diagramAssetId: assetB.assetId },
      ],
    }
    expect(questionDraftSchema.safeParse(qDiagramOnly).success).toBe(true)

    // Invalid: diagramAssetId references an asset ID not present in question assets
    const missingAsset = crypto.randomUUID()
    const qMissingAsset = {
      ...choice(),
      assets: [assetA],
      options: [
        { id: 'A', text: 'Valid', diagramAssetId: assetA.assetId },
        { id: 'B', text: 'Invalid', diagramAssetId: missingAsset },
      ],
    }
    expect(questionDraftSchema.safeParse(qMissingAsset).success).toBe(false)

    // Invalid: Option has blank text and no diagramAssetId when verified
    const qBlankNoDiagram = {
      ...choice(),
      assets: [assetA],
      options: [
        { id: 'A', text: 'Valid', diagramAssetId: assetA.assetId },
        { id: 'B', text: '   ', diagramAssetId: null },
      ],
    }
    expect(questionDraftSchema.safeParse(qBlankNoDiagram).success).toBe(false)
  })
})

describe('collection, user-authored preset and future history contracts', () => {
  it('validates strict collections, unique memberships, and metadata', () => {
    const collection = { ...metadata(), name: '  Revision  ', description: '', questionIds: [crypto.randomUUID()] }
    expect(collectionSchema.parse(collection).name).toBe('Revision')
    expect(collectionSchema.safeParse({ ...collection, questionIds: [...collection.questionIds, ...collection.questionIds] }).success).toBe(false)
    expect(collectionSchema.safeParse({ ...collection, name: '  ' }).success).toBe(false)
  })
  it('validates all marking rules, distinct subjects and immutable preset rows', () => {
    expect(presetDraftSchema.safeParse(presetDraft).success).toBe(true)
    const preset = { ...metadata(), ...presetDraft, familyId: crypto.randomUUID(), version: 1 }
    for (const patch of [{ durationMinutes: 0 }, { durationMinutes: 1.5 }, { subjects: [] }, { subjects: ['Physics', 'Physics'] }, { revision: 2 }, { version: 0 }, { multipleCorrectPolicy: 'partial-credit' }, { marking: { ...presetDraft.marking, numerical: { correct: Infinity, incorrect: 0, unattempted: 0 } } }, { officialJee: true }]) {
      expect(presetSchema.safeParse({ ...preset, ...patch }).success).toBe(false)
    }
  })
  it('accepts an actual unscored in-progress/submitted snapshot without creating attempts', () => {
    const actual = historyFixture()
    expect(historySchema.safeParse(actual).success).toBe(true)
    expect(historySchema.safeParse({ ...actual, status: 'submitted', submittedAt: time, totalScore: 4 }).success).toBe(true)
    const unverified = { ...actual.questionSnapshots[0], verification: 'needs-review', answerVerification: 'needs-review' }
    expect(historySchema.safeParse({ ...actual, questionSnapshots: [unverified], status: 'submitted', submittedAt: time, totalScore: null }).success).toBe(true)
    expect(historySchema.safeParse({ ...actual, questionSnapshots: [unverified], status: 'submitted', submittedAt: time, totalScore: 4 }).success).toBe(false)
  })
  it('rejects history temporal inconsistencies, missing refs, wrong response types and invented scores', () => {
    const actual = historyFixture()
    for (const patch of [{ deadlineAt: time }, { startedAt: '2025-12-31T00:00:00.000Z' }, { submittedAt: time }, { totalScore: 4 }, { status: 'submitted' }, { questionSnapshots: [] }, { responses: [actual.responses[0], actual.responses[0]] }]) {
      expect(historySchema.safeParse({ ...actual, ...patch }).success).toBe(false)
    }
    const response = actual.responses[0]!
    for (const patch of [{ questionId: crypto.randomUUID() }, { selectedOptionIds: ['missing'] }, { selectedOptionIds: ['A', 'B'] }, { numericalAnswer: '1' }, { timeSpentMs: -1 }, { visited: 'true' }]) {
      expect(historySchema.safeParse({ ...actual, responses: [{ ...response, ...patch }] }).success).toBe(false)
    }
    const q = { ...metadata(), ...numerical() }
    const numericHistory = { ...actual, questionSnapshots: [q], responses: [{ ...response, questionId: q.id, selectedOptionIds: [], numericalAnswer: '0.5' }] }
    expect(historySchema.safeParse(numericHistory).success).toBe(true)
    expect(historySchema.safeParse({ ...numericHistory, responses: [{ ...numericHistory.responses[0], numericalAnswer: '1e2' }] }).success).toBe(false)
  })
})
