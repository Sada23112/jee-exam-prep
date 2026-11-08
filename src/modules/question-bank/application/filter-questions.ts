import type { Question, Subject, QuestionType, VerificationState, Difficulty } from '../domain/question'
import type { QuestionCollection } from '../domain/collection'

export interface QuestionFilters {
  search: string
  subject: Subject | ''
  type: QuestionType | ''
  verification: VerificationState | ''
  answerVerification: VerificationState | ''
  difficulty: Difficulty | ''
  chapter: string
  year: string
  collectionId: string
}
export function filterQuestions(questions: Question[], filters: QuestionFilters, collections: QuestionCollection[]): Question[] {
  const tokens = filters.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const collection = filters.collectionId ? collections.find(value => value.id === filters.collectionId) : null
  const membership = collection ? new Set(collection.questionIds) : null
  return questions.filter(question => {
    if (question.deletedAt !== null) return false
    if (filters.subject && question.subject !== filters.subject) return false
    if (filters.type && question.type !== filters.type) return false
    if (filters.verification && question.verification !== filters.verification) return false
    if (filters.answerVerification && question.answerVerification !== filters.answerVerification) return false
    if (filters.difficulty && question.difficulty !== filters.difficulty) return false
    if (filters.chapter && question.chapter !== filters.chapter) return false
    if (filters.year && String(question.year ?? '') !== filters.year) return false
    if (filters.collectionId && (!membership || !membership.has(question.id))) return false
    if (!tokens.length) return true
    const searchable = [question.prompt, ...question.options.map(option => option.text), question.subject, question.chapter, question.topic,
      question.session, question.sourceLabel, question.sourceQuestionNumber, question.year ?? ''].join(' ').toLocaleLowerCase()
    return tokens.every(token => searchable.includes(token))
  })
}
