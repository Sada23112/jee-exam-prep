import type { ExamPreset } from '../../exam-engine/domain/preset'
import type { Question, Subject } from '../../question-bank/domain/question'
import { hasAnsweredQuestion, type QuestionResponseState } from '../../exam-engine/domain/palette'

export type QuestionScoreStatus = 'correct' | 'incorrect' | 'unattempted' | 'ungraded'

export interface QuestionEvaluation {
  questionId: string
  subject: Subject
  status: QuestionScoreStatus
  marksAwarded: number
  timeSpentMs: number
  candidateAnswerText: string
  correctAnswerText: string
  isKeyVerified: boolean
}

export interface SubjectScoreSummary {
  subject: Subject
  totalQuestions: number
  attempted: number
  correct: number
  incorrect: number
  unattempted: number
  ungraded: number
  score: number
  maxPossibleScore: number
  timeSpentMs: number
}

export interface ExamScoreReport {
  totalScore: number | null
  maxPossibleScore: number
  totalQuestions: number
  attempted: number
  correct: number
  incorrect: number
  unattempted: number
  ungraded: number
  accuracyPercentage: number
  totalTimeSpentMs: number
  evaluations: QuestionEvaluation[]
  subjectSummaries: Record<Subject, SubjectScoreSummary>
}

function formatCandidateAnswer(question: Question, response: QuestionResponseState | undefined): string {
  if (!response) return 'Unattempted'
  if (question.type === 'numerical') {
    return response.numericalAnswer.trim() || 'Unattempted'
  }
  if (!response.selectedOptionIds.length) return 'Unattempted'
  return response.selectedOptionIds.join(', ')
}

function formatCorrectAnswer(question: Question): string {
  if (question.answerVerification !== 'verified') {
    return 'Unverified / Not authoritative'
  }
  if (question.type === 'numerical') {
    const tol = Number(question.numericalTolerance || 0)
    return tol > 0 ? `${question.numericalAnswer} (±${question.numericalTolerance})` : question.numericalAnswer
  }
  return question.correctOptionIds.join(', ')
}

function evaluateQuestion(
  question: Question,
  preset: ExamPreset,
  response: QuestionResponseState | undefined,
): { status: QuestionScoreStatus; marks: number } {
  const answered = hasAnsweredQuestion(question, response)
  const rule = preset.marking[question.type]

  if (!answered) {
    return { status: 'unattempted', marks: rule.unattempted }
  }

  // If question or key is not verified, it cannot be graded authoritatively
  if (question.verification !== 'verified' || question.answerVerification !== 'verified') {
    return { status: 'ungraded', marks: 0 }
  }

  if (question.type === 'single-correct') {
    const selected = response!.selectedOptionIds
    if (selected.length === 1 && question.correctOptionIds.length === 1 && selected[0] === question.correctOptionIds[0]) {
      return { status: 'correct', marks: rule.correct }
    }
    return { status: 'incorrect', marks: rule.incorrect }
  }

  if (question.type === 'multiple-correct') {
    const selected = [...response!.selectedOptionIds].sort()
    const correct = [...question.correctOptionIds].sort()
    const matches = selected.length === correct.length && selected.every((id, idx) => id === correct[idx])
    if (matches) {
      return { status: 'correct', marks: rule.correct }
    }
    return { status: 'incorrect', marks: rule.incorrect }
  }

  if (question.type === 'numerical') {
    const candNum = Number(response!.numericalAnswer.trim())
    const targetNum = Number(question.numericalAnswer.trim())
    const tol = Number(question.numericalTolerance.trim() || 0)

    if (Number.isFinite(candNum) && Number.isFinite(targetNum) && Math.abs(candNum - targetNum) <= tol) {
      return { status: 'correct', marks: rule.correct }
    }
    return { status: 'incorrect', marks: rule.incorrect }
  }

  return { status: 'unattempted', marks: rule.unattempted }
}

export function scoreExamAttempt(
  preset: ExamPreset,
  questions: Question[],
  responses: Record<string, QuestionResponseState | undefined>,
): ExamScoreReport {
  const evaluations: QuestionEvaluation[] = []
  let totalScoreSum = 0
  let maxPossibleScore = 0
  let attempted = 0
  let correct = 0
  let incorrect = 0
  let unattempted = 0
  let ungraded = 0
  let totalTimeSpentMs = 0
  let hasAnyUnverified = false

  const subjectSummaries: Record<Subject, SubjectScoreSummary> = {
    Physics: { subject: 'Physics', totalQuestions: 0, attempted: 0, correct: 0, incorrect: 0, unattempted: 0, ungraded: 0, score: 0, maxPossibleScore: 0, timeSpentMs: 0 },
    Chemistry: { subject: 'Chemistry', totalQuestions: 0, attempted: 0, correct: 0, incorrect: 0, unattempted: 0, ungraded: 0, score: 0, maxPossibleScore: 0, timeSpentMs: 0 },
    Mathematics: { subject: 'Mathematics', totalQuestions: 0, attempted: 0, correct: 0, incorrect: 0, unattempted: 0, ungraded: 0, score: 0, maxPossibleScore: 0, timeSpentMs: 0 },
  }

  for (const question of questions) {
    const resp = responses[question.id]
    const timeSpent = resp?.timeSpentMs ?? 0
    totalTimeSpentMs += timeSpent

    const isVerified = question.verification === 'verified' && question.answerVerification === 'verified'
    if (!isVerified) {
      hasAnyUnverified = true
    }

    const { status, marks } = evaluateQuestion(question, preset, resp)
    const rule = preset.marking[question.type]
    maxPossibleScore += rule.correct

    if (status !== 'ungraded') {
      totalScoreSum += marks
    }

    const subSummary = subjectSummaries[question.subject]
    if (subSummary) {
      subSummary.totalQuestions++
      subSummary.maxPossibleScore += rule.correct
      subSummary.timeSpentMs += timeSpent
      if (status !== 'ungraded') {
        subSummary.score += marks
      }
    }

    if (status === 'correct') {
      correct++
      attempted++
      if (subSummary) { subSummary.correct++; subSummary.attempted++ }
    } else if (status === 'incorrect') {
      incorrect++
      attempted++
      if (subSummary) { subSummary.incorrect++; subSummary.attempted++ }
    } else if (status === 'ungraded') {
      ungraded++
      attempted++
      if (subSummary) { subSummary.ungraded++; subSummary.attempted++ }
    } else {
      unattempted++
      if (subSummary) { subSummary.unattempted++ }
    }

    evaluations.push({
      questionId: question.id,
      subject: question.subject,
      status,
      marksAwarded: marks,
      timeSpentMs: timeSpent,
      candidateAnswerText: formatCandidateAnswer(question, resp),
      correctAnswerText: formatCorrectAnswer(question),
      isKeyVerified: isVerified,
    })
  }

  const accuracy = attempted > 0 ? (correct / attempted) * 100 : 0

  return {
    // If any question is not fully verified, schema mandates totalScore is null
    totalScore: hasAnyUnverified ? null : totalScoreSum,
    maxPossibleScore,
    totalQuestions: questions.length,
    attempted,
    correct,
    incorrect,
    unattempted,
    ungraded,
    accuracyPercentage: Math.round(accuracy * 10) / 10,
    totalTimeSpentMs,
    evaluations,
    subjectSummaries,
  }
}
