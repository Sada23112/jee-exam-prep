import { z } from 'zod'
import type { IndexableType } from 'dexie'
import { questionSchema } from '../../modules/question-bank/domain/question'
import type { Question } from '../../modules/question-bank/domain/question'
import { collectionSchema } from '../../modules/question-bank/domain/collection'
import type { QuestionCollection } from '../../modules/question-bank/domain/collection'
import { presetSchema } from '../../modules/exam-engine/domain/preset'
import type { ExamPreset } from '../../modules/exam-engine/domain/preset'
import { historySchema } from '../../modules/results/domain/history'
import type { ExamHistoryRecord } from '../../modules/results/domain/history'
import { assetSchema, isNativeBlob } from './assets'
import type { AssetRecord } from './assets'
import { StorageError } from './errors'
import type { WorkspaceDatabase, WorkspaceMetadata } from './database'
import { assertWorkspaceBudget, DATA_TABLES, DEFAULT_STORAGE_LIMITS, MAX_DATA_NODES, MAX_RECORDS_PER_TABLE, validateWorkspaceBudget, workspaceMetadataSchema } from './budget'
import type { DataTable, StorageLimits } from './budget'

export { DATA_TABLES, MAX_RECORDS_PER_TABLE } from './budget'
export interface WorkspaceData {
  questions: Question[]
  questionVersions: Question[]
  collections: QuestionCollection[]
  presets: ExamPreset[]
  history: ExamHistoryRecord[]
  assets: AssetRecord[]
}
const tableSchemas = { questions: questionSchema, questionVersions: questionSchema, collections: collectionSchema, presets: presetSchema, history: historySchema, assets: assetSchema }
export const workspaceDataSchema = z.object({
  questions: z.array(questionSchema).max(MAX_RECORDS_PER_TABLE),
  questionVersions: z.array(questionSchema).max(MAX_RECORDS_PER_TABLE),
  collections: z.array(collectionSchema).max(MAX_RECORDS_PER_TABLE),
  presets: z.array(presetSchema).max(MAX_RECORDS_PER_TABLE),
  history: z.array(historySchema).max(MAX_RECORDS_PER_TABLE),
  assets: z.array(assetSchema).max(MAX_RECORDS_PER_TABLE),
}).strict()
type WorkspaceRow<K extends DataTable> = WorkspaceData[K][number]

/** Reject getters, inherited/prototype fields and excessive object graphs before Zod/serialization. */
export function assertPlainData(value: unknown, allowBlobs = false): void {
  let nodes = 0
  const active = new WeakSet<object>()
  const walk = (current: unknown, depth: number): void => {
    if (++nodes > MAX_DATA_NODES || depth > 40) throw new StorageError('Data is too deeply nested or contains too many values.')
    if (current === null || typeof current !== 'object') {
      if (!['string', 'number', 'boolean', 'object'].includes(typeof current) || (typeof current === 'number' && !Number.isFinite(current))) {
        throw new StorageError('Data contains unsupported values.')
      }
      return
    }
    if (allowBlobs && current instanceof Blob) {
      if (!isNativeBlob(current)) throw new StorageError('Image Blobs must not contain custom prototypes or overridden properties.')
      return
    }
    if (active.has(current)) throw new StorageError('Cyclic data is not supported.')
    active.add(current)
    const prototype = Object.getPrototypeOf(current)
    if (!(Array.isArray(current) ? prototype === Array.prototype : prototype === Object.prototype || prototype === null)) {
      throw new StorageError('Data must contain only plain objects and arrays, not custom prototypes.')
    }
    const descriptors = Object.getOwnPropertyDescriptors(current)
    if (Object.getOwnPropertySymbols(current).length) throw new StorageError('Symbol fields are not supported.')
    if (Array.isArray(current)) {
      if (current.length > MAX_RECORDS_PER_TABLE) throw new StorageError('Array exceeds the maximum record count.')
      if (Object.keys(current).length !== current.length) throw new StorageError('Sparse arrays or extra array properties are not supported.')
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current) && key === 'length') continue
      if (['__proto__', 'prototype', 'constructor'].includes(key) || !('value' in descriptor) || !descriptor.enumerable) {
        throw new StorageError(`Unsafe or unexpected field: ${key}.`)
      }
      walk(descriptor.value, depth + 1)
    }
    active.delete(current)
  }
  walk(value, 0)
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}
export function recordEqual(left: unknown, right: unknown): boolean { return canonical(left) === canonical(right) }
export function assetEqual(left: AssetRecord, right: AssetRecord): boolean {
  const { blob: leftBlob, ...leftMetadata } = left
  const { blob: rightBlob, ...rightMetadata } = right
  return leftBlob.size === rightBlob.size && leftBlob.type === rightBlob.type && recordEqual(leftMetadata, rightMetadata)
}
export function versionKey(question: Question): string { return `${question.id}:${question.revision}` }
export function assertNoDuplicates(data: WorkspaceData): void {
  for (const table of DATA_TABLES) {
    const keys = table === 'questionVersions' ? data.questionVersions.map(versionKey) : data[table].map(record => record.id)
    if (new Set(keys).size !== keys.length) throw new StorageError(`Duplicate IDs in ${table}.`)
  }
  const families = data.presets.map(preset => `${preset.familyId}:${preset.version}`)
  if (new Set(families).size !== families.length) throw new StorageError('Duplicate preset family/version identities.')
}
export function parseWorkspaceData(value: unknown): WorkspaceData {
  assertPlainData(value, true)
  const data = workspaceDataSchema.parse(value)
  assertNoDuplicates(data)
  return data
}

/** Every relevant transaction checks the marker, including transactions after initial open. */
export async function validateSchemaMarker(db: WorkspaceDatabase): Promise<WorkspaceMetadata> {
  if (await db.metadata.count() !== 1) throw new StorageError('Workspace schema marker is missing or malformed; no data was cleared.')
  const marker: unknown = await db.metadata.get('schema')
  if (marker === undefined) throw new StorageError('Workspace schema marker is missing or malformed; no data was cleared.')
  assertPlainData(marker)
  // A future explicit migration must update this reader along with preflight/layout/upgrade.
  const parsed = workspaceMetadataSchema.parse(marker)
  assertWorkspaceBudget(parsed.budget)
  return parsed
}
export async function assertTableCapacity(db: WorkspaceDatabase, table: DataTable, additions = 0): Promise<void> {
  if (await db.table(table).count() + additions > MAX_RECORDS_PER_TABLE) {
    throw new StorageError(`Workspace ${table} exceeds the ${MAX_RECORDS_PER_TABLE} record limit.`)
  }
}
export function parseTableRows<K extends DataTable>(table: K, value: unknown): WorkspaceData[K] {
  assertPlainData(value, true)
  return z.array(tableSchemas[table]).max(MAX_RECORDS_PER_TABLE).parse(value) as WorkspaceData[K]
}
function parseStoredRow<K extends DataTable>(table: K, value: unknown): WorkspaceRow<K> {
  assertPlainData(value, true)
  return tableSchemas[table].parse(value) as WorkspaceRow<K>
}
/** Scoped reads validate persisted values, never merely trust Dexie's static row types. */
export async function readTable<K extends DataTable>(db: WorkspaceDatabase, table: K): Promise<WorkspaceData[K]> {
  await assertTableCapacity(db, table)
  return parseTableRows(table, await db.table(table).toArray())
}
export async function readRow<K extends DataTable>(db: WorkspaceDatabase, table: K, key: IndexableType): Promise<WorkspaceRow<K> | undefined> {
  const value: unknown = await db.table(table).get(key)
  return value === undefined ? undefined : parseStoredRow(table, value)
}
export async function readRows<K extends DataTable>(db: WorkspaceDatabase, table: K, keys: IndexableType[]): Promise<Array<WorkspaceRow<K> | undefined>> {
  if (!keys.length) return []
  const values: unknown[] = await db.table(table).bulkGet(keys)
  return values.map(value => value === undefined ? undefined : parseStoredRow(table, value))
}

/** Full snapshots are reserved for startup, export, backup inspection dependencies and restore. */
export async function readData(db: WorkspaceDatabase, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): Promise<WorkspaceData> {
  const marker = await validateSchemaMarker(db)
  await Promise.all(DATA_TABLES.map(table => assertTableCapacity(db, table)))
  const [questions, questionVersions, collections, presets, history, assets] = await Promise.all([
    db.questions.toArray(), db.questionVersions.toArray(), db.collections.toArray(),
    db.presets.toArray(), db.history.toArray(), db.assets.toArray(),
  ])
  const data = parseWorkspaceData({ questions, questionVersions, collections, presets, history, assets })
  validateWorkspaceBudget(data, marker.budget, limits)
  return data
}

export function validateQuestionAssets(questions: Question[], assets: AssetRecord[]): void {
  checkQuestionAssets(questions, new Map(assets.map(asset => [asset.id, asset])))
}
function checkQuestionAssets(questions: Question[], byId: ReadonlyMap<string, AssetRecord>): void {
  for (const question of questions) {
    for (const reference of question.assets) {
      const asset = byId.get(reference.assetId)
      if (!asset) throw new StorageError('Question ' + question.id + ' references missing image ' + reference.assetId + '.')
      if (asset.role !== reference.role) throw new StorageError('Question ' + question.id + ' image role does not match the preserved source image.')
    }
  }
}
export function validateCollectionQuestions(collections: QuestionCollection[], questions: Question[]): void {
  const byId = new Map(questions.map(question => [question.id, question]))
  for (const collection of collections) {
    for (const id of collection.questionIds) {
      const question = byId.get(id)
      if (!question || (collection.deletedAt === null && question.deletedAt !== null)) {
        throw new StorageError(`Collection ${collection.name} references a missing or archived question.`)
      }
    }
  }
}
export function validatePresetFamilies(presets: ExamPreset[]): void {
  const families = new Map<string, ExamPreset[]>()
  for (const preset of presets) {
    const family = families.get(preset.familyId) ?? []
    family.push(preset)
    families.set(preset.familyId, family)
  }
  for (const family of families.values()) {
    family.sort((left, right) => left.version - right.version)
    family.forEach((preset, index) => {
      if (preset.ownerId !== family[0]!.ownerId) throw new StorageError(`Preset family ${preset.familyId} must preserve the same owner across all versions.`)
      if (preset.version !== index + 1 || (index > 0 && Date.parse(preset.createdAt) < Date.parse(family[index - 1]!.createdAt))) {
        throw new StorageError(`Preset family ${preset.familyId} has a missing or unordered version.`)
      }
    })
  }
}

export function validateReferences(data: WorkspaceData): void {
  for (const table of DATA_TABLES) {
    if (data[table].length > MAX_RECORDS_PER_TABLE) throw new StorageError(`Workspace ${table} exceeds the ${MAX_RECORDS_PER_TABLE} record limit.`)
  }
  assertNoDuplicates(data)
  const questions = new Map(data.questions.map(question => [question.id, question]))
  const versions = new Map(data.questionVersions.map(question => [versionKey(question), question]))
  const assets = new Map(data.assets.map(asset => [asset.id, asset]))
  const presets = new Map(data.presets.map(preset => [preset.id, preset]))
  function fail(message: string): never { throw new StorageError(message) }
  checkQuestionAssets(data.questions, assets)
  checkQuestionAssets(data.questionVersions, assets)
  for (const question of data.questions) {
    const latest = versions.get(versionKey(question))
    if (!latest || !recordEqual(latest, question)) fail(`Question ${question.id} has a missing or inconsistent immutable revision.`)
  }
  const byQuestion = new Map<string, Question[]>()
  for (const version of data.questionVersions) {
    const current = questions.get(version.id)
    if (!current || version.revision > current.revision || version.createdAt !== current.createdAt || version.ownerId !== current.ownerId) {
      fail(`Question revision ${versionKey(version)} has no consistent current question.`)
    }
    const chain = byQuestion.get(version.id) ?? []
    chain.push(version)
    byQuestion.set(version.id, chain)
  }
  for (const [id, chain] of byQuestion) {
    chain.sort((left, right) => left.revision - right.revision)
    let lastUpdated = Number.NEGATIVE_INFINITY
    let archived = false
    chain.forEach((version, index) => {
      if (version.revision !== index + 1 || Date.parse(version.updatedAt) < lastUpdated || archived) fail(`Question ${id} has an incomplete or inconsistent revision chain.`)
      lastUpdated = Date.parse(version.updatedAt)
      archived = version.deletedAt !== null
    })
  }
  validateCollectionQuestions(data.collections, data.questions)
  validatePresetFamilies(data.presets)
  for (const attempt of data.history) {
    if (!recordEqual(presets.get(attempt.presetSnapshot.id), attempt.presetSnapshot)) fail(`History ${attempt.name} has a missing or inconsistent preset snapshot.`)
    checkQuestionAssets(attempt.questionSnapshots, assets)
    for (const snapshot of attempt.questionSnapshots) {
      if (!recordEqual(versions.get(versionKey(snapshot)), snapshot)) fail(`History ${attempt.name} has a missing or inconsistent question revision snapshot.`)
    }
  }
}

/** Incoming rows take precedence only for reference inspection; restore separately rejects collisions. */
export function referenceUnion(existing: WorkspaceData, incoming: WorkspaceData): WorkspaceData {
  const merge = <T>(left: T[], right: T[], key: (row: T) => string): T[] => Array.from(new Map([...left, ...right].map(row => [key(row), row])).values())
  return {
    questions: merge(existing.questions, incoming.questions, row => row.id),
    questionVersions: merge(existing.questionVersions, incoming.questionVersions, versionKey),
    collections: merge(existing.collections, incoming.collections, row => row.id),
    presets: merge(existing.presets, incoming.presets, row => row.id),
    history: merge(existing.history, incoming.history, row => row.id),
    assets: merge(existing.assets, incoming.assets, row => row.id),
  }
}
