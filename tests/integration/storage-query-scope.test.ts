import Dexie from 'dexie'
import type { DBCoreKeyRange } from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../../src/infrastructure/storage/workspace'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import type { Question } from '../../src/modules/question-bank/domain/question'
import type { PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { historySchema } from '../../src/modules/results/domain/history'
import { inspectImageHeader } from '../../src/infrastructure/storage/assets'
import { calculateWorkspaceBudget } from '../../src/infrastructure/storage/budget'
import { onePixelPng } from '../fixtures/png'

type QueryTrace = {
  table: string
  operation: 'get' | 'getMany' | 'query' | 'cursor' | 'count'
  index?: string | null
  range?: DBCoreKeyRange
  rows: number
}
type TransactionTrace = { tables: string[]; mode: string }
const instances: WorkspaceStore[] = []
const presetDraft: PresetDraft = {
  name: 'User rules', description: '', durationMinutes: 60, subjects: ['Physics'], questionOrder: 'original',
  navigation: 'free', resumePolicy: 'continue-deadline', multipleCorrectPolicy: 'exact-set',
  marking: { 'single-correct': { correct: 4, incorrect: -1, unattempted: 0 }, 'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 }, numerical: { correct: 4, incorrect: 0, unattempted: 0 } },
}
function instrumentedStore() {
  const queries: QueryTrace[] = []
  const transactions: TransactionTrace[] = []
  const store = new WorkspaceStore(`query-scope-${crypto.randomUUID()}`, { imageDecoder: async blob => inspectImageHeader(new Uint8Array(await blob.arrayBuffer())) })
  instances.push(store)
  // Observe actual Dexie/IndexedDB queries, not just high-level toArray method calls:
  // this catches alternate cursor scans and full-table materialization regressions.
  store.db.use({
    stack: 'dbcore', name: 'test-query-scope', level: 100,
    create: down => ({
      ...down,
      transaction(tables, mode, options) {
        transactions.push({ tables: [...tables].sort(), mode })
        return down.transaction(tables, mode, options)
      },
      table(name) {
        const table = down.table(name)
        return {
          ...table,
          async get(request) {
            const value = await table.get(request)
            queries.push({ table: name, operation: 'get', rows: value === undefined ? 0 : 1 })
            return value
          },
          async getMany(request) {
            const values = await table.getMany(request)
            queries.push({ table: name, operation: 'getMany', rows: values.filter(value => value !== undefined).length })
            return values
          },
          async query(request) {
            const result = await table.query(request)
            queries.push({ table: name, operation: 'query', index: request.query.index.name, range: request.query.range, rows: result.result.length })
            return result
          },
          async openCursor(request) {
            queries.push({ table: name, operation: 'cursor', index: request.query.index.name, range: request.query.range, rows: 0 })
            return table.openCursor(request)
          },
          async count(request) {
            queries.push({ table: name, operation: 'count', index: request.query.index.name, range: request.query.range, rows: 0 })
            return table.count(request)
          },
        }
      },
    }),
  })
  return { store, queries, transactions, reset() { queries.length = 0; transactions.length = 0 } }
}
function metadata() {
  const time = '2026-01-01T00:00:00.000Z'
  return { id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, revision: 1, createdAt: time, updatedAt: time, deletedAt: null, remoteRevision: null }
}
async function scalableFixture(size: number) {
  const observed = instrumentedStore()
  const { store } = observed
  await store.open()
  const questions: Question[] = Array.from({ length: size }, (_, index) => ({
    ...metadata(), ...createEmptyQuestionDraft(), prompt: `Fixture ${index}`, verification: 'verified', answerVerification: 'verified',
    options: [{ id: 'A', text: 'one' }, { id: 'B', text: 'two' }], correctOptionIds: ['A'],
  }))
  const presets = Array.from({ length: size }, () => ({ ...metadata(), ...presetDraft, familyId: crypto.randomUUID(), version: 1 }))
  const collections = questions.map(question => ({ ...metadata(), name: `For ${question.id}`, description: '', questionIds: [question.id] }))
  const history = questions.map((question, index) => historySchema.parse({
    ...metadata(), name: `Actual fixture ${index}`, presetSnapshot: presets[index], questionSnapshots: [question],
    startedAt: question.createdAt, deadlineAt: '2026-01-01T01:00:00.000Z', submittedAt: null, status: 'in-progress', totalScore: null, responses: [],
  }))
  await store.db.transaction('rw', store.db.tables, async () => {
    await store.db.questions.bulkAdd(questions)
    await store.db.questionVersions.bulkAdd(questions)
    await store.db.collections.bulkAdd(collections)
    await store.db.presets.bulkAdd(presets)
    await store.db.history.bulkAdd(history)
    await store.db.metadata.put({ key: 'schema', version: 1, budget: calculateWorkspaceBudget({ questions, questionVersions: questions, collections, presets, history, assets: [] }) })
  })
  // Comprehensive startup is intentional; install/reset observations only for routine work.
  store.db.close()
  await store.open()
  observed.reset()
  return { ...observed, questions, presets, collections, history }
}
function expectScope(observed: ReturnType<typeof instrumentedStore>, tables: string[], mode: 'readonly' | 'readwrite') {
  expect(observed.transactions).toEqual([{ tables: [...tables].sort(), mode }])
  expect(observed.queries.every(query => tables.includes(query.table))).toBe(true)
  expect(observed.queries.some(query => query.table === 'metadata' && query.operation === 'count')).toBe(true)
  expect(observed.queries.some(query => query.table === 'metadata' && query.operation === 'get')).toBe(true)
}
function scannedTables(queries: QueryTrace[]): string[] {
  return queries.filter(query => query.operation === 'query' || query.operation === 'cursor').map(query => query.table)
}

afterEach(async () => {
  for (const store of instances) { store.db.close(); await Dexie.delete(store.db.name) }
  instances.length = 0
})

describe('routine repository query scope', () => {
  it('lists only each validated target table and essential collection membership dependencies', async () => {
    const fixture = await scalableFixture(12)
    const { store, reset, queries } = fixture
    expect(await store.listQuestions()).toHaveLength(12)
    expectScope(fixture, ['metadata', 'questions'], 'readonly')
    expect(scannedTables(queries)).toEqual(['questions'])
    reset()
    expect(await store.listCollections()).toHaveLength(12)
    expectScope(fixture, ['metadata', 'collections', 'questions'], 'readonly')
    expect(scannedTables(queries)).toEqual(['collections'])
    expect(queries.some(query => query.table === 'questions' && query.operation === 'getMany' && query.rows === 12)).toBe(true)
    reset()
    expect(await store.listPresets()).toHaveLength(12)
    expectScope(fixture, ['metadata', 'presets'], 'readonly')
    expect(scannedTables(queries)).toEqual(['presets'])
    reset()
    expect(await store.listHistory()).toHaveLength(12)
    expectScope(fixture, ['metadata', 'history'], 'readonly')
    expect(scannedTables(queries)).toEqual(['history'])
  })
  it.each([8, 1_024])('saves by row/family without materializing unrelated records in a %i-record workspace', async size => {
    const fixture = await scalableFixture(size)
    const { store, reset, queries, questions, collections, presets } = fixture
    const question = questions[0]!
    const edited = await store.saveQuestion({ ...createEmptyQuestionDraft(), prompt: 'Edited' }, question.id, 1)
    expectScope(fixture, ['metadata', 'questions', 'questionVersions', 'assets'], 'readwrite')
    expect(scannedTables(queries)).toEqual([])
    expect(queries.filter(query => query.table !== 'metadata').reduce((sum, query) => sum + query.rows, 0)).toBe(2)
    reset()
    const fresh = await store.saveQuestion({ ...createEmptyQuestionDraft(), prompt: 'New' })
    expectScope(fixture, ['metadata', 'questions', 'questionVersions', 'assets'], 'readwrite')
    expect(scannedTables(queries)).toEqual([])
    reset()
    const collection = collections[0]!
    await store.saveCollection({ name: 'Edited membership', description: '', questionIds: [edited.id, fresh.id] }, collection.id, 1)
    expectScope(fixture, ['metadata', 'collections', 'questions'], 'readwrite')
    expect(scannedTables(queries)).toEqual([])
    // Previous/new memberships share the edited question; dependencies are deduplicated.
    expect(queries.filter(query => query.table !== 'metadata').reduce((sum, query) => sum + query.rows, 0)).toBe(3)
    reset()
    const rules = presets[0]!
    const next = await store.savePreset({ ...presetDraft, name: 'v2' }, rules.id, 1)
    expectScope(fixture, ['metadata', 'presets'], 'readwrite')
    expect(scannedTables(queries)).toEqual(['presets'])
    const familyQuery = queries.find(query => query.table === 'presets' && query.operation === 'query')!
    expect(familyQuery.index).toBe('familyId')
    expect(familyQuery.range?.lower).toBe(rules.familyId)
    expect(familyQuery.range?.upper).toBe(rules.familyId)
    expect(familyQuery.rows).toBe(1)
    reset()
    expect(await store.db.questionVersions.get([question.id, 1])).toEqual(question)
    expect(await store.db.questionVersions.get([question.id, 2])).toEqual(edited)
    expect(await store.db.presets.get(rules.id)).toEqual(rules)
    expect(next.version).toBe(2)
  }, 20_000) // Fixture/setup budget only; query-count assertions, never latency thresholds.
  it('archives selected rows atomically without scanning revision/history/preset/asset tables', async () => {
    const fixture = await scalableFixture(12)
    const { store, queries, questions } = fixture
    await store.archiveQuestions([questions[0]!.id], { [questions[0]!.id]: 1 })
    expectScope(fixture, ['metadata', 'questions', 'questionVersions', 'collections', 'assets'], 'readwrite')
    expect(scannedTables(queries)).toEqual(['collections'])
    expect(await store.db.questionVersions.count()).toBe(13)
    expect((await store.db.collections.get(fixture.collections[0]!.id))?.questionIds).toEqual([])
  })
  it('imports/loads only one asset and validates referenced assets without a full asset-table read', async () => {
    const observed = instrumentedStore()
    await observed.store.open()
    observed.reset()
    const asset = await observed.store.addImage(new File([onePixelPng()], 'source.png', { type: 'image/png' }), 'page')
    expectScope(observed, ['metadata', 'assets'], 'readwrite')
    expect(scannedTables(observed.queries)).toEqual([])
    observed.reset()
    expect((await observed.store.getAsset(asset.id))?.id).toBe(asset.id)
    expectScope(observed, ['metadata', 'assets'], 'readonly')
    expect(scannedTables(observed.queries)).toEqual([])
    observed.reset()
    await observed.store.saveQuestion({ ...createEmptyQuestionDraft(), assets: [{ assetId: asset.id, role: 'page', pageNumber: 1 }] })
    expectScope(observed, ['metadata', 'questions', 'questionVersions', 'assets'], 'readwrite')
    expect(scannedTables(observed.queries)).toEqual([])
    expect(observed.queries.some(query => query.table === 'assets' && query.operation === 'getMany' && query.rows === 1)).toBe(true)
  })
  it('rejects changed schema markers on routine reads/writes, not only after reopening', async () => {
    const observed = instrumentedStore()
    const { store, reset } = observed
    const q = await store.saveQuestion(createEmptyQuestionDraft())
    const asset = await store.addImage(new File([onePixelPng()], 'source.png', { type: 'image/png' }), 'page')
    await store.db.metadata.put({ key: 'schema', version: 2 } as unknown as import('../../src/infrastructure/storage/database').WorkspaceMetadata)
    reset()
    for (const operation of [
      () => store.listQuestions(), () => store.listCollections(), () => store.listPresets(), () => store.listHistory(),
      () => store.getAsset(asset.id), () => store.saveQuestion(createEmptyQuestionDraft(), q.id, 1),
      () => store.saveCollection({ name: 'No commit', description: '', questionIds: [] }),
      () => store.savePreset(presetDraft), () => store.archiveQuestions([q.id], { [q.id]: 1 }),
      () => store.addImage(new File([onePixelPng()], 'source.png', { type: 'image/png' }), 'page'),
    ]) await expect(operation()).rejects.toThrow()
    expect(await store.db.questions.get(q.id)).toEqual(q)
    expect(await store.db.questionVersions.count()).toBe(1)
    expect(await store.db.collections.count()).toBe(0)
    expect(await store.db.presets.count()).toBe(0)
    expect(await store.db.assets.count()).toBe(1)
  })
  it('validates relevant current rows/revisions and dependencies but defers unrelated corruption to startup/export', async () => {
    const fixture = await scalableFixture(2)
    const { store, questions, collections, presets } = fixture
    const q = questions[0]!
    await store.db.history.put({ ...fixture.history[0]!, totalScore: 4 }) // Invalid in-progress attempt.
    expect(await store.listQuestions()).toHaveLength(2)
    await store.saveCollection({ name: 'Related valid edit', description: '', questionIds: [q.id] }, collections[0]!.id, 1)
    await store.savePreset(presetDraft, presets[0]!.id, 1)
    await expect(store.listHistory()).rejects.toThrow()
    await expect(store.exportBackup()).rejects.toThrow()
    await store.db.questionVersions.delete([q.id, 1])
    await expect(store.saveQuestion(createEmptyQuestionDraft(), q.id, 1)).rejects.toThrow(/immutable revision/i)
    expect(await store.db.questions.get(q.id)).toEqual(q)
    // Relevant dependency rows are also schema-validated, not trusted as typed records.
    await store.db.questions.put({ ...q, verification: 'incomplete', options: [], answerVerification: 'verified' })
    await expect(store.listQuestions()).rejects.toThrow()
    await expect(store.listCollections()).rejects.toThrow()
    await expect(store.saveCollection({ name: 'No', description: '', questionIds: [q.id] })).rejects.toThrow()
    await expect(store.archiveQuestions([q.id], { [q.id]: 1 })).rejects.toThrow()
    store.db.close()
    await expect(store.open()).rejects.toThrow()
  })
})
