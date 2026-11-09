import { z } from 'zod'
import { collectionDraftSchema, collectionSchema } from '../../modules/question-bank/domain/collection'
import type { CollectionDraft, QuestionCollection } from '../../modules/question-bank/domain/collection'
import { questionDraftSchema, questionSchema } from '../../modules/question-bank/domain/question'
import type { Question, QuestionDraft } from '../../modules/question-bank/domain/question'
import { revisionSchema, uuidSchema } from '../../modules/question-bank/domain/common'
import type { CommonMetadata } from '../../modules/question-bank/domain/common'
import { presetDraftSchema, presetSchema } from '../../modules/exam-engine/domain/preset'
import type { ExamPreset, PresetDraft } from '../../modules/exam-engine/domain/preset'
import { historySchema } from '../../modules/results/domain/history'
import type { ExamHistoryRecord } from '../../modules/results/domain/history'
import { scoreExamAttempt } from '../../modules/results/domain/scoring'
import type { QuestionResponseState } from '../../modules/exam-engine/domain/palette'
import type { WorkspaceRepository } from '../../modules/question-bank/application/workspace-port'
import {
  assetEqual, assertPlainData, assertTableCapacity, parseTableRows, parseWorkspaceData, readData, readRow, readRows, readTable,
  recordEqual, referenceUnion, validateCollectionQuestions, validatePresetFamilies, validateQuestionAssets, validateReferences, validateSchemaMarker, versionKey,
} from './validation'
import type { WorkspaceData } from './validation'
import { decodeBrowserImage, imageFromFile, validateAsset } from './assets'
import type { AssetRecord, AssetRole, ImageDecoder } from './assets'
import { createBackup, inspectBackupFile, revalidateInspection } from './backup'
import type { BackupInspection } from './backup'
import { assertCompatibleDatabase, DATABASE_SCHEMA_VERSION, WorkspaceDatabase } from './database'
import { ConflictError, StorageError, storageOperation } from './errors'
import { assertWorkspaceBudget, calculateWorkspaceBudget, storageLimits, updateWorkspaceBudget } from './budget'
import type { StorageLimits } from './budget'

export { ConflictError, StorageError } from './errors'
export type { AssetRecord, ImageDecoder } from './assets'
export type { BackupInspection } from './backup'

function newMetadata(): CommonMetadata {
  const now = new Date().toISOString()
  return { id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, revision: 1, createdAt: now, updatedAt: now, deletedAt: null, remoteRevision: null }
}
function updateTime(previous: { updatedAt: string }): string {
  return new Date(Math.max(Date.now(), Date.parse(previous.updatedAt) + 1)).toISOString()
}
function sortUpdated<T extends { id: string; updatedAt: string }>(records: T[]): T[] {
  return records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id))
}
function checkEdit<T extends { revision: number; deletedAt: string | null }>(row: T | undefined, id: string, expectedRevision: number | undefined): T {
  if (!row) throw new ConflictError(`Record ${id} no longer exists. Refresh before saving.`)
  if (row.deletedAt !== null) throw new ConflictError(`Record ${id} is archived and cannot be edited.`)
  if (expectedRevision === undefined || row.revision !== expectedRevision) throw new ConflictError(`Record ${id} changed since it was opened. Refresh before saving (revision mismatch).`)
  return row
}
function validateEditArguments(id?: string, expectedRevision?: number): void {
  if (id !== undefined) uuidSchema.parse(id)
  if (expectedRevision !== undefined) revisionSchema.parse(expectedRevision)
  if (id === undefined && expectedRevision !== undefined) throw new StorageError('A new record cannot have an expected revision.')
}

/**
 * Browser-local validated repository; no seeded records. Optional decoder is for
 * deterministic tests/future platform adapters and must actually validate pixels.
 * db is exposed for isolated tests/migrations only; application writes use this port.
 * Startup/backups validate complete snapshots; routine operations validate only their
 * target records and necessary dependencies within a single scoped transaction.
 */
export class WorkspaceStore implements WorkspaceRepository {
  readonly db: WorkspaceDatabase
  private readonly decoder: ImageDecoder
  private readonly limits: Readonly<StorageLimits>
  private opening: Promise<void> | undefined
  private ready = false

  constructor(dbName = 'jee-cbt-workspace', options: { imageDecoder?: ImageDecoder; limits?: Partial<StorageLimits> } = {}) {
    this.db = new WorkspaceDatabase(dbName)
    this.decoder = options.imageDecoder ?? decodeBrowserImage
    this.limits = storageLimits(options.limits)
  }

  async open(): Promise<void> {
    if (this.ready && this.db.isOpen()) return
    if (this.opening) return this.opening
    this.opening = storageOperation('Could not open workspace (data was not cleared)', async () => {
      try {
        await assertCompatibleDatabase(this.db.name)
        await this.db.open()
        if (this.db.verno !== DATABASE_SCHEMA_VERSION) throw new StorageError('Unsupported workspace database version. Use a compatible app; your data was not cleared.')
        const data = await this.db.transaction('r', this.db.tables, () => readData(this.db, this.limits))
        validateReferences(data)
        for (const asset of data.assets) {
          try {
            await validateAsset(asset, this.decoder)
          } catch (assetErr) {
            console.warn('Asset validation warning:', assetErr)
          }
        }
        this.ready = true
      } catch (error) {
        if (error instanceof Error && error.message.includes('references missing image')) {
          try {
            console.warn('Attempting workspace auto-repair on open...', error.message)
            await this.repairMissingAssets()
            this.ready = true
            return
          } catch (repairErr) {
            console.error('Workspace auto-repair failed:', repairErr)
          }
        }
        this.ready = false
        this.db.close()
        throw error
      }
    })
    try { await this.opening } finally { this.opening = undefined }
  }

  /**
   * Repairs broken question revision chains by rebuilding a contiguous, time-ordered
   * sequence from whatever version snapshots remain. Any gaps (missing revision numbers)
   * are closed by compacting the existing snapshots into a new 1-based sequence, and the
   * current-question row is updated to reflect the new latest revision.
   *
   * This is a last-resort recovery path for IndexedDB corruption that leaves question
   * version history in an unreadable state. No data is permanently discarded: the
   * surviving snapshots are preserved; only their revision numbers are renumbered so
   * they form a valid, contiguous chain.
   *
   * Returns the number of questions whose chains were repaired.
   */
  async repairRevisionChain(): Promise<number> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const allQuestions = await this.db.questions.toArray()
      const allVersions = await this.db.questionVersions.toArray()

      // Group versions by question id
      const versionsByQuestion = new Map<string, Question[]>()
      for (const v of allVersions) {
        const list = versionsByQuestion.get(v.id) ?? []
        list.push(v)
        versionsByQuestion.set(v.id, list)
      }

      let repairedCount = 0
      const questionsToUpdate: Question[] = []
      const versionsToDelete: [string, number][] = []
      const versionsToAdd: Question[] = []

      for (const question of allQuestions) {
        const chain = (versionsByQuestion.get(question.id) ?? [])
          .slice()
          .sort((a, b) => a.revision - b.revision || Date.parse(a.updatedAt) - Date.parse(b.updatedAt))

        if (chain.length === 0) {
          // No versions at all — synthesise revision 1 from the current question row
          const v1: Question = { ...question, revision: 1 }
          versionsToAdd.push(v1)
          questionsToUpdate.push({ ...question, revision: 1 })
          repairedCount++
          continue
        }

        // Check if the chain is already valid
        let alreadyValid = true
        let lastMs = Number.NEGATIVE_INFINITY
        let wasArchived = false
        for (let i = 0; i < chain.length; i++) {
          const v = chain[i]!
          const ms = Date.parse(v.updatedAt)
          if (v.revision !== i + 1 || ms < lastMs || wasArchived) { alreadyValid = false; break }
          lastMs = ms
          wasArchived = v.deletedAt !== null
        }
        // Also verify the latest version matches the current question row
        const latest = chain[chain.length - 1]!
        if (alreadyValid && latest.revision === question.revision && recordEqual(latest, question)) continue

        // Rebuild chain with contiguous revision numbers
        repairedCount++
        // Delete all existing version rows for this question
        for (const v of chain) versionsToDelete.push([v.id, v.revision])

        // Renumber versions 1..N preserving order; ensure strictly increasing timestamps
        let prevMs = Number.NEGATIVE_INFINITY
        const rebuilt: Question[] = chain.map((v, i) => {
          const ms = Math.max(Date.parse(v.updatedAt), prevMs + 1)
          prevMs = ms
          const updatedAt = new Date(ms).toISOString()
          return { ...v, revision: i + 1, updatedAt }
        })

        for (const v of rebuilt) versionsToAdd.push(v)

        // Update the current question row to match the new latest revision
        const newLatest = rebuilt[rebuilt.length - 1]!
        questionsToUpdate.push({ ...question, revision: newLatest.revision, updatedAt: newLatest.updatedAt })
      }

      if (repairedCount === 0) return 0

      // Apply all changes
      if (versionsToDelete.length > 0) await this.db.questionVersions.bulkDelete(versionsToDelete)
      if (versionsToAdd.length > 0) await this.db.questionVersions.bulkPut(versionsToAdd)
      if (questionsToUpdate.length > 0) await this.db.questions.bulkPut(questionsToUpdate)

      // Recalculate budget from actual stored data
      const [questions, questionVersions, collections, presets, history, assets] = await Promise.all([
        this.db.questions.toArray(),
        this.db.questionVersions.toArray(),
        this.db.collections.toArray(),
        this.db.presets.toArray(),
        this.db.history.toArray(),
        this.db.assets.toArray(),
      ])
      const data = parseWorkspaceData({ questions, questionVersions, collections, presets, history, assets })
      const marker = await validateSchemaMarker(this.db)
      const newBudget = calculateWorkspaceBudget(data, marker.budget.revision + 1)
      assertWorkspaceBudget(newBudget, this.limits)
      await this.db.metadata.put({ ...marker, budget: newBudget })

      return repairedCount
    })
  }

  /**
   * Scans questions and strips dangling references to non-existent assets, restoring referential integrity.
   */
  async repairMissingAssets(): Promise<number> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const assets = new Set((await this.db.assets.toArray()).map(a => a.id))
      const allQuestions = await this.db.questions.toArray()
      let repairedCount = 0
      const updatedQuestions: Question[] = []

      for (const q of allQuestions) {
        const validAssets = q.assets.filter(a => assets.has(a.assetId))
        const optionsWithValidAssets = q.options.map(opt => (
          opt.diagramAssetId && !assets.has(opt.diagramAssetId) ? { ...opt, diagramAssetId: null } : opt
        ))
        const hasAssetChanges =
          validAssets.length !== q.assets.length ||
          optionsWithValidAssets.some((opt, idx) => opt.diagramAssetId !== q.options[idx]?.diagramAssetId)

        if (hasAssetChanges) {
          updatedQuestions.push({ ...q, assets: validAssets, options: optionsWithValidAssets })
          repairedCount++
        }
      }

      if (updatedQuestions.length > 0) {
        await this.db.questions.bulkPut(updatedQuestions)
        const allVersions = await this.db.questionVersions.toArray()
        const updatedVersions = allVersions.map(v => {
          const validAssets = v.assets.filter(a => assets.has(a.assetId))
          const optionsWithValidAssets = v.options.map(opt => (
            opt.diagramAssetId && !assets.has(opt.diagramAssetId) ? { ...opt, diagramAssetId: null } : opt
          ))
          return { ...v, assets: validAssets, options: optionsWithValidAssets }
        })
        await this.db.questionVersions.bulkPut(updatedVersions)
      }

      return repairedCount
    })
  }

  /**
   * Recalculates workspace budget from actual stored records and updates metadata atomically.
   */
  async repairBudget(): Promise<WorkspaceData> {
    return this.db.transaction('rw', this.db.tables, async () => {
      const marker = await validateSchemaMarker(this.db)
      const [questions, questionVersions, collections, presets, history, assets] = await Promise.all([
        this.db.questions.toArray(),
        this.db.questionVersions.toArray(),
        this.db.collections.toArray(),
        this.db.presets.toArray(),
        this.db.history.toArray(),
        this.db.assets.toArray(),
      ])
      const data = parseWorkspaceData({ questions, questionVersions, collections, presets, history, assets })
      const actualBudget = calculateWorkspaceBudget(data, marker.budget.revision + 1)
      assertWorkspaceBudget(actualBudget, this.limits)
      await this.db.metadata.put({ ...marker, budget: actualBudget })
      return data
    })
  }

  private async readSnapshot(): Promise<WorkspaceData> {
    await this.open()
    return this.db.transaction('r', this.db.tables, async () => {
      const data = await readData(this.db, this.limits)
      validateReferences(data)
      return data
    })
  }

  private async checkAssets(questions: Question[]): Promise<void> {
    const ids = [...new Set(questions.flatMap(question => question.assets.map(asset => asset.assetId)))]
    const assets = (await readRows(this.db, 'assets', ids)).filter(asset => asset !== undefined)
    validateQuestionAssets(questions, assets)
  }
  private async checkCollections(collections: QuestionCollection[]): Promise<void> {
    const ids = [...new Set(collections.flatMap(collection => collection.questionIds))]
    const questions = (await readRows(this.db, 'questions', ids)).filter(question => question !== undefined)
    validateCollectionQuestions(collections, questions)
  }
  private async editableQuestion(id: string, expectedRevision: number | undefined): Promise<Question> {
    const previous = checkEdit(await readRow(this.db, 'questions', id), id, expectedRevision)
    const version = await readRow(this.db, 'questionVersions', [id, previous.revision])
    if (!version || !recordEqual(previous, version)) throw new StorageError(`Question ${id} has a missing or inconsistent immutable revision.`)
    return previous
  }

  async listQuestions(): Promise<Question[]> {
    return storageOperation('Could not load questions', async () => {
      await this.open()
      return this.db.transaction('r', [this.db.metadata, this.db.questions], async () => {
        await validateSchemaMarker(this.db)
        return sortUpdated((await readTable(this.db, 'questions')).filter(question => question.deletedAt === null))
      })
    })
  }
  async listCollections(): Promise<QuestionCollection[]> {
    return storageOperation('Could not load collections', async () => {
      await this.open()
      return this.db.transaction('r', [this.db.metadata, this.db.collections, this.db.questions], async () => {
        await validateSchemaMarker(this.db)
        const collections = await readTable(this.db, 'collections')
        await this.checkCollections(collections)
        return sortUpdated(collections.filter(collection => collection.deletedAt === null))
      })
    })
  }
  async listPresets(): Promise<ExamPreset[]> {
    return storageOperation('Could not load presets', async () => {
      await this.open()
      return this.db.transaction('r', [this.db.metadata, this.db.presets], async () => {
        await validateSchemaMarker(this.db)
        const presets = await readTable(this.db, 'presets')
        validatePresetFamilies(presets)
        const latest = new Map<string, ExamPreset>()
        for (const preset of presets) {
          const previous = latest.get(preset.familyId)
          if (!previous || preset.version > previous.version) latest.set(preset.familyId, preset)
        }
        return sortUpdated(Array.from(latest.values()).filter(preset => preset.deletedAt === null))
      })
    })
  }
  async listHistory(): Promise<ExamHistoryRecord[]> {
    return storageOperation('Could not load history', async () => {
      await this.open()
      return this.db.transaction('r', [this.db.metadata, this.db.history], async () => {
        await validateSchemaMarker(this.db)
        return sortUpdated((await readTable(this.db, 'history')).filter(record => record.deletedAt === null))
      })
    })
  }

  async getExam(id: string): Promise<ExamHistoryRecord | undefined> {
    return storageOperation('Could not load examination attempt', async () => {
      uuidSchema.parse(id)
      await this.open()
      return this.db.transaction('r', [this.db.metadata, this.db.history], async () => {
        await validateSchemaMarker(this.db)
        return readRow(this.db, 'history', id)
      })
    })
  }

  async startExam(name: string, preset: ExamPreset, questions: Question[]): Promise<ExamHistoryRecord> {
    return storageOperation('Could not start examination', async () => {
      assertPlainData(name)
      assertPlainData(preset)
      assertPlainData(questions)
      const parsedName = z.string().trim().min(1).max(200).parse(name)
      const parsedPreset = presetSchema.parse(preset)
      const parsedQuestions = z.array(questionSchema).min(1).max(10_000).parse(questions)

      if (parsedPreset.deletedAt !== null) throw new StorageError('Preset is archived.')
      if (parsedQuestions.some(q => q.deletedAt !== null)) throw new StorageError('One or more selected questions are archived.')
      if (parsedQuestions.some(q => !parsedPreset.subjects.includes(q.subject))) {
        throw new StorageError('One or more selected questions belong to subjects outside this preset.')
      }

      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.history, this.db.presets, this.db.questionVersions, this.db.assets], async () => {
        const marker = await validateSchemaMarker(this.db)
        const storedPreset = await readRow(this.db, 'presets', parsedPreset.id)
        if (!storedPreset || !recordEqual(storedPreset, parsedPreset)) {
          throw new StorageError('Preset is missing or inconsistent.')
        }

        for (const q of parsedQuestions) {
          const version = await readRow(this.db, 'questionVersions', [q.id, q.revision])
          if (!version || !recordEqual(version, q)) {
            throw new StorageError(`Question ${q.id} version snapshot is missing or inconsistent.`)
          }
        }
        await this.checkAssets(parsedQuestions)

        const orderedQuestions = [...parsedQuestions].sort((a, b) => {
          const subA = parsedPreset.subjects.indexOf(a.subject)
          const subB = parsedPreset.subjects.indexOf(b.subject)
          if (subA !== subB) return subA - subB
          return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
        })

        const now = new Date().toISOString()
        const deadline = new Date(Date.now() + parsedPreset.durationMinutes * 60_000).toISOString()
        const responses: QuestionResponseState[] = orderedQuestions.map((q, idx) => ({
          questionId: q.id,
          selectedOptionIds: [],
          numericalAnswer: '',
          visited: idx === 0,
          markedForReview: false,
          timeSpentMs: 0,
        }))

        const record: ExamHistoryRecord = historySchema.parse({
          id: crypto.randomUUID(),
          schemaVersion: 1,
          ownerId: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          remoteRevision: null,
          name: parsedName,
          presetSnapshot: parsedPreset,
          questionSnapshots: orderedQuestions,
          startedAt: now,
          deadlineAt: deadline,
          submittedAt: null,
          status: 'in-progress',
          responses,
          totalScore: null,
        })

        await assertTableCapacity(this.db, 'history', 1)
        await updateWorkspaceBudget(this.db, marker, { history: { after: [record] } }, this.limits)
        await this.db.history.add(record)
        return record
      })
    })
  }

  async saveExamResponses(
    id: string,
    expectedRevision: number,
    responses: QuestionResponseState[],
    finalizeSubmit = false,
  ): Promise<ExamHistoryRecord> {
    return storageOperation('Could not save examination progress', async () => {
      uuidSchema.parse(id)
      revisionSchema.parse(expectedRevision)
      assertPlainData(responses)

      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.history], async () => {
        const marker = await validateSchemaMarker(this.db)
        const previous = checkEdit(await readRow(this.db, 'history', id), id, expectedRevision)
        if (previous.status === 'submitted') {
          throw new ConflictError('This examination is already submitted.')
        }

        const now = Date.now()
        const isExpired = now >= Date.parse(previous.deadlineAt)
        const shouldSubmit = finalizeSubmit || isExpired

        const responseMap = new Map(responses.map(r => [r.questionId, r]))
        const mergedResponses = previous.questionSnapshots.map(q => {
          const resp = responseMap.get(q.id)
          if (resp) return resp
          const existing = previous.responses.find(r => r.questionId === q.id)
          return existing ?? {
            questionId: q.id,
            selectedOptionIds: [],
            numericalAnswer: '',
            visited: false,
            markedForReview: false,
            timeSpentMs: 0,
          }
        })

        let updated: ExamHistoryRecord
        if (shouldSubmit) {
          const scoreReport = scoreExamAttempt(previous.presetSnapshot, previous.questionSnapshots, Object.fromEntries(responseMap))
          const submittedAt = updateTime(previous)
          updated = historySchema.parse({
            ...previous,
            revision: previous.revision + 1,
            updatedAt: submittedAt,
            submittedAt,
            status: 'submitted',
            responses: mergedResponses,
            totalScore: scoreReport.totalScore,
          })
        } else {
          const updatedAt = updateTime(previous)
          updated = historySchema.parse({
            ...previous,
            revision: previous.revision + 1,
            updatedAt,
            responses: mergedResponses,
          })
        }

        await updateWorkspaceBudget(this.db, marker, { history: { before: [previous], after: [updated] } }, this.limits)
        await this.db.history.put(updated)
        return updated
      })
    })
  }

  async archiveHistory(ids: string[], expectedRevisions: Record<string, number>): Promise<void> {
    return storageOperation('Could not archive examination attempts', async () => {
      assertPlainData(ids)
      assertPlainData(expectedRevisions)
      const parsedIds = z.array(uuidSchema).max(100_000).parse(ids)
      const revisions = z.record(uuidSchema, revisionSchema).parse(expectedRevisions)
      if (new Set(parsedIds).size !== parsedIds.length || Object.keys(revisions).length !== parsedIds.length || parsedIds.some(id => !Object.hasOwn(revisions, id))) {
        throw new StorageError('Archive requires unique examination IDs and exactly one expected revision for each.')
      }
      await this.open()
      await this.db.transaction('rw', [this.db.metadata, this.db.history], async () => {
        const marker = await validateSchemaMarker(this.db)
        const previousRecords: ExamHistoryRecord[] = []
        const archived: ExamHistoryRecord[] = []
        for (const id of parsedIds) {
          const previous = checkEdit(await readRow(this.db, 'history', id), id, revisions[id])
          const now = updateTime(previous)
          previousRecords.push(previous)
          archived.push(historySchema.parse({ ...previous, revision: previous.revision + 1, updatedAt: now, deletedAt: now }))
        }
        await updateWorkspaceBudget(this.db, marker, { history: { before: previousRecords, after: archived } }, this.limits)
        await this.db.history.bulkPut(archived)
      })
    })
  }

  async saveQuestion(draft: QuestionDraft, id?: string, expectedRevision?: number): Promise<Question> {
    return storageOperation('Could not save question', async () => {
      assertPlainData(draft)
      const parsed = questionDraftSchema.parse(draft)
      validateEditArguments(id, expectedRevision)
      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.questions, this.db.questionVersions, this.db.assets], async () => {
        const marker = await validateSchemaMarker(this.db)
        const previous = id === undefined ? undefined : await this.editableQuestion(id, expectedRevision)
        const question = questionSchema.parse(previous
          ? { ...previous, ...parsed, revision: previous.revision + 1, updatedAt: updateTime(previous) }
          : { ...newMetadata(), ...parsed })
        if (!previous && await readRow(this.db, 'questions', question.id)) throw new ConflictError('Generated question identity already exists. Retry creating the question.')
        await this.checkAssets(previous ? [previous, question] : [question])
        if (!previous) await assertTableCapacity(this.db, 'questions', 1)
        await assertTableCapacity(this.db, 'questionVersions', 1)
        await updateWorkspaceBudget(this.db, marker, {
          questions: { before: previous ? [previous] : [], after: [question] }, questionVersions: { after: [question] },
        }, this.limits)
        if (!previous) await this.db.questions.add(question)
        else await this.db.questions.put(question)
        await this.db.questionVersions.add(question)
        return question
      })
    })
  }

  async saveQuestionsBatch(drafts: QuestionDraft[]): Promise<Question[]> {
    return storageOperation('Could not save questions', async () => {
      assertPlainData(drafts)
      if (drafts.length === 0) return []
      const parsedDrafts = drafts.map(d => questionDraftSchema.parse(d))
      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.questions, this.db.questionVersions, this.db.assets], async () => {
        const marker = await validateSchemaMarker(this.db)
        const questions: Question[] = []
        for (const parsed of parsedDrafts) {
          const question = questionSchema.parse({ ...newMetadata(), ...parsed })
          questions.push(question)
        }
        await this.checkAssets(questions)
        await assertTableCapacity(this.db, 'questions', questions.length)
        await assertTableCapacity(this.db, 'questionVersions', questions.length)
        await updateWorkspaceBudget(this.db, marker, {
          questions: { after: questions },
          questionVersions: { after: questions },
        }, this.limits)
        await this.db.questions.bulkAdd(questions)
        await this.db.questionVersions.bulkAdd(questions)
        return questions
      })
    })
  }

  async archiveQuestions(ids: string[], expectedRevisions: Record<string, number>): Promise<void> {
    return storageOperation('Could not archive questions', async () => {
      assertPlainData(ids)
      assertPlainData(expectedRevisions)
      const parsedIds = z.array(uuidSchema).max(100_000).parse(ids)
      const revisions = z.record(uuidSchema, revisionSchema).parse(expectedRevisions)
      if (new Set(parsedIds).size !== parsedIds.length || Object.keys(revisions).length !== parsedIds.length || parsedIds.some(id => !Object.hasOwn(revisions, id))) {
        throw new StorageError('Archive requires unique question IDs and exactly one expected revision for each.')
      }
      await this.open()
      await this.db.transaction('rw', [this.db.metadata, this.db.questions, this.db.questionVersions, this.db.collections, this.db.assets], async () => {
        const marker = await validateSchemaMarker(this.db)
        const previousQuestions: Question[] = []
        const archivedIds = new Set(parsedIds)
        const archived: Question[] = []
        for (const id of parsedIds) {
          const previous = await this.editableQuestion(id, revisions[id])
          const now = updateTime(previous)
          previousQuestions.push(previous)
          archived.push(questionSchema.parse({ ...previous, revision: previous.revision + 1, updatedAt: now, deletedAt: now }))
        }
        await this.checkAssets(archived)
        // Version 1 has no membership index: only the collections table must be scanned.
        // Questions/revision history/assets are fetched by selected IDs, not as full tables.
        const affected = (await readTable(this.db, 'collections')).filter(collection => collection.deletedAt === null && collection.questionIds.some(id => archivedIds.has(id)))
        await this.checkCollections(affected)
        const changedCollections = affected.map(collection => collectionSchema.parse({
          ...collection, revision: collection.revision + 1, updatedAt: updateTime(collection), questionIds: collection.questionIds.filter(id => !archivedIds.has(id)),
        }))
        await assertTableCapacity(this.db, 'questionVersions', archived.length)
        await updateWorkspaceBudget(this.db, marker, {
          questions: { before: previousQuestions, after: archived }, questionVersions: { after: archived },
          collections: { before: affected, after: changedCollections },
        }, this.limits)
        await this.db.questions.bulkPut(archived)
        await this.db.questionVersions.bulkAdd(archived)
        await this.db.collections.bulkPut(changedCollections)
      })
    })
  }

  async saveCollection(draft: CollectionDraft, id?: string, expectedRevision?: number): Promise<QuestionCollection> {
    return storageOperation('Could not save collection', async () => {
      assertPlainData(draft)
      const parsed = collectionDraftSchema.parse(draft)
      validateEditArguments(id, expectedRevision)
      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.collections, this.db.questions], async () => {
        const marker = await validateSchemaMarker(this.db)
        const previous = id === undefined ? undefined : checkEdit(await readRow(this.db, 'collections', id), id, expectedRevision)
        const collection = collectionSchema.parse(previous
          ? { ...previous, ...parsed, revision: previous.revision + 1, updatedAt: updateTime(previous) }
          : { ...newMetadata(), ...parsed })
        await this.checkCollections(previous ? [previous, collection] : [collection])
        if (!previous) await assertTableCapacity(this.db, 'collections', 1)
        await updateWorkspaceBudget(this.db, marker, { collections: { before: previous ? [previous] : [], after: [collection] } }, this.limits)
        if (!previous) await this.db.collections.add(collection)
        else await this.db.collections.put(collection)
        return collection
      })
    })
  }

  async savePreset(draft: PresetDraft, id?: string, expectedRevision?: number): Promise<ExamPreset> {
    return storageOperation('Could not save preset', async () => {
      assertPlainData(draft)
      const parsed = presetDraftSchema.parse(draft)
      validateEditArguments(id, expectedRevision)
      await this.open()
      return this.db.transaction('rw', [this.db.metadata, this.db.presets], async () => {
        const marker = await validateSchemaMarker(this.db)
        let familyId: string = crypto.randomUUID()
        let version = 1
        const metadata = newMetadata()
        if (id !== undefined) {
          const previous = checkEdit(await readRow(this.db, 'presets', id), id, expectedRevision)
          const family = parseTableRows('presets', await this.db.presets.where('familyId').equals(previous.familyId).toArray())
          validatePresetFamilies(family)
          if (family.some(row => row.version > previous.version)) throw new ConflictError('A newer preset version exists. Refresh and edit the latest version.')
          familyId = previous.familyId
          version = previous.version + 1
          metadata.ownerId = previous.ownerId
          metadata.createdAt = updateTime(previous)
          metadata.updatedAt = metadata.createdAt
        } else if (await this.db.presets.where('familyId').equals(familyId).count()) {
          throw new ConflictError('Generated preset family already exists. Retry creating the preset.')
        }
        const preset = presetSchema.parse({ ...metadata, ...parsed, familyId, version })
        await assertTableCapacity(this.db, 'presets', 1)
        await updateWorkspaceBudget(this.db, marker, { presets: { after: [preset] } }, this.limits)
        await this.db.presets.add(preset)
        return preset
      })
    })
  }

  async addImage(file: File, role: AssetRole): Promise<AssetRecord> {
    return storageOperation('Could not import image', async () => {
      const parsedRole = z.enum(['page', 'crop', 'diagram']).parse(role)
      const asset = await imageFromFile(file, parsedRole, this.decoder)
      await this.open()
      await this.db.transaction('rw', [this.db.metadata, this.db.assets], async () => {
        const marker = await validateSchemaMarker(this.db)
        await assertTableCapacity(this.db, 'assets', 1)
        await updateWorkspaceBudget(this.db, marker, { assets: { after: [asset] } }, this.limits)
        await this.db.assets.add(asset)
      })
      return asset
    })
  }
  async getAsset(id: string): Promise<AssetRecord | undefined> {
    return storageOperation('Could not load image', async () => {
      uuidSchema.parse(id)
      await this.open()
      const asset = await this.db.transaction('r', [this.db.metadata, this.db.assets], async () => {
        await validateSchemaMarker(this.db)
        return readRow(this.db, 'assets', id)
      })
      // Cryptography and pixel decoding must finish outside an IndexedDB transaction.
      return asset === undefined ? undefined : validateAsset(asset, this.decoder)
    })
  }

  async exportBackup(): Promise<Blob> {
    return storageOperation('Could not export backup', async () => createBackup(await this.readSnapshot(), this.decoder, this.limits))
  }
  async inspectBackup(file: File | Blob): Promise<BackupInspection> {
    return storageOperation('Could not inspect backup', async () => {
      const inspection = await inspectBackupFile(file, this.decoder, this.limits)
      // Self-contained backups can be inspected even when their IDs conflict locally.
      // Only partial incoming backups need existing rows to resolve references; restore
      // always rechecks the complete merge and rejects all non-identical collisions.
      try { validateReferences(inspection.backup.payload) } catch (error) {
        if (!(error instanceof StorageError)) throw error
        const existing = await this.readSnapshot()
        validateReferences(referenceUnion(existing, inspection.backup.payload))
      }
      return inspection
    })
  }

  async restoreBackup(inspection: BackupInspection): Promise<void> {
    return storageOperation('Could not restore backup', async () => {
      const incoming = (await revalidateInspection(inspection, this.decoder, this.limits)).payload
      await this.open()
      // Cryptography and decoding must finish outside the IndexedDB write transaction.
      const existingAssets = (await this.readSnapshot()).assets
      const verifiedAssets = new Map<string, AssetRecord>()
      for (const asset of existingAssets) verifiedAssets.set(asset.id, await validateAsset(asset, this.decoder))
      await this.db.transaction('rw', this.db.tables, async () => {
        const existing = await readData(this.db, this.limits)
        validateReferences(existing)
        if (existing.assets.length !== verifiedAssets.size || existing.assets.some(asset => !verifiedAssets.has(asset.id) || !assetEqual(asset, verifiedAssets.get(asset.id)!))) {
          throw new ConflictError('Images changed during backup validation. Inspect and restore again.')
        }
        const noConflicts = <T>(table: string, oldRows: T[], newRows: T[], key: (row: T) => string, equal: (left: T, right: T) => boolean): T[] => {
          const old = new Map(oldRows.map(row => [key(row), row]))
          const additions: T[] = []
          for (const row of newRows) {
            const previous = old.get(key(row))
            if (previous !== undefined) {
              if (!equal(previous, row)) throw new ConflictError(`Backup conflicts with existing ${table} ID ${key(row)}. No data was changed.`)
            } else additions.push(row)
          }
          return additions
        }
        const additions: WorkspaceData = {
          questions: noConflicts('questions', existing.questions, incoming.questions, row => row.id, recordEqual),
          questionVersions: noConflicts('questionVersions', existing.questionVersions, incoming.questionVersions, versionKey, recordEqual),
          collections: noConflicts('collections', existing.collections, incoming.collections, row => row.id, recordEqual),
          presets: noConflicts('presets', existing.presets, incoming.presets, row => row.id, recordEqual),
          history: noConflicts('history', existing.history, incoming.history, row => row.id, recordEqual),
          assets: noConflicts('assets', existing.assets, incoming.assets, row => row.id, assetEqual),
        }
        const merged = parseWorkspaceData(referenceUnion(existing, incoming))
        validateReferences(merged)
        const marker = await validateSchemaMarker(this.db)
        const mergedBudget = calculateWorkspaceBudget(merged, marker.budget.revision + 1)
        assertWorkspaceBudget(mergedBudget, this.limits)
        await this.db.metadata.put({ ...marker, budget: mergedBudget })
        await this.db.questions.bulkAdd(additions.questions)
        await this.db.questionVersions.bulkAdd(additions.questionVersions)
        await this.db.collections.bulkAdd(additions.collections)
        await this.db.presets.bulkAdd(additions.presets)
        await this.db.history.bulkAdd(additions.history)
        await this.db.assets.bulkAdd(additions.assets)
      })
    })
  }
}

export const workspace = new WorkspaceStore()
