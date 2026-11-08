import { z } from 'zod'
import { timestampSchema } from '../../modules/question-bank/domain/common'
import { questionSchema } from '../../modules/question-bank/domain/question'
import { collectionSchema } from '../../modules/question-bank/domain/collection'
import { presetSchema } from '../../modules/exam-engine/domain/preset'
import { historySchema } from '../../modules/results/domain/history'
import { assetMetadataShape, blobBytes, hashBytes, validateAsset } from './assets'
import type { AssetRecord, ImageDecoder } from './assets'
import { StorageError } from './errors'
import { assertPlainData, canonical, MAX_RECORDS_PER_TABLE, parseWorkspaceData, recordEqual, validateReferences } from './validation'
import type { WorkspaceData } from './validation'
import { assertWorkspaceBudget, calculateWorkspaceBudget, DEFAULT_STORAGE_LIMITS, estimateBackupEnvelopeBytes, estimateJsonUtf8, storageLimits } from './budget'
import type { StorageLimits } from './budget'

export { MAX_BACKUP_BYTES, MAX_BACKUP_IMAGE_BYTES } from './budget'
const MAX_BASE64_LENGTH = 4 * Math.ceil((10 * 1024 * 1024) / 3)
const encodedAssetSchema = z.object({ ...assetMetadataShape, base64: z.string().min(4).max(MAX_BASE64_LENGTH) }).strict()
const checksumSchema = z.object({ algorithm: z.literal('SHA-256'), value: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const envelopeShape = {
  format: z.literal('jee-cbt-backup'), version: z.literal(1), exportedAt: timestampSchema, checksum: checksumSchema,
}
const backupSchema = z.object({
  ...envelopeShape,
  payload: z.object({
    questions: z.array(questionSchema).max(MAX_RECORDS_PER_TABLE),
    questionVersions: z.array(questionSchema).max(MAX_RECORDS_PER_TABLE),
    collections: z.array(collectionSchema).max(MAX_RECORDS_PER_TABLE),
    presets: z.array(presetSchema).max(MAX_RECORDS_PER_TABLE),
    history: z.array(historySchema).max(MAX_RECORDS_PER_TABLE),
    assets: z.array(encodedAssetSchema).max(MAX_RECORDS_PER_TABLE),
  }).strict(),
}).strict()

export interface BackupChecksum { algorithm: 'SHA-256'; value: string }
export interface DecodedBackup {
  format: 'jee-cbt-backup'
  version: 1
  exportedAt: string
  checksum: BackupChecksum
  payload: WorkspaceData
}
export interface BackupInspection {
  /** Use the original returned inspection, not a clone. Restore revalidates all mutable data. */
  backup: DecodedBackup
  counts: { questions: number; collections: number; presets: number; history: number; assets: number }
  createdAt: string
}
const decodedBackupSchema = z.object({ ...envelopeShape, payload: z.unknown() }).strict()
const inspectionSchema = z.object({
  backup: decodedBackupSchema,
  counts: z.object({ questions: z.number().int().min(0), collections: z.number().int().min(0), presets: z.number().int().min(0), history: z.number().int().min(0), assets: z.number().int().min(0) }).strict(),
  createdAt: timestampSchema,
}).strict()
// Neither a mutable public checksum nor a caller-created inspection can replace this binding.
const inspectedChecksums = new WeakMap<BackupInspection, string>()

/**
 * SHA-256 covers canonical UTF-8 JSON of { format, version, exportedAt, payload },
 * including every record, tombstone, immutable snapshot and encoded image byte.
 * Object keys are sorted recursively; array order and authored strings are preserved.
 * The checksum field itself is excluded. This unkeyed digest detects corruption,
 * NOT authenticity: anyone can edit a file and recompute its checksum.
 */
async function envelopeDigest(envelope: { format: string; version: number; exportedAt: string; payload: unknown }): Promise<string> {
  const { format, version, exportedAt, payload } = envelope
  return hashBytes(new TextEncoder().encode(canonical({ format, version, exportedAt, payload })))
}

/** Bound the encoded envelope, never the decoded inspection wrapper. */
function assertBackupSize(value: unknown, limits: Readonly<StorageLimits>): void {
  estimateJsonUtf8(value, limits.maxBackupBytes)
}

function counts(data: WorkspaceData): BackupInspection['counts'] {
  return { questions: data.questions.length, collections: data.collections.length, presets: data.presets.length, history: data.history.length, assets: data.assets.length }
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 16_384) binary += String.fromCharCode(...bytes.subarray(start, start + 16_384))
  return btoa(binary)
}
function decodeBase64(value: string, size: number): Uint8Array<ArrayBuffer> {
  if (value.length !== 4 * Math.ceil(size / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new StorageError('Corrupt or non-canonical image base64 encoding.')
  }
  let binary: string
  try { binary = atob(value) } catch { throw new StorageError('Corrupt image base64 encoding.') }
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  if (bytes.length !== size || encodeBase64(bytes) !== value) throw new StorageError('Image base64 size/padding is inconsistent.')
  return bytes
}
async function encodePayload(data: WorkspaceData): Promise<z.infer<typeof backupSchema>['payload']> {
  const assets = []
  for (const asset of data.assets) {
    const { blob, ...metadata } = asset
    assets.push({ ...metadata, base64: encodeBase64(await blobBytes(blob)) })
  }
  return { ...data, assets }
}
function assertAggregateImageLimit(data: { assets: Array<{ size: number }> }, limits: Readonly<StorageLimits>): void {
  if (data.assets.reduce((total, asset) => total + asset.size, 0) > limits.maxImageBytes) {
    throw new StorageError('Backup images exceed the 55 MiB decoded image limit; the full backup limit is 75 MiB.')
  }
}
async function validateAllImages(data: WorkspaceData, decoder: ImageDecoder, limits: Readonly<StorageLimits>): Promise<void> {
  assertWorkspaceBudget(calculateWorkspaceBudget(data), limits)
  // Sequential decoding bounds peak pixel memory rather than decoding all 40M-pixel images together.
  for (const asset of data.assets) await validateAsset(asset, decoder)
}

export async function createBackup(data: WorkspaceData, decoder: ImageDecoder, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): Promise<Blob> {
  limits = storageLimits(limits)
  data = parseWorkspaceData(data)
  validateReferences(data)
  const header = { format: 'jee-cbt-backup' as const, version: 1 as const, exportedAt: new Date().toISOString() }
  await validateAllImages(data, decoder, limits)
  const envelope = { ...header, payload: await encodePayload(data) }
  const backup = backupSchema.parse({ ...envelope, checksum: { algorithm: 'SHA-256', value: await envelopeDigest(envelope) } })
  assertBackupSize(backup, limits)
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' })
  if (blob.size > limits.maxBackupBytes) throw new StorageError('Workspace exceeds the 75 MiB backup limit; no incomplete backup was exported.')
  return blob
}

export async function inspectBackupFile(file: File | Blob, decoder: ImageDecoder, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): Promise<BackupInspection> {
  limits = storageLimits(limits)
  if (!(file instanceof Blob) || file.size < 1 || file.size > limits.maxBackupBytes) throw new StorageError('Backup must be a non-empty JSON file no larger than 75 MiB.')
  let raw: unknown
  try {
    const bytes = await blobBytes(file)
    if (bytes.length !== file.size || bytes.length > limits.maxBackupBytes) throw new StorageError('Actual backup byte length exceeds its declared size or the 75 MiB limit.')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    raw = JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof StorageError) throw error
    throw new StorageError('Backup is not valid UTF-8 JSON.')
  }
  assertPlainData(raw)
  // Validate the complete original encoded envelope before domain schemas can normalize metadata.
  const envelope = decodedBackupSchema.parse(raw)
  if (await envelopeDigest(envelope) !== envelope.checksum.value) throw new StorageError('Backup envelope SHA-256 mismatch; backup data is corrupt.')
  const encoded = backupSchema.parse(envelope)
  if (await envelopeDigest(encoded) !== envelope.checksum.value) throw new StorageError('Backup metadata is not canonical; export the backup again.')
  assertAggregateImageLimit(encoded.payload, limits)
  const assets: AssetRecord[] = []
  for (const encodedAsset of encoded.payload.assets) {
    const { base64, ...metadata } = encodedAsset
    assets.push({ ...metadata, blob: new Blob([decodeBase64(base64, metadata.size)], { type: metadata.mimeType }) })
  }
  const data = parseWorkspaceData({ ...encoded.payload, assets })
  await validateAllImages(data, decoder, limits)
  const inspection: BackupInspection = {
    backup: { format: encoded.format, version: encoded.version, exportedAt: encoded.exportedAt, checksum: encoded.checksum, payload: data },
    counts: counts(data), createdAt: encoded.exportedAt,
  }
  inspectedChecksums.set(inspection, encoded.checksum.value)
  return inspection
}

/** Validate and snapshot a caller-mutated inspection BEFORE any write transaction. */
export async function revalidateInspection(value: BackupInspection, decoder: ImageDecoder, limits: Readonly<StorageLimits> = DEFAULT_STORAGE_LIMITS): Promise<DecodedBackup> {
  limits = storageLimits(limits)
  assertPlainData(value, true)
  const inspection = inspectionSchema.parse(value)
  const originalChecksum = inspectedChecksums.get(value)
  if (originalChecksum === undefined) throw new StorageError('Use the original validated backup inspection; inspect the backup again.')
  if (inspection.backup.checksum.value !== originalChecksum) throw new StorageError('Backup inspection SHA-256 checksum was changed; inspect the backup again.')
  // Zod clones records synchronously, so later caller edits cannot race asynchronous decoding/restore.
  const data = parseWorkspaceData(inspection.backup.payload)
  // Bound cumulative text/base64 before canonical comparisons allocate JSON strings.
  if (estimateBackupEnvelopeBytes(data, inspection.backup.exportedAt, inspection.backup.checksum) > limits.maxBackupBytes) throw new StorageError('Backup exceeds the encoded size limit (75 MiB maximum).')
  assertWorkspaceBudget(calculateWorkspaceBudget(data), limits)
  if (!recordEqual(inspection.backup.payload, data)) throw new StorageError('Backup inspection metadata was changed; inspect the backup again.')
  if (inspection.createdAt !== inspection.backup.exportedAt || !recordEqual(inspection.counts, counts(data))) {
    throw new StorageError('Backup inspection counts/date were changed; inspect the backup again.')
  }
  await validateAllImages(data, decoder, limits)
  const encoded = backupSchema.parse({ ...inspection.backup, payload: await encodePayload(data) })
  assertBackupSize(encoded, limits)
  if (await envelopeDigest(encoded) !== originalChecksum) throw new StorageError('Backup inspection envelope SHA-256 mismatch; inspect the original backup again.')
  return { format: encoded.format, version: encoded.version, exportedAt: encoded.exportedAt, checksum: encoded.checksum, payload: data }
}
