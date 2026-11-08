import { createHash } from 'node:crypto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyQuestionDraft, questionSchema } from '../../src/modules/question-bank/domain/question'
import { collectionSchema } from '../../src/modules/question-bank/domain/collection'
import { validateSchemaMarker, workspaceDataSchema } from '../../src/infrastructure/storage/validation'
import { onePixelPng as png } from '../fixtures/png'
import type { Question } from '../../src/modules/question-bank/domain/question'
import type { ExamPreset, PresetDraft } from '../../src/modules/exam-engine/domain/preset'
import { historySchema } from '../../src/modules/results/domain/history'
import { ConflictError, StorageError, WorkspaceStore } from '../../src/infrastructure/storage/workspace'
import type { BackupInspection } from '../../src/infrastructure/storage/workspace'
import { hashBytes, inspectImageHeader } from '../../src/infrastructure/storage/assets'
import { updateWorkspaceBudget } from '../../src/infrastructure/storage/budget'
import { MAX_BACKUP_BYTES } from '../../src/infrastructure/storage/backup'

const instances: WorkspaceStore[] = []
function store() {
  const db = new WorkspaceStore(`backup-test-${crypto.randomUUID()}`, { imageDecoder: async blob => inspectImageHeader(new Uint8Array(await blob.arrayBuffer())) })
  instances.push(db)
  return db
}
const draft = () => ({
  ...createEmptyQuestionDraft(), prompt: '  Original question\n',
  verification: 'verified' as const, answerVerification: 'verified' as const,
  options: [{ id: 'A', text: '  First  ' }, { id: 'B', text: '\nSecond\n' }], correctOptionIds: ['A'],
})
const preset: PresetDraft = {
  name: 'User rules', description: '', durationMinutes: 180, subjects: ['Physics'],
  questionOrder: 'randomised', navigation: 'free', resumePolicy: 'continue-deadline', multipleCorrectPolicy: 'exact-set',
  marking: {
    'single-correct': { correct: 4, incorrect: -1, unattempted: 0 },
    'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 }, numerical: { correct: 4, incorrect: 0, unattempted: 0 },
  },
}
async function addActualHistory(db: WorkspaceStore, q: Question, rules: ExamPreset) {
  const start = new Date().toISOString()
  const history = historySchema.parse({
    id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, revision: 1,
    createdAt: start, updatedAt: start, deletedAt: null, remoteRevision: null, name: 'Actual attempt fixture',
    presetSnapshot: rules, questionSnapshots: [q], startedAt: start, deadlineAt: new Date(Date.parse(start) + 10_800_000).toISOString(),
    submittedAt: start, status: 'submitted',
    responses: [{ questionId: q.id, selectedOptionIds: ['A'], numericalAnswer: '', visited: true, markedForReview: false, timeSpentMs: 0 }], totalScore: 4,
  })
  // Fixture for the future history port; even test writes preserve budget accounting.
  await db.db.transaction('rw', [db.db.metadata, db.db.history], async () => {
    const marker = await validateSchemaMarker(db.db)
    await updateWorkspaceBudget(db.db, marker, { history: { after: [history] } })
    await db.db.history.add(history)
  })
  return history
}
async function encoded(blob: Blob): Promise<Record<string, unknown>> { return JSON.parse(await blob.text()) as Record<string, unknown> }
// Independent canonical/digest implementation: semantic fixtures are intentionally re-signed
// so duplicate/reference/image/schema tests still reach their specific validation boundary.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)!
}
function envelopeChecksum(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalJson({ format: value.format, version: value.version, exportedAt: value.exportedAt, payload: value.payload }), 'utf8').digest('hex')
}
async function altered(blob: Blob, mutate: (value: Record<string, unknown>) => void, recalculateChecksum = true): Promise<Blob> {
  const value = await encoded(blob)
  mutate(value)
  if (recalculateChecksum) value.checksum = { algorithm: 'SHA-256', value: envelopeChecksum(value) }
  return new Blob([JSON.stringify(value)], { type: 'application/json' })
}
function payload(value: Record<string, unknown>): Record<string, Record<string, unknown>[]> {
  return value.payload as Record<string, Record<string, unknown>[]>
}
async function tableCounts(db: WorkspaceStore) {
  return Promise.all([db.db.questions.count(), db.db.questionVersions.count(), db.db.collections.count(), db.db.presets.count(), db.db.history.count(), db.db.assets.count()])
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const db of instances) { db.db.close(); await Dexie.delete(db.db.name) }
  instances.length = 0
})

describe('bounded self-contained version 1 backups', () => {
  it('exports/imports an empty workspace as a valid backup', async () => {
    const source = store()
    const target = store()
    const blob = await source.exportBackup()
    const inspection = await target.inspectBackup(blob)
    expect(inspection.counts).toEqual({ questions: 0, collections: 0, presets: 0, history: 0, assets: 0 })
    expect(Number.isNaN(Date.parse(inspection.createdAt))).toBe(false)
    await target.restoreBackup(inspection)
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
  })
  it('checksums the complete canonical envelope and accepts JSON whitespace/object-key reorderings only', async () => {
    const source = store()
    await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    await source.saveQuestion(draft())
    await source.savePreset(preset)
    const original = await source.exportBackup()
    const value = await encoded(original)
    expect(value.checksum).toEqual({ algorithm: 'SHA-256', value: envelopeChecksum(value) })
    function reorder(item: unknown): unknown {
      if (Array.isArray(item)) return item.map(reorder)
      if (item !== null && typeof item === 'object') {
        return Object.fromEntries(Object.entries(item).reverse().map(([key, nested]) => [key, reorder(nested)]))
      }
      return item
    }
    const target = store()
    const inspection = await target.inspectBackup(new Blob([JSON.stringify(reorder(value), null, 2)]))
    expect(inspection.backup.checksum).toEqual(value.checksum)
    await target.restoreBackup(inspection)
    expect(await tableCounts(target)).toEqual([1, 1, 0, 1, 0, 1])
  })
  it.each(['description', 'current-and-version-key', 'normalizable-metadata', 'exportedAt', 'image-name', 'image-bytes'] as const)('rejects unchanged envelope checksum after schema-valid %s corruption with no writes', async field => {
    const source = store()
    const image = await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    await source.saveQuestion({ ...draft(), assets: [{ assetId: image.id, role: 'page', pageNumber: 1 }] })
    await source.saveCollection({ name: 'Original', description: 'Original description', questionIds: [] })
    const target = store()
    const retained = await target.saveQuestion({ ...draft(), prompt: 'Unrelated local data' })
    const before = await tableCounts(target)
    const original = await source.exportBackup()
    const modified = await altered(original, value => {
      const p = payload(value)
      if (field === 'description') p.collections![0]!.description = 'Changed schema-valid metadata'
      if (field === 'current-and-version-key') {
        p.questions![0]!.correctOptionIds = ['B']
        p.questionVersions![0]!.correctOptionIds = ['B']
      }
      // This transforms back to the original value under Zod; hash raw input first.
      if (field === 'normalizable-metadata') p.questions![0]!.chapter = '  '
      if (field === 'exportedAt') value.exportedAt = '2026-01-01T00:00:00.000Z'
      if (field === 'image-name') p.assets![0]!.name = 'changed.png'
      if (field === 'image-bytes') p.assets![0]!.base64 = btoa('x'.repeat(image.size))
      // Metadata/key edits are valid domain data and keep all record counts unchanged.
      expect(questionSchema.safeParse(p.questions![0]).success).toBe(true)
      expect(questionSchema.safeParse(p.questionVersions![0]).success).toBe(true)
      expect(collectionSchema.safeParse(p.collections![0]).success).toBe(true)
    }, false)
    expect((await encoded(modified)).checksum).toEqual((await encoded(original)).checksum)
    await expect(target.inspectBackup(modified)).rejects.toThrow(/envelope SHA-256 mismatch/i)
    expect(await tableCounts(target)).toEqual(before)
    expect(await target.db.questions.get(retained.id)).toEqual(retained)
  })
  it.each(['missing', 'wrong-algorithm', 'malformed'] as const)('rejects %s envelope checksums', async field => {
    const source = store()
    const target = store()
    const invalid = await altered(await source.exportBackup(), value => {
      if (field === 'missing') delete value.checksum
      if (field === 'wrong-algorithm') value.checksum = { algorithm: 'MD5', value: '0'.repeat(64) }
      if (field === 'malformed') value.checksum = { algorithm: 'SHA-256', value: 'not-a-digest' }
    }, false)
    await expect(target.inspectBackup(invalid)).rejects.toThrow(StorageError)
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
  })
  it.each(['description', 'current-and-version-key'] as const)('pins the original inspected digest against consistent schema-valid %s object edits', async field => {
    const source = store()
    await source.saveQuestion(draft())
    await source.saveCollection({ name: 'Original', description: 'Original description', questionIds: [] })
    const target = store()
    const retained = await target.saveQuestion({ ...draft(), prompt: 'Keep local data' })
    const before = await tableCounts(target)
    const original = await source.exportBackup()
    for (const alsoChangePublicChecksum of [false, true]) {
      const inspection = await target.inspectBackup(original)
      const originalCounts = { ...inspection.counts }
      const data = inspection.backup.payload
      if (field === 'description') data.collections[0]!.description = 'Modified after inspection'
      else {
        data.questions[0]!.correctOptionIds = ['B']
        data.questionVersions[0]!.correctOptionIds = ['B']
      }
      expect(inspection.counts).toEqual(originalCounts)
      expect(workspaceDataSchema.safeParse(data).success).toBe(true)
      if (alsoChangePublicChecksum) {
        // This fixture has no assets, so decoded and encoded payloads are equivalent.
        inspection.backup.checksum.value = envelopeChecksum(inspection.backup as unknown as Record<string, unknown>)
      }
      await expect(target.restoreBackup(inspection)).rejects.toThrow(/SHA-256/i)
      expect(await tableCounts(target)).toEqual(before)
      expect(await target.db.questions.get(retained.id)).toEqual(retained)
    }
  })
  it.each(['name', 'encoded-bytes', 'exportedAt'] as const)('revalidates the full encoded inspection after schema-valid %s edits', async field => {
    const source = store()
    await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    await source.saveQuestion(draft())
    const target = store()
    const original = await source.exportBackup()
    const inspection = await target.inspectBackup(original)
    const originalCounts = { ...inspection.counts }
    const asset = inspection.backup.payload.assets[0]!
    if (field === 'name') asset.name = 'other.png'
    if (field === 'encoded-bytes') {
      // Same-size valid 1px PNG with a recomputed IDAT CRC and per-image SHA-256:
      // replacing white with opaque black passes all ordinary image validation.
      const other = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      asset.blob = new Blob([other], { type: 'image/png' })
      asset.sha256 = await hashBytes(other)
    }
    if (field === 'exportedAt') {
      inspection.backup.exportedAt = '2026-01-01T00:00:00.000Z'
      inspection.createdAt = inspection.backup.exportedAt
    }
    expect(inspection.counts).toEqual(originalCounts)
    expect(workspaceDataSchema.safeParse(inspection.backup.payload).success).toBe(true)
    await expect(target.restoreBackup(inspection)).rejects.toThrow(/envelope SHA-256 mismatch/i)
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
  })
  it('does not accept a cloned or caller-forged inspection even with a recalculated public digest', async () => {
    const source = store()
    await source.saveQuestion(draft())
    const target = store()
    const inspection = await target.inspectBackup(await source.exportBackup())
    await expect(target.restoreBackup({ ...inspection })).rejects.toThrow(/original validated backup inspection/i)
    const forged = structuredClone(inspection)
    forged.backup.payload.questions[0]!.correctOptionIds = ['B']
    forged.backup.payload.questionVersions[0]!.correctOptionIds = ['B']
    forged.backup.checksum.value = envelopeChecksum(forged.backup as unknown as Record<string, unknown>)
    await expect(target.restoreBackup(forged)).rejects.toThrow(/original validated backup inspection/i)
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
  })
  it('snapshots inspected records before asynchronous validation so later caller edits cannot race restore', async () => {
    const source = store()
    await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const q = await source.saveQuestion(draft())
    const hook: { duringDecode?: () => void } = {}
    const target = new WorkspaceStore(`backup-race-${crypto.randomUUID()}`, { imageDecoder: async blob => {
      hook.duringDecode?.()
      return inspectImageHeader(new Uint8Array(await blob.arrayBuffer()))
    } })
    instances.push(target)
    const inspection = await target.inspectBackup(await source.exportBackup())
    hook.duringDecode = () => {
      inspection.backup.payload.questions[0]!.correctOptionIds = ['B']
      inspection.backup.payload.questionVersions[0]!.correctOptionIds = ['B']
    }
    await target.restoreBackup(inspection)
    expect(await target.db.questions.get(q.id)).toEqual(q)
    expect(await target.db.questionVersions.get([q.id, 1])).toEqual(q)
  })
  it('rejects changing owners within an otherwise valid, re-checksummed preset family', async () => {
    const source = store()
    const first = await source.savePreset(preset)
    await source.savePreset({ ...preset, name: 'v2' }, first.id, 1)
    const original = await source.exportBackup()
    const target = store()
    const invalid = await altered(original, value => { payload(value).presets![1]!.ownerId = crypto.randomUUID() })
    await expect(target.inspectBackup(invalid)).rejects.toThrow(/same owner/i)
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
    const inspection = await target.inspectBackup(original)
    await target.restoreBackup(inspection)
    const laterOnly = await altered(original, value => {
      const rows = payload(value).presets!
      payload(value).presets = [{ ...rows[1]!, id: crypto.randomUUID(), version: 3, ownerId: crypto.randomUUID() }]
    })
    await expect(target.inspectBackup(laterOnly)).rejects.toThrow(/same owner/i)
    expect(await target.db.presets.count()).toBe(2)
  })
  it('roundtrips every record, tombstones, immutable versions, source bytes, presets and actual history', async () => {
    const source = store()
    const original = await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const first = await source.saveQuestion({ ...draft(), assets: [{ assetId: original.id, role: 'page', pageNumber: 1 }] })
    const unarchived = await source.saveQuestion({ ...draft(), prompt: 'Another question' })
    const firstPreset = await source.savePreset(preset)
    const newerPreset = await source.savePreset({ ...preset, name: 'Rules v2' }, firstPreset.id, 1)
    const history = await addActualHistory(source, first, firstPreset)
    const collection = await source.saveCollection({ name: 'Study', description: 'Keep originals', questionIds: [first.id, unarchived.id] })
    await source.saveQuestion({ ...draft(), prompt: 'Edited question', assets: [] }, first.id, 1)
    await source.archiveQuestions([first.id], { [first.id]: 2 })
    const target = store()
    const inspection = await target.inspectBackup(await source.exportBackup())
    expect(inspection.counts).toEqual({ questions: 2, collections: 1, presets: 2, history: 1, assets: 1 })
    await target.restoreBackup(inspection)
    expect(await tableCounts(target)).toEqual([2, 4, 1, 2, 1, 1])
    expect(await target.listQuestions()).toEqual([unarchived])
    expect(await target.listPresets()).toEqual([newerPreset])
    expect(await target.listHistory()).toEqual([history])
    expect(await target.db.questions.get(first.id)).toEqual(await source.db.questions.get(first.id))
    expect(await target.db.questionVersions.get([first.id, 1])).toEqual(first)
    expect(await target.db.questionVersions.get([first.id, 2])).toEqual(await source.db.questionVersions.get([first.id, 2]))
    expect((await target.db.collections.get(collection.id))?.questionIds).toEqual([unarchived.id])
    const restored = (await target.getAsset(original.id))!
    expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(png())
    expect(restored.sha256).toBe(await hashBytes(png()))
    target.db.close()
    await target.open()
    expect(await target.listHistory()).toEqual([history])
  })
  it('merges non-destructively and skips identical IDs, including source images', async () => {
    const source = store()
    const image = await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const imported = await source.saveQuestion({ ...draft(), assets: [{ assetId: image.id, role: 'page', pageNumber: 1 }] })
    const target = store()
    const own = await target.saveQuestion({ ...draft(), prompt: 'Existing workspace' })
    const inspection = await target.inspectBackup(await source.exportBackup())
    await target.restoreBackup(inspection)
    await target.restoreBackup(inspection)
    expect(await tableCounts(target)).toEqual([2, 2, 0, 0, 0, 1])
    expect(await target.db.questions.get(own.id)).toEqual(own)
    expect(await target.db.questions.get(imported.id)).toEqual(imported)
  })
  it('rejects conflicting IDs without deleting or committing unrelated incoming records', async () => {
    const source = store()
    const question = await source.saveQuestion(draft())
    const target = store()
    const firstInspection = await target.inspectBackup(await source.exportBackup())
    await target.restoreBackup(firstInspection)
    const changed = await target.saveQuestion({ ...draft(), prompt: 'Local edit to preserve' }, question.id, 1)
    await source.saveQuestion({ ...draft(), prompt: 'New incoming unrelated record' })
    // Self-contained conflicting backups remain inspectable; collisions are a restore decision.
    const inspection = await target.inspectBackup(await source.exportBackup())
    await expect(target.restoreBackup(inspection)).rejects.toThrow(ConflictError)
    expect(await target.db.questions.get(question.id)).toEqual(changed)
    expect(await tableCounts(target)).toEqual([1, 2, 0, 0, 0, 0])
  })
  it('validates incoming references against incoming plus existing records', async () => {
    const target = store()
    const existing = await target.saveQuestion(draft())
    const source = store()
    const collection = await target.saveCollection({ name: 'Shared membership', description: '', questionIds: [existing.id] })
    const serialized = await target.exportBackup()
    const partial = await altered(serialized, value => {
      const p = payload(value)
      p.questions = []; p.questionVersions = []
    })
    const inspection = await target.inspectBackup(partial)
    await target.restoreBackup(inspection)
    expect(await target.db.collections.get(collection.id)).toEqual(collection)
    await expect(source.inspectBackup(partial)).rejects.toThrow(/missing/i)
  })
  it('rejects dangling references and inconsistent revision chains before committing', async () => {
    const source = store()
    const q = await source.saveQuestion(draft())
    await source.saveCollection({ name: 'Collection', description: '', questionIds: [q.id] })
    const original = await source.exportBackup()
    const target = store()
    const cases: Array<{ change: (value: Record<string, unknown>) => void; error: RegExp }> = [
      { change: value => { payload(value).questionVersions = [] }, error: /immutable revision/i },
      { change: value => { payload(value).collections![0]!.questionIds = [crypto.randomUUID()] }, error: /missing or archived question/i },
      { change: value => { payload(value).questions![0]!.assets = [{ assetId: crypto.randomUUID(), role: 'page', pageNumber: 1 }] }, error: /missing image/i },
    ]
    for (const { change, error } of cases) {
      await expect(target.inspectBackup(await altered(original, change))).rejects.toThrow(error)
    }
    expect(await tableCounts(target)).toEqual([0, 0, 0, 0, 0, 0])
  })
  it.each(['questions', 'questionVersions', 'collections', 'presets', 'history', 'assets'])('rejects duplicate IDs in %s', async table => {
    const source = store()
    const image = await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const q = await source.saveQuestion({ ...draft(), assets: [{ assetId: image.id, role: 'page', pageNumber: 1 }] })
    const rules = await source.savePreset(preset)
    await source.saveCollection({ name: 'Collection', description: '', questionIds: [q.id] })
    await addActualHistory(source, q, rules)
    const target = store()
    const duplicate = await altered(await source.exportBackup(), value => { const rows = payload(value)[table]!; rows.push(rows[0]!) })
    await expect(target.inspectBackup(duplicate)).rejects.toThrow(/duplicate/i)
    expect(await target.db.questions.count()).toBe(0)
  })
  it('rejects future format/schema versions, unknown nested fields, invalid semantic keys and malicious prototype fields', async () => {
    const source = store()
    await source.saveQuestion(draft())
    const original = await source.exportBackup()
    const target = store()
    for (const change of [
      (value: Record<string, unknown>) => { value.version = 2 },
      (value: Record<string, unknown>) => { value.format = 'other-format' },
      (value: Record<string, unknown>) => { value.unexpected = true },
      (value: Record<string, unknown>) => { payload(value).questions![0]!.schemaVersion = 2 },
      (value: Record<string, unknown>) => { payload(value).questions![0]!.correctOptionIds = ['missing'] },
      (value: Record<string, unknown>) => { const q = payload(value).questions![0]!; const opts = q.options as Record<string, unknown>[]; opts[0]!.unexpected = true },
    ]) {
      await expect(target.inspectBackup(await altered(original, change))).rejects.toThrow(StorageError)
    }
    const json = await original.text()
    await expect(target.inspectBackup(new Blob([json.replace('{', '{"__proto__":{"polluted":true},')]))).rejects.toThrow(/unsafe/i)
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false)
    expect(await target.db.questions.count()).toBe(0)
  })
  it('rejects corrupted base64/hash and spoofed image metadata even with valid JSON', async () => {
    const source = store()
    await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const original = await source.exportBackup()
    const target = store()
    const cases: Array<{ change: (asset: Record<string, unknown>) => void; error: RegExp }> = [
      { change: asset => { asset.sha256 = '0'.repeat(64) }, error: /Image .*SHA-256 mismatch/i },
      { change: asset => { asset.base64 = '!!!!' }, error: /base64/i },
      { change: asset => { asset.base64 = (asset.base64 as string).slice(0, -4) }, error: /base64/i },
      { change: asset => { asset.width = 2 }, error: /signature\/dimensions/i },
      { change: asset => { asset.mimeType = 'image/jpeg' }, error: /signature\/dimensions/i },
      { change: asset => { asset.mimeType = 'image/svg+xml' }, error: /mimeType/i },
    ]
    for (const { change, error } of cases) {
      await expect(target.inspectBackup(await altered(original, value => change(payload(value).assets![0]!)))).rejects.toThrow(error)
    }
    expect(await target.db.assets.count()).toBe(0)
  })
  it('revalidates mutable inspections and detects tampering, prototypes, hashes and dangling refs on restore', async () => {
    const source = store()
    const q = await source.saveQuestion(draft())
    const target = store()
    const backup = await source.exportBackup()
    const changedKey = await target.inspectBackup(backup)
    changedKey.backup.payload.questions[0]!.correctOptionIds = ['missing']
    await expect(target.restoreBackup(changedKey)).rejects.toThrow(StorageError)
    const changedCounts = await target.inspectBackup(backup)
    changedCounts.counts.questions++
    await expect(target.restoreBackup(changedCounts)).rejects.toThrow(/counts/i)
    const changedRefs = await target.inspectBackup(backup)
    changedRefs.backup.payload.questions[0]!.assets = [{ assetId: crypto.randomUUID(), role: 'page', pageNumber: 1 }]
    changedRefs.backup.payload.questionVersions[0]!.assets = changedRefs.backup.payload.questions[0]!.assets
    await expect(target.restoreBackup(changedRefs)).rejects.toThrow(/envelope SHA-256/i)
    const prototype = await target.inspectBackup(backup)
    Object.setPrototypeOf(prototype.backup.payload.questions[0]!, { malicious: true })
    await expect(target.restoreBackup(prototype)).rejects.toThrow(/prototype/i)
    const unsafeGetter = await target.inspectBackup(backup)
    Object.defineProperty(unsafeGetter, 'counts', { enumerable: true, get: () => { throw new Error('must not execute getter') } })
    await expect(target.restoreBackup(unsafeGetter)).rejects.toThrow(/unsafe/i)
    expect(await target.db.questions.get(q.id)).toBeUndefined()
    await source.addImage(new File([png()], 'source.png', { type: 'image/png' }), 'page')
    const corruptAsset = await target.inspectBackup(await source.exportBackup())
    corruptAsset.backup.payload.assets[0]!.sha256 = 'f'.repeat(64)
    await expect(target.restoreBackup(corruptAsset)).rejects.toThrow(/SHA-256/i)
    expect(await target.db.assets.count()).toBe(0)
  })
  it('rolls back ALL tables on a late simulated quota failure', async () => {
    const source = store()
    const asset = await source.addImage(new File([png()], 'original.png', { type: 'image/png' }), 'page')
    const q = await source.saveQuestion({ ...draft(), assets: [{ assetId: asset.id, role: 'page', pageNumber: 1 }] })
    const rules = await source.savePreset(preset)
    await source.saveCollection({ name: 'Study', description: '', questionIds: [q.id] })
    await addActualHistory(source, q, rules)
    const target = store()
    const existing = await target.saveQuestion({ ...draft(), prompt: 'Keep this' })
    const inspection = await target.inspectBackup(await source.exportBackup())
    vi.spyOn(target.db.assets, 'bulkAdd').mockRejectedValueOnce(new DOMException('quota exceeded', 'QuotaExceededError'))
    await expect(target.restoreBackup(inspection)).rejects.toThrow(/quota/i)
    expect(await tableCounts(target)).toEqual([1, 1, 0, 0, 0, 0])
    expect(await target.db.questions.get(existing.id)).toEqual(existing)
  })
  it('rejects malformed JSON/UTF-8 and file size limits before parsing', async () => {
    const target = store()
    for (const file of [new Blob([]), new Blob(['not-json']), new Blob([Uint8Array.of(0xff, 0xfe)]), new Blob(['{}'])]) {
      await expect(target.inspectBackup(file)).rejects.toThrow(StorageError)
    }
    const oversized = new Blob(['{}'])
    Object.defineProperty(oversized, 'size', { value: MAX_BACKUP_BYTES + 1 })
    await expect(target.inspectBackup(oversized)).rejects.toThrow(/75 MiB/i)
  })
  it('rejects mutably forged unsupported inspection envelope fields', async () => {
    const source = store()
    const target = store()
    const inspection = await target.inspectBackup(await source.exportBackup())
    const future = { ...inspection, backup: { ...inspection.backup, version: 2 } } as unknown as BackupInspection
    await expect(target.restoreBackup(future)).rejects.toThrow(StorageError)
    await expect(target.restoreBackup({ ...inspection, extra: true } as BackupInspection)).rejects.toThrow(StorageError)
  })
  it('refuses to export inconsistent snapshots rather than producing a dangling backup', async () => {
    const source = store()
    await source.saveQuestion(draft())
    await source.db.questionVersions.clear() // Deliberate corruption in isolated test only.
    await expect(source.exportBackup()).rejects.toThrow(/immutable revision|budget counters/i)
    expect(await source.db.questions.count()).toBe(1)
  })
})
