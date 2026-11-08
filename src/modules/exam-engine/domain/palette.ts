import type { Question } from '../../question-bank/domain/question'

export type PaletteStatus =
  | 'not-visited'
  | 'not-answered'
  | 'answered'
  | 'marked-for-review'
  | 'answered-and-marked'

export interface QuestionResponseState {
  questionId: string
  selectedOptionIds: string[]
  numericalAnswer: string
  visited: boolean
  markedForReview: boolean
  timeSpentMs: number
}

export function hasAnsweredQuestion(question: Question, response: QuestionResponseState | undefined): boolean {
  if (!response) return false
  if (question.type === 'numerical') {
    return response.numericalAnswer.trim().length > 0
  }
  return response.selectedOptionIds.length > 0
}

export function getPaletteStatus(question: Question, response: QuestionResponseState | undefined): PaletteStatus {
  if (!response || !response.visited) {
    return 'not-visited'
  }
  const answered = hasAnsweredQuestion(question, response)
  if (answered && response.markedForReview) {
    return 'answered-and-marked'
  }
  if (response.markedForReview) {
    return 'marked-for-review'
  }
  if (answered) {
    return 'answered'
  }
  return 'not-answered'
}

export interface PaletteSummary {
  total: number
  notVisited: number
  notAnswered: number
  answered: number
  markedForReview: number
  answeredAndMarked: number
}

export function computePaletteSummary(
  questions: Question[],
  responses: Record<string, QuestionResponseState | undefined>,
): PaletteSummary {
  const summary: PaletteSummary = {
    total: questions.length,
    notVisited: 0,
    notAnswered: 0,
    answered: 0,
    markedForReview: 0,
    answeredAndMarked: 0,
  }

  for (const question of questions) {
    const status = getPaletteStatus(question, responses[question.id])
    switch (status) {
      case 'not-visited':
        summary.notVisited++
        break
      case 'not-answered':
        summary.notAnswered++
        break
      case 'answered':
        summary.answered++
        break
      case 'marked-for-review':
        summary.markedForReview++
        break
      case 'answered-and-marked':
        summary.answeredAndMarked++
        break
    }
  }

  return summary
}
