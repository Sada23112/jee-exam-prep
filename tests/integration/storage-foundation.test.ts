import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import type { PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { ConflictError, StorageError, WorkspaceStore } from '../../src/infrastructure/storage/workspace'
import { hashBytes, inspectImageHeader } from '../../src/infrastructure/storage/assets'
import { calculateWorkspaceBudget } from '../../src/infrastructure/storage/budget'
import { DATABASE_SCHEMA_VERSION } from '../../src/infrastructure/storage/database'
import { onePixelPng as png } from '../fixtures/png'

const stores: WorkspaceStore[] = []
function store(name = `storage-test-${crypto.randomUUID()}`) {
  const instance = new WorkspaceStore(name, { imageDecoder: async blob => inspectImageHeader(new Uint8Array(await blob.arrayBuffer())) })
  stores.push(instance)
  return instance
}
const draft = () => ({ ...createEmptyQuestionDraft(), prompt: '  Original $x$\n' })
const preset: PresetDraft = {
  name: 'My custom rules', description: '', durationMinutes: 120, subjects: ['Physics'],
  questionOrder: 'original', navigation: 'free', resumePolicy: 'continue-deadline', multipleCorrectPolicy: 'exact-set',
  marking: {
    'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
    'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 },
    numerical: { correct: 4, incorrect: 0, unattempted: 0 },
  },
}

afterEach(async () => {
  vi.restoreAllMocks()
  const names = new Set(stores.map(instance => instance.db.name))
  for (const instance of stores) instance.db.close()
  for (const name of names) await Dexie.delete(name)
  stores.length = 0
})

describe('versioned local workspace repository', () => {
  it('opens an empty workspace without fake seed data', async () => {
    const db = store()
    await db.open()
    expect(db.db.verno).toBe(DATABASE_SCHEMA_VERSION)
    expect(await db.db.metadata.get('schema')).toEqual({ key: 'schema', version: 1, budget: calculateWorkspaceBudget() })
    expect(await db.listQuestions()).toEqual([])
    expect(await db.listCollections()).toEqual([])
    expect(await db.listPresets()).toEqual([])
    expect(await db.listHistory()).toEqual([])
  })
  it('persists exact wording and immutable revisions across refresh/reopen', async () => {
    const first = store()
    const q = await first.saveQuestion(draft())
    const other = await first.saveQuestion({ ...draft(), prompt: 'second' })
    const changed = await first.saveQuestion({ ...draft(), prompt: '  Changed\n' }, q.id, q.revision)
    expect(changed.revision).toBe(2)
    expect(changed.createdAt).toBe(q.createdAt)
    expect(await first.db.questionVersions.get([q.id, 1])).toEqual(q)
    first.db.close()
    const reopened = store(first.db.name)
    expect(await reopened.listQuestions()).toEqual([changed, other].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id)))
    expect(await reopened.db.questionVersions.count()).toBe(3)
  })
  it('uses revision CAS and prevents lost concurrent/stale edits and archives', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    const secondClient = store(db.db.name)
    const results = await Promise.allSettled([
      db.saveQuestion({ ...draft(), prompt: 'client one' }, q.id, 1),
      secondClient.saveQuestion({ ...draft(), prompt: 'client two' }, q.id, 1),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError)
    await expect(db.saveQuestion(draft(), q.id)).rejects.toThrow(ConflictError)
    await expect(db.archiveQuestions([q.id], { [q.id]: 1 })).rejects.toThrow(ConflictError)
    expect(await db.db.questionVersions.count()).toBe(2)
  })
  it('archives atomically, removes active collection membership, and preserves all revisions', async () => {
    const db = store()
    const first = await db.saveQuestion(draft())
    const second = await db.saveQuestion(draft())
    const collection = await db.saveCollection({ name: 'Study', description: '', questionIds: [first.id, second.id] })
    await expect(db.archiveQuestions([first.id, second.id], { [first.id]: 1, [second.id]: 9 })).rejects.toThrow(ConflictError)
    expect(await db.listQuestions()).toHaveLength(2)
    expect(await db.db.questionVersions.count()).toBe(2)
    await db.archiveQuestions([first.id], { [first.id]: 1 })
    expect(await db.listQuestions()).toEqual([second])
    const changedCollection = (await db.listCollections())[0]!
    expect(changedCollection.questionIds).toEqual([second.id])
    expect(changedCollection.revision).toBe(2)
    const tombstone = await db.db.questions.get(first.id)
    expect(tombstone?.deletedAt).not.toBeNull()
    expect(tombstone?.revision).toBe(2)
    expect(await db.db.questionVersions.count()).toBe(3)
    await expect(db.saveQuestion(draft(), first.id, 2)).rejects.toThrow(ConflictError)
    await expect(db.saveCollection({ name: 'Study', description: '', questionIds: [second.id] }, collection.id, 1)).rejects.toThrow(ConflictError)
  })
  it('rejects dangling/archived collection refs and unowned/missing assets without writes', async () => {
    const db = store()
    const missing = crypto.randomUUID()
    await expect(db.saveCollection({ name: 'No', description: '', questionIds: [missing] })).rejects.toThrow(/missing/i)
    await expect(db.saveQuestion({ ...draft(), assets: [{ assetId: missing, role: 'page', pageNumber: 1 }] })).rejects.toThrow(/missing image/i)
    expect(await db.db.questions.count()).toBe(0)
    expect(await db.db.questionVersions.count()).toBe(0)
    const q = await db.saveQuestion(draft())
    await db.archiveQuestions([q.id], { [q.id]: 1 })
    await expect(db.saveCollection({ name: 'No', description: '', questionIds: [q.id] })).rejects.toThrow(/archived/i)
  })
  it('creates immutable preset versions with distinct IDs and safe concurrent editing', async () => {
    const db = store()
    const first = await db.savePreset(preset)
    const next = await db.savePreset({ ...preset, name: 'Updated', durationMinutes: 180 }, first.id, 1)
    expect(next.id).not.toBe(first.id)
    expect(next.familyId).toBe(first.familyId)
    expect(next.version).toBe(2)
    expect(next.revision).toBe(1)
    expect(await db.db.presets.get(first.id)).toEqual(first)
    expect(await db.listPresets()).toEqual([next])
    await expect(db.savePreset(preset, first.id, 1)).rejects.toThrow(ConflictError)
    const concurrent = await Promise.allSettled([db.savePreset(preset, next.id, 1), db.savePreset(preset, next.id, 1)])
    expect(concurrent.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await db.db.presets.count()).toBe(3)
  })
  it('uses collection revision CAS inside the scoped transaction to reject simultaneous lost edits', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    const collection = await db.saveCollection({ name: 'Original', description: '', questionIds: [q.id] })
    const secondClient = store(db.db.name)
    await secondClient.open()
    const results = await Promise.allSettled([
      db.saveCollection({ name: 'Client one', description: '', questionIds: [q.id] }, collection.id, 1),
      secondClient.saveCollection({ name: 'Client two', description: '', questionIds: [] }, collection.id, 1),
    ])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(ConflictError)
    expect((await db.db.collections.get(collection.id))?.revision).toBe(2)
    expect(await db.db.questionVersions.count()).toBe(1)
  })
  it('rolls back question and collection changes on simulated storage quota failure', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    const collection = await db.saveCollection({ name: 'Study', description: '', questionIds: [q.id] })
    vi.spyOn(db.db.questionVersions, 'add').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(db.saveQuestion({ ...draft(), prompt: 'not committed' }, q.id, 1)).rejects.toThrow(/quota/i)
    expect(await db.db.questions.get(q.id)).toEqual(q)
    vi.spyOn(db.db.collections, 'bulkPut').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    await expect(db.archiveQuestions([q.id], { [q.id]: 1 })).rejects.toThrow(StorageError)
    expect(await db.db.questions.get(q.id)).toEqual(q)
    expect(await db.db.questionVersions.count()).toBe(1)
    expect(await db.db.collections.get(collection.id)).toEqual(collection)
  })
  it('never clears corrupt current records or unsupported database versions on failed open', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    await db.db.questions.put({ ...q, schemaVersion: 2 } as unknown as typeof q)
    db.db.close()
    const reopened = store(db.db.name)
    await expect(reopened.open()).rejects.toThrow(StorageError)
    await db.db.open()
    expect(await db.db.questions.count()).toBe(1)
    expect((await db.db.questions.get(q.id))?.schemaVersion).toBe(2)
    const futureName = `future-${crypto.randomUUID()}`
    const future = new Dexie(futureName)
    future.version(2).stores({ protectedData: '&id' })
    await future.open()
    await future.table('protectedData').add({ id: 'untouched' })
    future.close()
    const incompatible = store(futureName)
    await expect(incompatible.open()).rejects.toThrow(StorageError)
    await future.open()
    expect(await future.table('protectedData').get('untouched')).toEqual({ id: 'untouched' })
    future.close()
  })
  it('refuses malformed current-version layouts without recreating their tables', async () => {
    const name = `malformed-layout-${crypto.randomUUID()}`
    const malformed = new Dexie(name)
    malformed.version(1).stores({ protectedData: '&id' })
    await malformed.open()
    await malformed.table('protectedData').add({ id: 'untouched' })
    malformed.close()
    await expect(store(name).open()).rejects.toThrow(/table layout/i)
    await malformed.open()
    expect(await malformed.table('protectedData').get('untouched')).toEqual({ id: 'untouched' })
    malformed.close()
  })
  it('refuses implicit upgrades of unknown legacy layouts without deleting their tables', async () => {
    const name = `legacy-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(0.1).stores({ protectedData: '&id' })
    await legacy.open()
    await legacy.table('protectedData').add({ id: 'preserve-old-data' })
    legacy.close()
    await expect(store(name).open()).rejects.toThrow(/explicit compatible migration/i)
    await legacy.open()
    expect(await legacy.table('protectedData').get('preserve-old-data')).toEqual({ id: 'preserve-old-data' })
    expect(legacy.tables.map(table => table.name)).toEqual(['protectedData'])
    legacy.close()
  })
  it('fails safely on missing/malformed schema markers without clearing data', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    await db.db.metadata.put({ key: 'schema', version: 2 } as unknown as import('../../src/infrastructure/storage/database').WorkspaceMetadata)
    db.db.close()
    await expect(store(db.db.name).open()).rejects.toThrow(StorageError)
    await db.db.open()
    expect(await db.db.questions.get(q.id)).toEqual(q)
    await db.db.metadata.clear()
    db.db.close()
    await expect(store(db.db.name).open()).rejects.toThrow(/marker/i)
    await db.db.open()
    expect(await db.db.questionVersions.count()).toBe(1)
  })
  it('revalidates persisted semantics on reads rather than trusting Dexie types', async () => {
    const db = store()
    const q = await db.saveQuestion(draft())
    await db.db.questions.put({ ...q, verification: 'verified' })
    await expect(db.listQuestions()).rejects.toThrow(StorageError)
    await expect(db.exportBackup()).rejects.toThrow(StorageError)
    expect(await db.db.questions.count()).toBe(1)
  })
})

describe('safe original image handling', () => {
  it('validates signature, decoded pixels, limits and SHA-256; keeps archived images', async () => {
    const db = store()
    const file = new File([png()], 'original.png', { type: 'image/png' })
    const asset = await db.addImage(file, 'page')
    expect(asset.width).toBe(1)
    expect(asset.height).toBe(1)
    expect(asset.sha256).toBe(await hashBytes(png()))
    expect(await (await db.getAsset(asset.id))!.blob.arrayBuffer()).toEqual(await file.arrayBuffer())
    const q = await db.saveQuestion({ ...draft(), assets: [{ assetId: asset.id, role: 'page', pageNumber: 1 }] })
    await db.archiveQuestions([q.id], { [q.id]: 1 })
    expect(await db.getAsset(asset.id)).toBeDefined()
    await expect(db.saveQuestion({ ...draft(), assets: [{ assetId: asset.id, role: 'crop', pageNumber: null }] })).rejects.toThrow(/role/i)
  })
  it('rejects MIME spoofing, SVG/GIF, empty/oversized files and excessive pixel dimensions', async () => {
    const db = store()
    for (const file of [new File([png()], 'spoof.jpg', { type: 'image/jpeg' }), new File(['<svg/>'], 'svg.png', { type: 'image/png' }), new File(['GIF89a'], 'anim.gif', { type: 'image/gif' }), new File([], 'empty.png', { type: 'image/png' }), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })]) {
      await expect(db.addImage(file, 'page')).rejects.toThrow(StorageError)
    }
    const huge = png()
    new DataView(huge.buffer).setUint32(16, 40_000_001)
    await expect(db.addImage(new File([huge], 'huge.png', { type: 'image/png' }), 'page')).rejects.toThrow(/pixels/i)
    expect(await db.db.assets.count()).toBe(0)
  })
  it('requires successful decoded pixel validation instead of relying solely on headers', async () => {
    const db = new WorkspaceStore(`storage-decode-${crypto.randomUUID()}`, { imageDecoder: async () => { throw new Error('bad pixels') } })
    stores.push(db)
    await expect(db.addImage(new File([png()], 'corrupt.png', { type: 'image/png' }), 'page')).rejects.toThrow(/bad pixels/i)
    expect(await db.db.assets.count()).toBe(0)
  })
})
