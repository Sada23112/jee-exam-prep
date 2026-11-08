import { describe, it, expect } from 'vitest'
import {
  computeChapterPerformance,
  generateLocalDiagnosticReport,
  buildAiTutorPrompt,
} from '../../src/modules/ai-tutor/application/tutor-service'
import type { ExamScoreReport } from '../../src/modules/results/domain/scoring'
import type { Question } from '../../src/modules/question-bank/domain/question'

function makeTestQuestion(id: string, subject: 'Physics' | 'Chemistry', chapter: string): Question {
  return {
    id,
    schemaVersion: 1,
    ownerId: null,
    revision: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    remoteRevision: null,
    subject,
    type: 'single-correct',
    chapter,
    topic: 'Topic A',
    year: 2024,
    session: 'Jan 27 Shift 1',
    difficulty: 'medium',
    prompt: 'Sample question prompt',
    options: [
      { id: 'A', text: 'Opt A' },
      { id: 'B', text: 'Opt B' },
    ],
    correctOptionIds: ['A'],
    numericalAnswer: '',
    numericalTolerance: '0',
    solution: 'Solution text',
    verification: 'verified',
    answerVerification: 'verified',
    notes: '',
    sourceLabel: '2024 Shift 1',
    sourceQuestionNumber: '1',
    assets: [],
  }
}

describe('AI Tutor & Performance Diagnostics', () => {
  const q1 = makeTestQuestion('q-1', 'Physics', 'Thermodynamics')
  const q2 = makeTestQuestion('q-2', 'Physics', 'Thermodynamics')
  const q3 = makeTestQuestion('q-3', 'Physics', 'Electrostatics')
  const questions = [q1, q2, q3]

  const mockReport: ExamScoreReport = {
    totalScore: 7,
    maxPossibleScore: 12,
    totalQuestions: 3,
    attempted: 3,
    correct: 2,
    incorrect: 1,
    unattempted: 0,
    ungraded: 0,
    accuracyPercentage: 67,
    totalTimeSpentMs: 360_000,
    subjectSummaries: {
      Physics: {
        subject: 'Physics',
        totalQuestions: 3,
        attempted: 3,
        correct: 2,
        incorrect: 1,
        unattempted: 0,
        ungraded: 0,
        score: 7,
        maxPossibleScore: 12,
        timeSpentMs: 360_000,
      },
      Chemistry: {
        subject: 'Chemistry',
        totalQuestions: 0,
        attempted: 0,
        correct: 0,
        incorrect: 0,
        unattempted: 0,
        ungraded: 0,
        score: 0,
        maxPossibleScore: 0,
        timeSpentMs: 0,
      },
      Mathematics: {
        subject: 'Mathematics',
        totalQuestions: 0,
        attempted: 0,
        correct: 0,
        incorrect: 0,
        unattempted: 0,
        ungraded: 0,
        score: 0,
        maxPossibleScore: 0,
        timeSpentMs: 0,
      },
    },
    evaluations: [
      {
        questionId: 'q-1',
        subject: 'Physics',
        status: 'correct',
        marksAwarded: 4,
        timeSpentMs: 60_000,
        candidateAnswerText: 'A',
        correctAnswerText: 'A',
        isKeyVerified: true,
      },
      {
        questionId: 'q-2',
        subject: 'Physics',
        status: 'incorrect',
        marksAwarded: -1,
        timeSpentMs: 180_000, // 3 minutes -> Time Trap!
        candidateAnswerText: 'B',
        correctAnswerText: 'A',
        isKeyVerified: true,
      },
      {
        questionId: 'q-3',
        subject: 'Physics',
        status: 'correct',
        marksAwarded: 4,
        timeSpentMs: 120_000,
        candidateAnswerText: 'A',
        correctAnswerText: 'A',
        isKeyVerified: true,
      },
    ],
  }

  it('computes chapter-wise performance metrics accurately', () => {
    const chapters = computeChapterPerformance(mockReport, questions)
    expect(chapters.length).toBe(2)

    const thermo = chapters.find(c => c.chapter === 'Thermodynamics')
    expect(thermo).toBeDefined()
    expect(thermo?.total).toBe(2)
    expect(thermo?.correct).toBe(1)
    expect(thermo?.incorrect).toBe(1)
    expect(thermo?.score).toBe(3)
    expect(thermo?.accuracy).toBe(50)

    const electro = chapters.find(c => c.chapter === 'Electrostatics')
    expect(electro).toBeDefined()
    expect(electro?.correct).toBe(1)
    expect(electro?.accuracy).toBe(100)
    expect(electro?.score).toBe(4)
  })

  it('identifies negative marking loss and time traps in local diagnostic', () => {
    const diag = generateLocalDiagnosticReport(mockReport, questions)
    expect(diag.negativeMarksLost).toBe(1)
    expect(diag.potentialScoreWithoutNegativeMarks).toBe(8) // 7 + 1 = 8

    expect(diag.timeTraps.length).toBe(1)
    expect(diag.timeTraps[0]).toMatchObject({
      questionNumber: 2,
      subject: 'Physics',
      chapter: 'Thermodynamics',
      status: 'incorrect',
      marksLost: 1,
    })
  })

  it('builds comprehensive AI Tutor prompt with chapter details and traps', () => {
    const prompt = buildAiTutorPrompt(mockReport, questions, 'JEE Full Mock 1')
    expect(prompt).toContain('JEE Full Mock 1')
    expect(prompt).toContain('Thermodynamics')
    expect(prompt).toContain('Electrostatics')
    expect(prompt).toContain('Time Traps')
    expect(prompt).toContain('Q2')
  })
})
