import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../../src/infrastructure/storage/workspace'
import type { WorkspaceMetadata } from '../../src/infrastructure/storage/database'
import {
  calculateWorkspaceBudget, DEFAULT_STORAGE_LIMITS, estimateBackupEnvelopeBytes, estimateJsonUtf8,
  INSPECTION_NODE_HEADROOM, MAX_BACKUP_BYTES, MAX_BACKUP_IMAGE_BYTES, storageLimits,
} from '../../src/infrastructure/storage/budget'
import type { StorageLimits } from '../../src/infrastructure/storage/budget'
import { inspectImageHeader } from '../../src/infrastructure/storage/assets'
import { DATA_TABLES, readData } from '../../src/infrastructure/storage/validation'
import type { WorkspaceData } from '../../src/infrastructure/storage/validation'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import type { Question } from '../../src/modules/question-bank/domain/question'
import type { PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { onePixelPng } from '../fixtures/png'

const instances: WorkspaceStore[] = []
const preset: PresetDraft = {
  name: 'Rules', description: '', durationMinutes: 60, subjects: ['Physics'], questionOrder: 'original',
  navigation: 'free', resumePolicy: 'continue-deadline', multipleCorrectPolicy: 'exact-set',
  marking: { 'single-correct': { correct: 4, incorrect: -1, unattempted: 0 }, 'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 }, numerical: { correct: 4, incorrect: 0, unattempted: 0 } },
}
const time = '2026-01-01T00:00:00.000Z'
function metadata() {
  return { id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, revision: 1, createdAt: time, updatedAt: time, deletedAt: null, remoteRevision: null }
}
function question(prompt = ''): Question { return { ...metadata(), ...createEmptyQuestionDraft(), prompt } }
function data(partial: Partial<WorkspaceData> = {}): WorkspaceData {
  return { questions: [], questionVersions: [], collections: [], presets: [], history: [], assets: [], ...partial }
}
function store(limits: Partial<StorageLimits> = {}, name = `storage-budget-${crypto.randomUUID()}`) {
  const instance = new WorkspaceStore(name, { limits, imageDecoder: async blob => inspectImageHeader(new Uint8Array(await blob.arrayBuffer())) })
  instances.push(instance)
  return instance
}
function image() { return new File([onePixelPng()], 'source.png', { type: 'image/png' }) }
async function marker(instance: WorkspaceStore) { return (await instance.db.metadata.get('schema'))! }
async function snapshot(instance: WorkspaceStore) { return instance.db.transaction('r', instance.db.tables, () => readData(instance.db)) }
async function restorable(instance: WorkspaceStore, limits: Partial<StorageLimits> = {}) {
  const blob = await instance.exportBackup()
  const envelope = JSON.parse(await blob.text()) as { exportedAt: string; checksum: { algorithm: string; value: string }; payload: unknown }
  const original = await snapshot(instance)
  expect(estimateBackupEnvelopeBytes(original, envelope.exportedAt, envelope.checksum)).toBe(blob.size)
  expect((await marker(instance)).budget.encodedBytes).toBe(blob.size + 3)
  const target = store(limits)
  const inspection = await target.inspectBackup(blob)
  await target.restoreBackup(inspection)
  expect((await marker(target)).budget).toMatchObject({ ...(await marker(instance)).budget, revision: expect.any(Number) })
  expect(await snapshot(target)).toEqual(original)
  return blob
}

afterEach(async () => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const instance of instances) instance.db.close()
  for (const name of new Set(instances.map(instance => instance.db.name))) await Dexie.delete(name)
  instances.length = 0
})

describe('transactional full-workspace backup budgets', () => {
  it('keeps the production 75 MiB encoded / 55 MiB raw limits immutable; adapters can only lower them', () => {
    expect(DEFAULT_STORAGE_LIMITS.maxBackupBytes).toBe(75 * 1024 * 1024)
    expect(DEFAULT_STORAGE_LIMITS.maxImageBytes).toBe(55 * 1024 * 1024)
    expect(MAX_BACKUP_BYTES).toBe(DEFAULT_STORAGE_LIMITS.maxBackupBytes)
    expect(MAX_BACKUP_IMAGE_BYTES).toBe(DEFAULT_STORAGE_LIMITS.maxImageBytes)
    for (const limits of [{ maxBackupBytes: MAX_BACKUP_BYTES + 1 }, { maxImageBytes: MAX_BACKUP_IMAGE_BYTES + 1 }, { maxBackupBytes: NaN }, { maxDataNodes: 0 }]) {
      expect(() => storageLimits(limits)).toThrow()
    }
  })
  it('rejects the sixth scaled original image atomically, preserving all five originals and an exportable backup', async () => {
    const limits = { maxImageBytes: onePixelPng().length * 5 }
    const instance = store(limits)
    const assets = []
    for (let index = 0; index < 5; index++) assets.push(await instance.addImage(image(), 'page'))
    const before = await marker(instance)
    const add = vi.spyOn(instance.db.assets, 'add')
    await expect(instance.addImage(image(), 'page')).rejects.toThrow(/decoded image limit/i)
    expect(add).not.toHaveBeenCalled()
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.assets.count()).toBe(5)
    for (const asset of assets) expect(await instance.getAsset(asset.id)).toEqual(asset)
    await restorable(instance, limits)
  })
  it('also bounds encoded base64 image bytes independently of the raw-image allowance', async () => {
    const size = onePixelPng().length
    const asset = {
      id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, createdAt: time, name: 'source.png',
      mimeType: 'image/png' as const, role: 'page' as const, size, width: 1, height: 1, sha256: '0'.repeat(64),
      blob: new Blob([onePixelPng()], { type: 'image/png' }),
    }
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ assets: [asset] })).encodedBytes }
    const instance = store(limits)
    const saved = await instance.addImage(image(), 'page')
    const before = await marker(instance)
    expect(before.budget.encodedBytes).toBe(limits.maxBackupBytes)
    await expect(instance.addImage(image(), 'page')).rejects.toThrow(/encoded backup size limit/i)
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.assets.toArray()).toEqual([saved])
    await restorable(instance, limits)
  })
  it('serializes concurrent image imports across tabs against the latest budget in the same transaction', async () => {
    const limits = { maxImageBytes: onePixelPng().length }
    const first = store(limits)
    await first.open()
    const second = store(limits, first.db.name)
    await second.open()
    const results = await Promise.allSettled([first.addImage(image(), 'page'), second.addImage(image(), 'page')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await marker(first)).budget).toMatchObject({ imageBytes: limits.maxImageBytes, revision: 1, counts: { assets: 1 } })
    expect(await marker(second)).toEqual(await marker(first))
    await restorable(first, limits)
  })
  it('charges both the edited current question and its immutable revision, rolling back oversized text', async () => {
    const previous = question()
    const edited = { ...previous, prompt: 'x'.repeat(600), revision: 2 }
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ questions: [edited], questionVersions: [previous, edited] })).encodedBytes - 1 }
    const instance = store(limits)
    const saved = await instance.saveQuestion(createEmptyQuestionDraft())
    const before = await marker(instance)
    const put = vi.spyOn(instance.db.questions, 'put')
    await expect(instance.saveQuestion({ ...createEmptyQuestionDraft(), prompt: edited.prompt }, saved.id, 1)).rejects.toThrow(/encoded backup size limit/i)
    expect(put).not.toHaveBeenCalled()
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.questions.get(saved.id)).toEqual(saved)
    expect(await instance.db.questionVersions.count()).toBe(1)
    await restorable(instance, limits)
  })
  it('bounds cumulative immutable text revisions even when the current wording shrinks', async () => {
    const limits = { maxBackupBytes: 8_000 }
    const instance = store(limits)
    let current = await instance.saveQuestion({ ...createEmptyQuestionDraft(), prompt: 'original' })
    const original = current
    let rejected = false
    for (let index = 0; index < 20; index++) {
      const before = await marker(instance)
      try { current = await instance.saveQuestion({ ...createEmptyQuestionDraft(), prompt: index % 2 ? '' : 'x'.repeat(500) }, current.id, current.revision) }
      catch (error) {
        expect(String(error)).toMatch(/encoded backup size limit/i)
        expect(await marker(instance)).toEqual(before)
        rejected = true
        break
      }
    }
    expect(rejected).toBe(true)
    expect(current.revision).toBeGreaterThan(2)
    expect(await instance.db.questionVersions.count()).toBe(current.revision)
    expect(await instance.db.questionVersions.get([original.id, 1])).toEqual(original)
    await restorable(instance, limits)
  })
  it('rejects an oversized new question without committing either the current row or revision', async () => {
    const q = question('x'.repeat(200))
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ questions: [q], questionVersions: [q] })).encodedBytes - 1 }
    const instance = store(limits)
    await instance.open()
    const before = await marker(instance)
    await expect(instance.saveQuestion({ ...createEmptyQuestionDraft(), prompt: q.prompt })).rejects.toThrow(/encoded backup size limit/i)
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.questions.count()).toBe(0)
    expect(await instance.db.questionVersions.count()).toBe(0)
    await restorable(instance, limits)
  })
  it('accounts for collection creations and edits without losing prior metadata', async () => {
    const collection = { ...metadata(), name: 'Study', description: 'x'.repeat(1_000), questionIds: [] }
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ collections: [collection] })).encodedBytes - 1 }
    const instance = store(limits)
    await instance.open()
    const empty = await marker(instance)
    await expect(instance.saveCollection({ name: collection.name, description: collection.description, questionIds: [] })).rejects.toThrow(/encoded backup size limit/i)
    expect(await marker(instance)).toEqual(empty)
    const saved = await instance.saveCollection({ name: 'Study', description: '', questionIds: [] })
    const before = await marker(instance)
    await expect(instance.saveCollection({ name: 'Study', description: collection.description, questionIds: [] }, saved.id, 1)).rejects.toThrow(/encoded backup size limit/i)
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.collections.get(saved.id)).toEqual(saved)
    await restorable(instance, limits)
  })
  it('charges every immutable preset version rather than replacing the old version budget', async () => {
    const first = { ...metadata(), ...preset, familyId: crypto.randomUUID(), version: 1 }
    const next = { ...first, id: crypto.randomUUID(), version: 2 }
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ presets: [first, next] })).encodedBytes - 1 }
    const instance = store(limits)
    const saved = await instance.savePreset(preset)
    const before = await marker(instance)
    await expect(instance.savePreset(preset, saved.id, 1)).rejects.toThrow(/encoded backup size limit/i)
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.presets.toArray()).toEqual([saved])
    await restorable(instance, limits)
  })
  it('preflights archive tombstones, extra immutable revisions and changed collection rows together', async () => {
    const q = question()
    const archived = { ...q, revision: 2, deletedAt: time }
    const collection = { ...metadata(), name: 'Study', description: '', questionIds: [q.id] }
    const changedCollection = { ...collection, revision: 2, questionIds: [] }
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ questions: [archived], questionVersions: [q, archived], collections: [changedCollection] })).encodedBytes - 1 }
    const instance = store(limits)
    const saved = await instance.saveQuestion(createEmptyQuestionDraft())
    const savedCollection = await instance.saveCollection({ name: 'Study', description: '', questionIds: [saved.id] })
    const before = await marker(instance)
    const put = vi.spyOn(instance.db.questions, 'bulkPut')
    await expect(instance.archiveQuestions([saved.id], { [saved.id]: 1 })).rejects.toThrow(/encoded backup size limit/i)
    expect(put).not.toHaveBeenCalled()
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.questions.get(saved.id)).toEqual(saved)
    expect(await instance.db.collections.get(savedCollection.id)).toEqual(savedCollection)
    expect(await instance.db.questionVersions.count()).toBe(1)
    await restorable(instance, limits)
  })
  it('rolls back the budget CAS when a later row write hits quota', async () => {
    const instance = store()
    const q = await instance.saveQuestion(createEmptyQuestionDraft())
    const collection = await instance.saveCollection({ name: 'Study', description: '', questionIds: [q.id] })
    const before = await marker(instance)
    vi.spyOn(instance.db.questionVersions, 'add').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(instance.saveQuestion({ ...createEmptyQuestionDraft(), prompt: 'not committed' }, q.id, 1)).rejects.toThrow(/quota/i)
    expect(await marker(instance)).toEqual(before)
    vi.spyOn(instance.db.collections, 'bulkPut').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(instance.archiveQuestions([q.id], { [q.id]: 1 })).rejects.toThrow(/quota/i)
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.collections.get(collection.id)).toEqual(collection)
    await restorable(instance)
  })
  it.each(['encoded', 'images'] as const)('rejects an oversized %s merge of individually valid backups before any bulkAdd', async kind => {
    const q = question('x'.repeat(700))
    const limits = kind === 'encoded'
      ? { maxBackupBytes: calculateWorkspaceBudget(data({ questions: [q], questionVersions: [q] })).encodedBytes + 200 }
      : { maxImageBytes: onePixelPng().length }
    const source = store(limits)
    const target = store(limits)
    if (kind === 'encoded') {
      await source.saveQuestion({ ...createEmptyQuestionDraft(), prompt: q.prompt })
      await target.saveQuestion({ ...createEmptyQuestionDraft(), prompt: q.prompt })
    } else {
      await source.addImage(image(), 'page')
      await target.addImage(image(), 'page')
    }
    const before = await marker(target)
    const original = await snapshot(target)
    const inspection = await target.inspectBackup(await source.exportBackup())
    const writes = DATA_TABLES.map(table => vi.spyOn(target.db.table(table), 'bulkAdd'))
    await expect(target.restoreBackup(inspection)).rejects.toThrow(/size limit|decoded image limit/i)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
    expect(await marker(target)).toEqual(before)
    expect(await snapshot(target)).toEqual(original)
    await restorable(source, limits)
    await restorable(target, limits)
  })
  it('charges no duplicate rows on repeated identical restores and validates the resulting counters', async () => {
    const source = store()
    const q = await source.saveQuestion(createEmptyQuestionDraft())
    await source.addImage(image(), 'page')
    await source.saveCollection({ name: 'Study', description: '', questionIds: [q.id] })
    await source.savePreset(preset)
    await source.archiveQuestions([q.id], { [q.id]: 1 })
    const target = store()
    const inspection = await target.inspectBackup(await source.exportBackup())
    await target.restoreBackup(inspection)
    const before = await marker(target)
    await target.restoreBackup(inspection)
    expect((await marker(target)).budget).toEqual({ ...before.budget, revision: before.budget.revision + 1 })
    await restorable(target)
  })
  it('reserves inspection graph nodes so an accepted export cannot fail the restored value-count guard', async () => {
    const q = question()
    const limits = { maxDataNodes: calculateWorkspaceBudget(data({ questions: [q], questionVersions: [q] })).nodes + INSPECTION_NODE_HEADROOM - 1 }
    const instance = store(limits)
    await instance.open()
    const before = await marker(instance)
    await expect(instance.saveQuestion(createEmptyQuestionDraft())).rejects.toThrow(/value-count limit/i)
    expect(await marker(instance)).toEqual(before)
    await restorable(instance, limits)
  })
  it('validates counters at export/restore and once at reopen without silently repairing or removing data', async () => {
    const instance = store()
    const q = await instance.saveQuestion(createEmptyQuestionDraft())
    const before = await marker(instance)
    await instance.db.metadata.put({ ...before, budget: { ...before.budget, encodedBytes: before.budget.encodedBytes + 1 } })
    await expect(instance.exportBackup()).rejects.toThrow(/budget counters/i)
    const source = store()
    const inspection = await instance.inspectBackup(await source.exportBackup())
    await expect(instance.restoreBackup(inspection)).rejects.toThrow(/budget counters/i)
    instance.db.close()
    const reopened = store({}, instance.db.name)
    await expect(reopened.open()).rejects.toThrow(/budget counters/i)
    await instance.db.open()
    expect(await instance.db.questions.get(q.id)).toEqual(q)
    expect((await marker(instance)).budget.encodedBytes).toBe(before.budget.encodedBytes + 1)
    await instance.db.metadata.put({ key: 'schema', version: 1 } as unknown as WorkspaceMetadata)
    instance.db.close()
    await expect(reopened.open()).rejects.toThrow()
    await instance.db.open()
    expect(await instance.db.questionVersions.get([q.id, 1])).toEqual(q)
  })
  it('times out a hung production bitmap decoder without asset or budget writes, then closes late pixels', async () => {
    const instance = new WorkspaceStore(`storage-timeout-${crypto.randomUUID()}`)
    instances.push(instance)
    await instance.open()
    const before = await marker(instance)
    const add = vi.spyOn(instance.db.assets, 'add')
    const put = vi.spyOn(instance.db.metadata, 'put')
    let resolve!: (bitmap: ImageBitmap) => void
    const pixels = new Promise<ImageBitmap>(done => { resolve = done })
    const create = vi.fn(() => pixels)
    vi.stubGlobal('createImageBitmap', create)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = instance.addImage(image(), 'page')
    const rejection = expect(pending).rejects.toThrow(/timed out.*15 seconds/i)
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    const close = vi.fn()
    resolve({ width: 1, height: 1, close } as unknown as ImageBitmap)
    await Promise.resolve()
    vi.useRealTimers()
    expect(close).toHaveBeenCalledTimes(1)
    expect(add).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(await marker(instance)).toEqual(before)
    expect(await instance.db.assets.count()).toBe(0)
    await restorable(instance)
  })
  it('restores an accepted near-boundary export although its inspection wrapper is larger than the envelope limit', async () => {
    const q = question('Unicode हिंदी 😀 "\\\n'.repeat(20))
    const limits = { maxBackupBytes: calculateWorkspaceBudget(data({ questions: [q], questionVersions: [q] })).encodedBytes }
    const source = store(limits)
    await source.saveQuestion({ ...createEmptyQuestionDraft(), prompt: q.prompt })
    const blob = await source.exportBackup()
    expect(blob.size).toBe(limits.maxBackupBytes - 3)
    const target = store(limits)
    const inspection = await target.inspectBackup(blob)
    expect(estimateJsonUtf8(inspection).bytes).toBeGreaterThan(limits.maxBackupBytes)
    await target.restoreBackup(inspection)
    expect(await snapshot(target)).toEqual(await snapshot(source))
    await restorable(target, limits)
  })
})
