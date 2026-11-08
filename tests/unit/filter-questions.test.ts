import { describe, expect, it } from 'vitest'
import { filterQuestions } from '../../src/modules/question-bank/application/filter-questions'
import type { QuestionFilters } from '../../src/modules/question-bank/application/filter-questions'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import type { Question } from '../../src/modules/question-bank/domain/question'
import type { QuestionCollection } from '../../src/modules/question-bank/domain/collection'

const now = '2026-11-07T00:00:00.000Z'
function question(patch: Partial<Question> = {}): Question {
  return { ...createEmptyQuestionDraft(), id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, revision: 1,
    createdAt: now, updatedAt: now, deletedAt: null, remoteRevision: null, ...patch }
}
const filters: QuestionFilters = { search: '', subject: '', type: '', verification: '', answerVerification: '', difficulty: '', chapter: '', year: '', collectionId: '' }

describe('question bank filtering', () => {
  const physics = question({ prompt: 'A body accelerates under a force', chapter: 'Laws of motion', topic: 'Newton', year: 2024, sourceLabel: 'My paper', session: 'January', difficulty: 'hard' })
  const chemistry = question({ subject: 'Chemistry', type: 'numerical', options: [], prompt: 'Find the molar mass', verification: 'needs-review', answerVerification: 'needs-review' })
  const archived = question({ prompt: 'body', deletedAt: now })
  const questions = [physics, chemistry, archived]
  it('excludes archived records even with no filter', () => { expect(filterQuestions(questions, filters, [])).toEqual([physics, chemistry]) })
  it('searches case-insensitive tokens across source and metadata', () => {
    expect(filterQuestions(questions, { ...filters, search: ' NEWTON  paper January ' }, [])).toEqual([physics])
    expect(filterQuestions(questions, { ...filters, search: 'molar force' }, [])).toEqual([])
  })
  it('combines all structured filters and explicitly filters unverified keys', () => {
    expect(filterQuestions(questions, { ...filters, subject: 'Physics', difficulty: 'hard', year: '2024', chapter: 'Laws of motion', type: 'single-correct', verification: 'incomplete', answerVerification: 'incomplete' }, [])).toEqual([physics])
    expect(filterQuestions(questions, { ...filters, answerVerification: 'needs-review' }, [])).toEqual([chemistry])
    expect(filterQuestions(questions, { ...filters, subject: 'Chemistry', year: '2024' }, [])).toEqual([])
  })
  it('matches option wording without interpreting mathematical text', () => {
    const q = question({ options: [{ id: 'A', text: '$\\frac{1}{2}$' }, { id: 'B', text: 'Twenty-five' }] })
    expect(filterQuestions([q], { ...filters, search: 'twenty-five' }, [])).toEqual([q])
  })
  it('does not fall back to all questions when a collection is missing', () => {
    const collection: QuestionCollection = { id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, remoteRevision: null, name: 'Revision', description: '', questionIds: [physics.id] }
    expect(filterQuestions(questions, { ...filters, collectionId: collection.id }, [collection])).toEqual([physics])
    expect(filterQuestions(questions, { ...filters, collectionId: crypto.randomUUID() }, [collection])).toEqual([])
  })
})
