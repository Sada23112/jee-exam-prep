import { describe, it, expect } from 'vitest'
import { getPaletteStatus, computePaletteSummary } from '../../src/modules/exam-engine/domain/palette'
import type { QuestionResponseState } from '../../src/modules/exam-engine/domain/palette'
import { scoreExamAttempt } from '../../src/modules/results/domain/scoring'
import { computeTimeLeft } from '../../src/modules/exam-engine/application/timer-service'
import type { Question } from '../../src/modules/question-bank/domain/question'
import type { ExamPreset } from '../../src/modules/exam-engine/domain/preset'

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    schemaVersion: 1,
    ownerId: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    remoteRevision: null,
    subject: 'Physics',
    type: 'single-correct',
    chapter: 'Kinematics',
    topic: 'Motion',
    year: null,
    session: '',
    difficulty: 'unspecified',
    prompt: 'A question prompt',
    options: [
      { id: 'A', text: 'Opt A' },
      { id: 'B', text: 'Opt B' },
      { id: 'C', text: 'Opt C' },
      { id: 'D', text: 'Opt D' },
    ],
    correctOptionIds: ['A'],
    numericalAnswer: '',
    numericalTolerance: '',
    solution: '',
    verification: 'verified',
    answerVerification: 'verified',
    notes: '',
    sourceLabel: '',
    sourceQuestionNumber: '1',
    assets: [],
    ...overrides,
  }
}

function makePreset(overrides: Partial<ExamPreset> = {}): ExamPreset {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    familyId: '33333333-3333-4333-8333-333333333333',
    version: 1,
    schemaVersion: 1,
    ownerId: null,
    revision: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    remoteRevision: null,
    name: 'JEE Main Presets',
    description: 'Standard preset',
    durationMinutes: 180,
    subjects: ['Physics', 'Chemistry', 'Mathematics'],
    questionOrder: 'original',
    navigation: 'free',
    resumePolicy: 'continue-deadline',
    multipleCorrectPolicy: 'exact-set',
    marking: {
      'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
      'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 },
      numerical: { correct: 4, incorrect: -1, unattempted: 0 },
    },
    ...overrides,
  }
}

describe('JEE Palette State Machine', () => {
  const qSingle = makeQuestion({ id: 'q1', type: 'single-correct' })
  const qNum = makeQuestion({ id: 'q2', type: 'numerical', options: [], correctOptionIds: [], numericalAnswer: '42', numericalTolerance: '0.1' })

  it('detects not-visited when response is undefined or visited is false', () => {
    expect(getPaletteStatus(qSingle, undefined)).toBe('not-visited')
    expect(getPaletteStatus(qSingle, {
      questionId: 'q1', selectedOptionIds: [], numericalAnswer: '', visited: false, markedForReview: false, timeSpentMs: 0,
    })).toBe('not-visited')
  })

  it('detects not-answered when visited is true but no answer and not marked', () => {
    expect(getPaletteStatus(qSingle, {
      questionId: 'q1', selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 1000,
    })).toBe('not-answered')

    expect(getPaletteStatus(qNum, {
      questionId: 'q2', selectedOptionIds: [], numericalAnswer: '   ', visited: true, markedForReview: false, timeSpentMs: 1000,
    })).toBe('not-answered')
  })

  it('detects answered when option is selected or numerical answer entered', () => {
    expect(getPaletteStatus(qSingle, {
      questionId: 'q1', selectedOptionIds: ['B'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 1000,
    })).toBe('answered')

    expect(getPaletteStatus(qNum, {
      questionId: 'q2', selectedOptionIds: [], numericalAnswer: '42.0', visited: true, markedForReview: false, timeSpentMs: 1000,
    })).toBe('answered')
  })

  it('detects marked-for-review when visited and marked without answer', () => {
    expect(getPaletteStatus(qSingle, {
      questionId: 'q1', selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: true, timeSpentMs: 1000,
    })).toBe('marked-for-review')
  })

  it('detects answered-and-marked when answered and marked for review', () => {
    expect(getPaletteStatus(qSingle, {
      questionId: 'q1', selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: true, timeSpentMs: 1000,
    })).toBe('answered-and-marked')

    expect(getPaletteStatus(qNum, {
      questionId: 'q2', selectedOptionIds: [], numericalAnswer: '-5.2', visited: true, markedForReview: true, timeSpentMs: 1000,
    })).toBe('answered-and-marked')
  })

  it('computes accurate palette summary counts across all 5 states', () => {
    const questions = [
      makeQuestion({ id: 'q1' }),
      makeQuestion({ id: 'q2' }),
      makeQuestion({ id: 'q3' }),
      makeQuestion({ id: 'q4' }),
      makeQuestion({ id: 'q5' }),
    ]
    const responses: Record<string, QuestionResponseState> = {
      q1: { questionId: 'q1', selectedOptionIds: [], numericalAnswer: '', visited: false, markedForReview: false, timeSpentMs: 0 },
      q2: { questionId: 'q2', selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 10 },
      q3: { questionId: 'q3', selectedOptionIds: ['B'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 20 },
      q4: { questionId: 'q4', selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: true, timeSpentMs: 30 },
      q5: { questionId: 'q5', selectedOptionIds: ['C'], numericalAnswer: '', visited: true, markedForReview: true, timeSpentMs: 40 },
    }

    const summary = computePaletteSummary(questions, responses)
    expect(summary).toEqual({
      total: 5,
      notVisited: 1,
      notAnswered: 1,
      answered: 1,
      markedForReview: 1,
      answeredAndMarked: 1,
    })
  })
})

describe('Deterministic Scoring Engine', () => {
  const preset = makePreset()

  it('scores single-correct question correctly for right and wrong answers', () => {
    const q1 = makeQuestion({ id: 'q1', type: 'single-correct', correctOptionIds: ['A'] })
    const q2 = makeQuestion({ id: 'q2', type: 'single-correct', correctOptionIds: ['B'] })
    const q3 = makeQuestion({ id: 'q3', type: 'single-correct', correctOptionIds: ['C'] })

    const responses: Record<string, QuestionResponseState> = {
      q1: { questionId: 'q1', selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 10_000 },
      q2: { questionId: 'q2', selectedOptionIds: ['C'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 15_000 },
      q3: { questionId: 'q3', selectedOptionIds: [], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 5_000 },
    }

    const report = scoreExamAttempt(preset, [q1, q2, q3], responses)
    expect(report.totalScore).toBe(4 - 1 + 0) // 3
    expect(report.maxPossibleScore).toBe(12)
    expect(report.correct).toBe(1)
    expect(report.incorrect).toBe(1)
    expect(report.unattempted).toBe(1)
    expect(report.accuracyPercentage).toBe(50) // 1 out of 2 attempted
  })

  it('scores multiple-correct questions with exact-set matching', () => {
    const q = makeQuestion({ id: 'qm', type: 'multiple-correct', correctOptionIds: ['A', 'C'] })

    // Exact match
    const repCorrect = scoreExamAttempt(preset, [q], {
      qm: { questionId: 'qm', selectedOptionIds: ['C', 'A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 20_000 },
    })
    expect(repCorrect.totalScore).toBe(4)
    expect(repCorrect.correct).toBe(1)

    // Partial answer is incorrect in exact-set policy
    const repPartial = scoreExamAttempt(preset, [q], {
      qm: { questionId: 'qm', selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 20_000 },
    })
    expect(repPartial.totalScore).toBe(-2)
    expect(repPartial.incorrect).toBe(1)
  })

  it('scores numerical questions within tolerance', () => {
    const q = makeQuestion({
      id: 'qn',
      type: 'numerical',
      options: [],
      correctOptionIds: [],
      numericalAnswer: '3.14',
      numericalTolerance: '0.02',
    })

    // Within tolerance 3.12 to 3.16
    const repRight = scoreExamAttempt(preset, [q], {
      qn: { questionId: 'qn', selectedOptionIds: [], numericalAnswer: '3.15', visited: true, markedForReview: false, timeSpentMs: 12_000 },
    })
    expect(repRight.totalScore).toBe(4)

    // Outside tolerance
    const repWrong = scoreExamAttempt(preset, [q], {
      qn: { questionId: 'qn', selectedOptionIds: [], numericalAnswer: '3.17', visited: true, markedForReview: false, timeSpentMs: 12_000 },
    })
    expect(repWrong.totalScore).toBe(-1)
  })

  it('marks unverified questions as ungraded and keeps totalScore null', () => {
    const qVerified = makeQuestion({ id: 'qv', verification: 'verified', answerVerification: 'verified', correctOptionIds: ['A'] })
    const qUnverified = makeQuestion({ id: 'qu', verification: 'needs-review', answerVerification: 'needs-review', correctOptionIds: ['B'] })

    const responses: Record<string, QuestionResponseState> = {
      qv: { questionId: 'qv', selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 10_000 },
      qu: { questionId: 'qu', selectedOptionIds: ['B'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 10_000 },
    }

    const report = scoreExamAttempt(preset, [qVerified, qUnverified], responses)
    expect(report.totalScore).toBeNull() // Mandated null when any question is unverified
    expect(report.ungraded).toBe(1)
    expect(report.correct).toBe(1)
    expect(report.evaluations.find(e => e.questionId === 'qu')?.status).toBe('ungraded')
  })
})

describe('Timer Service Calculations', () => {
  it('formats remaining hours, minutes, and seconds properly', () => {
    const base = 1700000000000
    const target = new Date(base + 3665 * 1000).toISOString() // 1 hour, 1 min, 5 sec
    const result = computeTimeLeft(target, base)
    expect(result.hours).toBe(1)
    expect(result.minutes).toBe(1)
    expect(result.seconds).toBe(5)
    expect(result.formatted).toBe('01:01:05')
    expect(result.isExpired).toBe(false)
  })

  it('detects urgency when remaining time is less than 5 minutes', () => {
    const base = 1700000000000
    const target = new Date(base + 180 * 1000).toISOString() // 3 minutes
    const result = computeTimeLeft(target, base)
    expect(result.isUrgent).toBe(true)
    expect(result.formatted).toBe('03:00')
  })

  it('detects expired time when deadline has passed', () => {
    const base = 1700000000000
    const target = new Date(base - 1000).toISOString()
    const result = computeTimeLeft(target, base)
    expect(result.isExpired).toBe(true)
    expect(result.totalSeconds).toBe(0)
  })
})
