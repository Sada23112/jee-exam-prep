import { workspace } from '../infrastructure/storage/workspace'
import { syncService } from '../infrastructure/sync/sync-service'
import type { AssetRecord, BackupInspection } from '../infrastructure/storage/workspace'
import type { Question, QuestionDraft } from '../modules/question-bank/domain/question'
import type { CollectionDraft, QuestionCollection } from '../modules/question-bank/domain/collection'
import type { ExamPreset, PresetDraft } from '../modules/exam-engine/domain/preset'
import type { ExamHistoryRecord } from '../modules/results/domain/history'
import type { QuestionResponseState } from '../modules/exam-engine/domain/palette'

export interface StorageInfo {
  supported: boolean
  persisted: boolean
  usage: number | null
  quota: number | null
}
export interface WorkspaceState {
  loading: boolean
  loaded: boolean
  error: string | null
  questions: Question[]
  collections: QuestionCollection[]
  presets: ExamPreset[]
  history: ExamHistoryRecord[]
  storage: StorageInfo | null
}

/** UI composition only. Business validation and transactional writes belong to the repositories. */
class WorkspaceController {
  private state: WorkspaceState = {
    loading: true, loaded: false, error: null,
    questions: [], collections: [], presets: [], history: [], storage: null,
  }
  private listeners = new Set<() => void>()
  private refreshGeneration = 0
  private channel: BroadcastChannel | null = null

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel('jee-cbt-workspace-changes')
      this.channel.onmessage = () => { void this.refresh() }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => { void this.refresh() })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.refresh()
      })
    }
  }

  getSnapshot = (): WorkspaceState => this.state
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(next: WorkspaceState): void {
    this.state = next
    this.listeners.forEach(listener => listener())
  }

  async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration
    try {
      try {
        await workspace.open()
      } catch (openErr) {
        if (openErr instanceof Error && openErr.message.includes('budget counters')) {
          // Explicit compatible repair for budget drift (from metadata/cloud synchronization)
          await workspace.repairBudget()
          await workspace.open()
        } else {
          throw openErr
        }
      }
      const [questions, collections, presets, history] = await Promise.all([
        workspace.listQuestions(), workspace.listCollections(), workspace.listPresets(), workspace.listHistory(),
      ])
      if (generation !== this.refreshGeneration) return
      this.publish({ ...this.state, questions, collections, presets, history, loading: false, loaded: true, error: null })
      await this.refreshStorage()
    } catch (error) {
      if (generation !== this.refreshGeneration) return
      this.publish({ ...this.state, loading: false, error: errorMessage(error) })
    }
  }

  private async changed(): Promise<void> {
    this.channel?.postMessage('changed')
    await this.refresh()
    if (this.state.error) throw new Error(`Your change was saved, but the workspace could not refresh: ${this.state.error}`)
  }
  async saveQuestion(draft: QuestionDraft, id?: string, revision?: number): Promise<Question> {
    const saved = await workspace.saveQuestion(draft, id, revision)
    await this.changed()
    void syncService.queueChange('questions', saved.id, 'upsert')
    return saved
  }
  async saveQuestionsBatch(drafts: QuestionDraft[]): Promise<Question[]> {
    const saved = await workspace.saveQuestionsBatch(drafts)
    await this.changed()
    for (const q of saved) void syncService.queueChange('questions', q.id, 'upsert')
    return saved
  }
  async archiveQuestions(questions: Question[]): Promise<void> {
    await workspace.archiveQuestions(questions.map(question => question.id), Object.fromEntries(questions.map(question => [question.id, question.revision])))
    await this.changed()
    for (const q of questions) void syncService.queueChange('questions', q.id, 'delete')
  }
  async saveCollection(draft: CollectionDraft, id?: string, revision?: number): Promise<QuestionCollection> {
    const saved = await workspace.saveCollection(draft, id, revision)
    await this.changed()
    void syncService.queueChange('collections', saved.id, 'upsert')
    return saved
  }
  async savePreset(draft: PresetDraft, id?: string, revision?: number): Promise<ExamPreset> {
    const saved = await workspace.savePreset(draft, id, revision)
    await this.changed()
    void syncService.queueChange('presets', saved.id, 'upsert')
    return saved
  }
  async getExam(id: string): Promise<ExamHistoryRecord | undefined> {
    return workspace.getExam(id)
  }
  async startExam(name: string, preset: ExamPreset, questions: Question[]): Promise<ExamHistoryRecord> {
    const saved = await workspace.startExam(name, preset, questions)
    await this.changed()
    void syncService.queueChange('history', saved.id, 'upsert')
    return saved
  }
  async saveExamResponses(
    id: string,
    revision: number,
    responses: QuestionResponseState[],
    finalizeSubmit = false,
  ): Promise<ExamHistoryRecord> {
    const saved = await workspace.saveExamResponses(id, revision, responses, finalizeSubmit)
    await this.changed()
    void syncService.queueChange('history', saved.id, 'upsert')
    return saved
  }
  async archiveHistory(records: ExamHistoryRecord[]): Promise<void> {
    await workspace.archiveHistory(
      records.map(r => r.id),
      Object.fromEntries(records.map(r => [r.id, r.revision])),
    )
    await this.changed()
    for (const r of records) void syncService.queueChange('history', r.id, 'delete')
  }
  async addImage(file: File, role: 'page' | 'crop' | 'diagram'): Promise<AssetRecord> {
    const asset = await workspace.addImage(file, role)
    void syncService.queueChange('assets', asset.id, 'upsert')
    return asset
  }
  getAsset(id: string): Promise<AssetRecord | undefined> { return workspace.getAsset(id) }
  exportBackup(): Promise<Blob> { return workspace.exportBackup() }
  inspectBackup(file: File): Promise<BackupInspection> { return workspace.inspectBackup(file) }
  async restoreBackup(inspection: BackupInspection): Promise<void> {
    await workspace.restoreBackup(inspection)
    await this.changed()
  }
  async refreshStorage(): Promise<void> {
    if (!navigator.storage) {
      this.publish({ ...this.state, storage: { supported: false, persisted: false, usage: null, quota: null } })
      return
    }
    try {
      const [estimate, persisted] = await Promise.all([
        navigator.storage.estimate(), navigator.storage.persisted?.() ?? Promise.resolve(false),
      ])
      this.publish({ ...this.state, storage: { supported: true, persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null } })
    } catch {
      // Capacity/permission reporting is optional; it must not break durable record operations.
      this.publish({ ...this.state, storage: { supported: false, persisted: false, usage: null, quota: null } })
    }
  }
  async requestPersistence(): Promise<boolean> {
    if (!navigator.storage?.persist) return false
    const granted = await navigator.storage.persist()
    await this.refreshStorage()
    return granted
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred. No automatic data reset was performed.'
}
export const workspaceController = new WorkspaceController()
