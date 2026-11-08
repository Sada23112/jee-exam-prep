import { describe, it, expect, beforeEach } from 'vitest'
import { WorkspaceStore } from '../../src/infrastructure/storage/workspace'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import type { PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { SUBJECTS } from '../../src/shared/ui/labels'

function mockPresetDraft(): PresetDraft {
  return {
    name: 'Practice Mock 1',
    description: '30 min test',
    durationMinutes: 30,
    subjects: [...SUBJECTS],
    questionOrder: 'original',
    navigation: 'free',
    resumePolicy: 'continue-deadline',
    multipleCorrectPolicy: 'exact-set',
    marking: {
      'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
      'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 },
      numerical: { correct: 4, incorrect: -1, unattempted: 0 },
    },
  }
}

describe('Workspace Exam Storage Integration', () => {
  let store: WorkspaceStore

  beforeEach(async () => {
    store = new WorkspaceStore(`test-exam-${Math.random().toString(36).substring(2, 8)}`)
    await store.open()
  })

  it('starts an examination session with frozen snapshots and initial responses', async () => {
    const preset = await store.savePreset(mockPresetDraft())
    const qDraft1 = createEmptyQuestionDraft()
    qDraft1.prompt = 'What is velocity?'
    qDraft1.verification = 'verified'
    qDraft1.answerVerification = 'verified'
    qDraft1.options = [
      { id: 'A', text: 'Displacement / time' },
      { id: 'B', text: 'Distance / time' },
    ]
    qDraft1.correctOptionIds = ['A']
    const q1 = await store.saveQuestion(qDraft1)

    const qDraft2 = createEmptyQuestionDraft()
    qDraft2.subject = 'Chemistry'
    qDraft2.prompt = 'What is pH of pure water?'
    qDraft2.type = 'numerical'
    qDraft2.options = []
    qDraft2.numericalAnswer = '7'
    qDraft2.numericalTolerance = '0.1'
    qDraft2.verification = 'verified'
    qDraft2.answerVerification = 'verified'
    const q2 = await store.saveQuestion(qDraft2)

    const exam = await store.startExam('My First Test', preset, [q1, q2])

    expect(exam.name).toBe('My First Test')
    expect(exam.status).toBe('in-progress')
    expect(exam.revision).toBe(1)
    expect(exam.questionSnapshots).toHaveLength(2)
    expect(exam.responses).toHaveLength(2)
    expect(exam.responses[0]?.visited).toBe(true) // First question auto-visited
    expect(exam.responses[1]?.visited).toBe(false)
    expect(exam.totalScore).toBeNull()

    const retrieved = await store.getExam(exam.id)
    expect(retrieved?.id).toBe(exam.id)

    const history = await store.listHistory()
    expect(history).toHaveLength(1)
    expect(history[0]?.id).toBe(exam.id)
  })

  it('updates responses and rejects stale revision edits with ConflictError', async () => {
    const preset = await store.savePreset(mockPresetDraft())
    const qDraft = createEmptyQuestionDraft()
    qDraft.prompt = 'Sample question'
    qDraft.verification = 'verified'
    qDraft.answerVerification = 'verified'
    qDraft.options = [
      { id: 'A', text: 'Opt 1' },
      { id: 'B', text: 'Opt 2' },
    ]
    qDraft.correctOptionIds = ['A']
    const q = await store.saveQuestion(qDraft)

    const exam = await store.startExam('Revision Test', preset, [q])

    // Save response for q
    const updated = await store.saveExamResponses(exam.id, exam.revision, [{
      questionId: q.id,
      selectedOptionIds: ['A'],
      numericalAnswer: '',
      visited: true,
      markedForReview: false,
      timeSpentMs: 5000,
    }])

    expect(updated.revision).toBe(2)
    expect(updated.responses[0]?.selectedOptionIds).toEqual(['A'])
    expect(updated.status).toBe('in-progress')

    // Stale revision save must fail
    await expect(store.saveExamResponses(exam.id, 1, [{
      questionId: q.id,
      selectedOptionIds: ['B'],
      numericalAnswer: '',
      visited: true,
      markedForReview: false,
      timeSpentMs: 6000,
    }])).rejects.toThrow(/revision mismatch/i)
  })

  it('finalizes examination submission and computes deterministic score', async () => {
    const preset = await store.savePreset(mockPresetDraft())
    const qDraft = createEmptyQuestionDraft()
    qDraft.prompt = 'Acceleration due to gravity near earth surface?'
    qDraft.verification = 'verified'
    qDraft.answerVerification = 'verified'
    qDraft.options = [
      { id: 'A', text: '9.8 m/s^2' },
      { id: 'B', text: '1.6 m/s^2' },
    ]
    qDraft.correctOptionIds = ['A']
    const q = await store.saveQuestion(qDraft)

    const exam = await store.startExam('Finalize Test', preset, [q])

    const submitted = await store.saveExamResponses(exam.id, exam.revision, [{
      questionId: q.id,
      selectedOptionIds: ['A'],
      numericalAnswer: '',
      visited: true,
      markedForReview: false,
      timeSpentMs: 12000,
    }], true) // finalizeSubmit = true

    expect(submitted.status).toBe('submitted')
    expect(submitted.submittedAt).not.toBeNull()
    expect(submitted.totalScore).toBe(4) // 4 marks for correct single-correct answer

    // Once submitted, further saves must be rejected
    await expect(store.saveExamResponses(exam.id, submitted.revision, [{
      questionId: q.id,
      selectedOptionIds: ['B'],
      numericalAnswer: '',
      visited: true,
      markedForReview: false,
      timeSpentMs: 13000,
    }])).rejects.toThrow(/already submitted/i)
  })

  it('archives examination history with revision check', async () => {
    const preset = await store.savePreset(mockPresetDraft())
    const qDraft = createEmptyQuestionDraft()
    qDraft.prompt = 'Dummy question'
    qDraft.verification = 'verified'
    qDraft.answerVerification = 'verified'
    qDraft.options = [
      { id: 'A', text: 'Choice A' },
      { id: 'B', text: 'Choice B' },
    ]
    qDraft.correctOptionIds = ['A']
    const q = await store.saveQuestion(qDraft)

    const exam = await store.startExam('Archive Test', preset, [q])

    await store.archiveHistory([exam.id], { [exam.id]: exam.revision })
    const active = await store.listHistory()
    expect(active).toHaveLength(0) // Deleted records filtered out
  })
})
