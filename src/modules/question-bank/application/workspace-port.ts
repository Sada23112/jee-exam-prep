import type { CollectionDraft, QuestionCollection } from '../domain/collection'
import type { Question, QuestionDraft } from '../domain/question'
import type { ExamPreset, PresetDraft } from '../../exam-engine/domain/preset'
import type { ExamHistoryRecord } from '../../results/domain/history'
import type { QuestionResponseState } from '../../exam-engine/domain/palette'

/** React-free repository ports. Adapters must validate records and use revision CAS for edits. */
export interface QuestionBankRepository {
  listQuestions(): Promise<Question[]>
  saveQuestion(draft: QuestionDraft, id?: string, expectedRevision?: number): Promise<Question>
  saveQuestionsBatch(drafts: QuestionDraft[]): Promise<Question[]>
  archiveQuestions(ids: string[], expectedRevisions: Record<string, number>): Promise<void>
  listCollections(): Promise<QuestionCollection[]>
  saveCollection(draft: CollectionDraft, id?: string, expectedRevision?: number): Promise<QuestionCollection>
}
export interface PresetRepository {
  listPresets(): Promise<ExamPreset[]>
  savePreset(draft: PresetDraft, id?: string, expectedRevision?: number): Promise<ExamPreset>
}
export interface HistoryRepository {
  listHistory(): Promise<ExamHistoryRecord[]>
  getExam(id: string): Promise<ExamHistoryRecord | undefined>
  startExam(name: string, preset: ExamPreset, questions: Question[]): Promise<ExamHistoryRecord>
  saveExamResponses(
    id: string,
    expectedRevision: number,
    responses: QuestionResponseState[],
    finalizeSubmit?: boolean,
  ): Promise<ExamHistoryRecord>
  archiveHistory(ids: string[], expectedRevisions: Record<string, number>): Promise<void>
}
export interface WorkspaceRepository extends QuestionBankRepository, PresetRepository, HistoryRepository {
  open(): Promise<void>
}
