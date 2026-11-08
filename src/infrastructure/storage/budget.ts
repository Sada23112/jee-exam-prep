import { z } from 'zod'
import { StorageError } from './errors'
import type { AssetRecord } from './assets'
import type { WorkspaceData } from './validation'
import type { WorkspaceDatabase, WorkspaceMetadata } from './database'

export const MAX_BACKUP_BYTES = 75 * 1024 * 1024
export const MAX_BACKUP_IMAGE_BYTES = 55 * 1024 * 1024
export const MAX_RECORDS_PER_TABLE = 100_000
export const MAX_DATA_NODES = 2_000_000
export const DATA_TABLES = ['questions', 'questionVersions', 'collections', 'presets', 'history', 'assets'] as const
export type DataTable = typeof DATA_TABLES[number]

export interface StorageLimits {
  maxBackupBytes: number
  maxImageBytes: number
  maxDataNodes: number
}
export const DEFAULT_STORAGE_LIMITS: Readonly<StorageLimits> = Object.freeze({
  maxBackupBytes: MAX_BACKUP_BYTES, maxImageBytes: MAX_BACKUP_IMAGE_BYTES, maxDataNodes: MAX_DATA_NODES,
})
/** Test/platform adapters may lower limits, but can never raise the supported format limits. */
export function storageLimits(overrides: Partial<StorageLimits> = {}): Readonly<StorageLimits> {
  const limits = { ...DEFAULT_STORAGE_LIMITS, ...overrides }
  for (const key of Object.keys(DEFAULT_STORAGE_LIMITS) as Array<keyof StorageLimits>) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > DEFAULT_STORAGE_LIMITS[key]) {
      throw new StorageError(`Invalid workspace ${key} limit.`)
    }
  }
  return Object.freeze(limits)
}

const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const workspaceBudgetSchema = z.object({
  revision: counter,
  encodedBytes: counter,
  imageBytes: counter,
  nodes: counter,
  counts: z.object({ questions: counter, questionVersions: counter, collections: counter, presets: counter, history: counter, assets: counter }).strict(),
}).strict()
export type WorkspaceBudget = z.infer<typeof workspaceBudgetSchema>
export const workspaceMetadataSchema = z.object({ key: z.literal('schema'), version: z.literal(1), budget: workspaceBudgetSchema }).strict()

/** Exact JSON.stringify UTF-8 accounting, without allocating the serialized string.
 * Inputs must be validated plain JSON. Lone surrogates use JSON's six-byte escape;
 * paired surrogates use four UTF-8 bytes. Object order does not affect the result.
 */
export function estimateJsonUtf8(value: unknown, maxBytes = Number.MAX_SAFE_INTEGER): { bytes: number; nodes: number } {
  let bytes = 0
  let nodes = 0
  const add = (amount: number): void => {
    bytes += amount
    if (!Number.isSafeInteger(bytes) || bytes > maxBytes) throw new StorageError('Backup exceeds the encoded size limit (75 MiB maximum).')
  }
  const string = (text: string): void => {
    // Every UTF-16 code unit needs at least one encoded byte; fail fast on huge strings.
    if (text.length > maxBytes - bytes) throw new StorageError('Backup exceeds the encoded size limit (75 MiB maximum).')
    add(2)
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index)
      if (code === 34 || code === 92) add(2)
      else if (code < 32) add(code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6)
      else if (code < 128) add(1)
      else if (code < 2048) add(2)
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1)
        if (next >= 0xdc00 && next <= 0xdfff) { add(4); index++ } else add(6)
      } else add(code >= 0xdc00 && code <= 0xdfff ? 6 : 3)
    }
  }
  const walk = (current: unknown): void => {
    nodes++
    if (Array.isArray(current)) {
      add(2 + Math.max(0, current.length - 1))
      for (const item of current) walk(item)
    } else if (current !== null && typeof current === 'object') {
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) throw new StorageError('Only plain JSON values can be estimated; images require encoded asset accounting.')
      const entries = Object.entries(current)
      add(2 + Math.max(0, entries.length - 1))
      for (const [key, item] of entries) { string(key); add(1); walk(item) }
    } else if (typeof current === 'string') string(current)
    else {
      if (current !== null && typeof current !== 'boolean' && (typeof current !== 'number' || !Number.isFinite(current))) throw new StorageError('Backup contains unsupported values.')
      add(JSON.stringify(current).length)
    }
  }
  walk(value)
  return { bytes, nodes }
}

const EMPTY_PAYLOAD: WorkspaceData = { questions: [], questionVersions: [], collections: [], presets: [], history: [], assets: [] }
// Reserve the largest ISO timestamp emitted by Date.toISOString (27 bytes), not
// just today's 24-byte timestamp. This is the ONLY encoded-byte headroom: 3 bytes
// for ordinary dates. Checksums always have exactly 64 lowercase hexadecimal bytes.
const RESERVED_TIMESTAMP = '+010000-01-01T00:00:00.000Z'
const EMPTY_ENVELOPE = {
  format: 'jee-cbt-backup', version: 1, exportedAt: RESERVED_TIMESTAMP,
  checksum: { algorithm: 'SHA-256', value: '0'.repeat(64) }, payload: EMPTY_PAYLOAD,
}
const BASE = estimateJsonUtf8(EMPTY_ENVELOPE)
// assertPlainData also checks the public inspection wrapper: root + counts object
// + five counters + createdAt = eight additional nodes beyond the backup envelope.
export const INSPECTION_NODE_HEADROOM = 8

function estimateAsset(asset: AssetRecord): { bytes: number; nodes: number } {
  const { blob, ...metadata } = asset
  if (blob.size !== asset.size || blob.type !== asset.mimeType) throw new StorageError('Image size/type does not match metadata during budget accounting.')
  const measured = estimateJsonUtf8(metadata)
  // Add comma, "base64":, quotes and canonical base64. No encoding/crypto/decoding
  // in a transaction; immutable Blob metadata is enough to account for every byte.
  return { bytes: measured.bytes + 12 + 4 * Math.ceil(asset.size / 3), nodes: measured.nodes + 1 }
}
function estimateRow(table: DataTable, row: WorkspaceData[DataTable][number]): { bytes: number; nodes: number } {
  return table === 'assets' ? estimateAsset(row as AssetRecord) : estimateJsonUtf8(row)
}

export function calculateWorkspaceBudget(data: WorkspaceData = EMPTY_PAYLOAD, revision = 0): WorkspaceBudget {
  const budget: WorkspaceBudget = {
    revision, encodedBytes: BASE.bytes, imageBytes: 0, nodes: BASE.nodes,
    counts: { questions: 0, questionVersions: 0, collections: 0, presets: 0, history: 0, assets: 0 },
  }
  for (const table of DATA_TABLES) {
    budget.counts[table] = data[table].length
    budget.encodedBytes += Math.max(0, data[table].length - 1)
    for (const row of data[table]) {
      const measured = estimateRow(table, row)
      budget.encodedBytes += measured.bytes
      budget.nodes += measured.nodes
    }
  }
  budget.imageBytes = data.assets.reduce((total, asset) => total + asset.size, 0)
  return budget
}

/** Exact compact encoded envelope size, including header/checksum and base64 metadata. */
export function estimateBackupEnvelopeBytes(data: WorkspaceData, exportedAt: string, checksum = { algorithm: 'SHA-256', value: '0'.repeat(64) }): number {
  const budget = calculateWorkspaceBudget(data)
  const actualBase = estimateJsonUtf8({ ...EMPTY_ENVELOPE, exportedAt, checksum }).bytes
  return budget.encodedBytes - BASE.bytes + actualBase
}

export function assertWorkspaceBudget(budget: WorkspaceBudget, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): void {
  workspaceBudgetSchema.parse(budget)
  if (budget.encodedBytes < BASE.bytes || budget.nodes < BASE.nodes) throw new StorageError('Workspace budget counters are inconsistent; no data was cleared.')
  if (budget.encodedBytes > limits.maxBackupBytes) throw new StorageError('Workspace exceeds the encoded backup size limit (75 MiB maximum). Preserve existing data and use a separate workspace; no data was changed.')
  if (budget.imageBytes > limits.maxImageBytes) throw new StorageError('Workspace images exceed the decoded image limit (55 MiB maximum); no original images were removed.')
  if (budget.nodes + INSPECTION_NODE_HEADROOM > limits.maxDataNodes) throw new StorageError('Workspace exceeds the backup value-count limit; no data was changed.')
  for (const table of DATA_TABLES) {
    if (budget.counts[table] > MAX_RECORDS_PER_TABLE) throw new StorageError(`Workspace ${table} exceeds the ${MAX_RECORDS_PER_TABLE} record limit.`)
  }
}

export function validateWorkspaceBudget(data: WorkspaceData, stored: WorkspaceBudget, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): void {
  const actual = calculateWorkspaceBudget(data, stored.revision)
  assertWorkspaceBudget(actual, limits)
  if (actual.encodedBytes !== stored.encodedBytes || actual.imageBytes !== stored.imageBytes || actual.nodes !== stored.nodes || DATA_TABLES.some(table => actual.counts[table] !== stored.counts[table])) {
    throw new StorageError('Workspace budget counters do not match stored records; no data was cleared. Use an explicit compatible repair/migration.')
  }
}

type BudgetChanges = { [K in DataTable]?: { before?: WorkspaceData[K]; after?: WorkspaceData[K] } }
/** Transactional CAS: the caller reads the latest marker INSIDE the same scoped
 * readwrite transaction. IndexedDB serializes its metadata write lock across tabs;
 * there is no cached capacity or second transaction that could lose an update.
 * Both counters and data roll back together, even on a later quota/constraint error.
 */
export async function updateWorkspaceBudget(db: WorkspaceDatabase, marker: WorkspaceMetadata, changes: BudgetChanges, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): Promise<void> {
  const budget: WorkspaceBudget = { ...marker.budget, revision: marker.budget.revision + 1, counts: { ...marker.budget.counts } }
  for (const table of DATA_TABLES) {
    const change = changes[table]
    if (!change) continue
    const before = change.before ?? []
    const after = change.after ?? []
    const previousCount = budget.counts[table]
    budget.counts[table] += after.length - before.length
    budget.encodedBytes += Math.max(0, budget.counts[table] - 1) - Math.max(0, previousCount - 1)
    for (const [rows, sign] of [[before, -1], [after, 1]] as const) {
      for (const row of rows) {
        const measured = estimateRow(table, row)
        budget.encodedBytes += sign * measured.bytes
        budget.nodes += sign * measured.nodes
        if (table === 'assets') budget.imageBytes += sign * (row as AssetRecord).size
      }
    }
  }
  assertWorkspaceBudget(budget, limits)
  await db.metadata.put({ ...marker, budget })
}
