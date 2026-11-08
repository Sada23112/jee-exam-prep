import { describe, expect, it } from 'vitest'
import { createEmptyQuestionDraft, questionDraftSchema, questionSchema } from '../../src/modules/question-bank/domain/question'
import { historySchema } from '../../src/modules/results/domain/history'
import { presetSchema } from '../../src/modules/exam-engine/domain/preset'

const createdAt = '2026-01-01T00:00:00.000Z'
function meta() {
  return { id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, revision: 1, createdAt, updatedAt: createdAt, deletedAt: null, remoteRevision: null }
}
function actual() {
  const question = questionSchema.parse({
    ...meta(), ...createEmptyQuestionDraft(), type: 'multiple-correct', prompt: 'Select all',
    verification: 'verified', answerVerification: 'verified',
    options: [{ id: 'a', text: 'one' }, { id: 'b', text: 'two' }], correctOptionIds: ['a', 'b'],
  })
  const preset = presetSchema.parse({
    ...meta(), familyId: crypto.randomUUID(), version: 1, name: 'Custom', description: '', durationMinutes: 60,
    subjects: ['Physics'], questionOrder: 'original', navigation: 'free', resumePolicy: 'continue-deadline',
    marking: { 'single-correct': { correct: 1, incorrect: 0, unattempted: 0 }, 'multiple-correct': { correct: 1, incorrect: 0, unattempted: 0 }, numerical: { correct: 1, incorrect: 0, unattempted: 0 } }, multipleCorrectPolicy: 'exact-set',
  })
  return {
    ...meta(), name: 'Attempt', presetSnapshot: preset, questionSnapshots: [question], startedAt: createdAt,
    deadlineAt: '2026-01-01T01:00:00.000Z', submittedAt: null, status: 'in-progress',
    responses: [{ questionId: question.id, selectedOptionIds: ['a', 'b'], numericalAnswer: '', visited: true, markedForReview: true, timeSpentMs: 0 }], totalScore: null,
  }
}

describe('domain safety boundaries', () => {
  it('keeps multiple-correct selection order but rejects duplicate keys/selections', () => {
    const history = actual()
    expect(historySchema.parse(history).responses[0]!.selectedOptionIds).toEqual(['a', 'b'])
    expect(historySchema.safeParse({ ...history, responses: [{ ...history.responses[0], selectedOptionIds: ['a', 'a'] }] }).success).toBe(false)
    expect(questionSchema.safeParse({ ...history.questionSnapshots[0], correctOptionIds: [] }).success).toBe(false)
  })
  it('rejects a verified A key on the exact empty draft and every blank option in incomplete choice questions', () => {
    const emptyDraft = { ...createEmptyQuestionDraft(), answerVerification: 'verified' as const, correctOptionIds: ['A'] }
    expect(questionDraftSchema.safeParse(emptyDraft).success).toBe(false)
    expect(questionSchema.safeParse({ ...meta(), ...emptyDraft }).success).toBe(false)
    for (const type of ['single-correct', 'multiple-correct'] as const) {
      const filled = { ...emptyDraft, type, options: emptyDraft.options.map(option => ({ ...option, text: `Choice ${option.id}` })) }
      expect(questionDraftSchema.safeParse(filled).success).toBe(true)
      for (const blankId of ['A', 'B', 'C', 'D']) {
        expect(questionDraftSchema.safeParse({ ...filled, options: filled.options.map(option => option.id === blankId ? { ...option, text: ' \n\t' } : option) }).success).toBe(false)
      }
    }
  })
  it('rejects snapshots created after the attempt and already-archived snapshots', () => {
    const history = actual()
    expect(historySchema.safeParse(history).success).toBe(true)
    expect(historySchema.safeParse({ ...history, questionSnapshots: [{ ...history.questionSnapshots[0], updatedAt: '2026-01-01T00:00:01.000Z' }] }).success).toBe(false)
    expect(historySchema.safeParse({ ...history, presetSnapshot: { ...history.presetSnapshot, deletedAt: createdAt } }).success).toBe(false)
    expect(historySchema.safeParse({ ...history, questionSnapshots: [{ ...history.questionSnapshots[0], deletedAt: createdAt }] }).success).toBe(false)
  })
  it('rejects responses outside snapshot subjects and bounds persisted authored data', () => {
    const history = actual()
    expect(historySchema.safeParse({ ...history, questionSnapshots: [{ ...history.questionSnapshots[0], subject: 'Chemistry' }] }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...createEmptyQuestionDraft(), prompt: 'x'.repeat(200_001) }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...createEmptyQuestionDraft(), type: 'numerical', options: [], numericalAnswer: '9'.repeat(129) }).success).toBe(false)
    expect(questionDraftSchema.safeParse({ ...createEmptyQuestionDraft(), assets: [{ assetId: crypto.randomUUID(), role: 'page', pageNumber: 0 }] }).success).toBe(false)
  })
})
