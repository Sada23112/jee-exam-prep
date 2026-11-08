import Dexie from 'dexie'
import type { Table } from 'dexie'
import type { Question } from '../../modules/question-bank/domain/question'
import type { QuestionCollection } from '../../modules/question-bank/domain/collection'
import type { ExamPreset } from '../../modules/exam-engine/domain/preset'
import type { ExamHistoryRecord } from '../../modules/results/domain/history'
import type { AssetRecord } from './assets'
import { StorageError } from './errors'
import { assertWorkspaceBudget, calculateWorkspaceBudget, workspaceMetadataSchema } from './budget'
import type { WorkspaceBudget } from './budget'

export const DATABASE_SCHEMA_VERSION = 1
const WORKSPACE_STORES = {
  questions: '&id,updatedAt,deletedAt,subject',
  questionVersions: '[id+revision],id',
  collections: '&id,updatedAt,deletedAt',
  presets: '&id,&[familyId+version],familyId,version,updatedAt,deletedAt',
  history: '&id,updatedAt,deletedAt,status',
  assets: '&id,sha256',
  metadata: '&key',
}

/** Refuse legacy/future or malformed layouts BEFORE Dexie could attempt an upgrade. */
export async function assertCompatibleDatabase(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new StorageError('IndexedDB is unavailable; this browser cannot store a local workspace.')
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false
    let failed = false
    request.onupgradeneeded = event => {
      // A no-version probe of an absent database must not create a partial database.
      absent = event.oldVersion === 0
      request.transaction?.abort()
    }
    request.onerror = event => {
      event.preventDefault()
      if (absent) resolve()
      else reject(new StorageError('Unable to inspect existing workspace storage; no data was cleared.', { cause: request.error }))
    }
    request.onblocked = () => { failed = true; reject(new StorageError('Workspace inspection is blocked by another tab. Close other app tabs and retry.')) }
    request.onsuccess = () => {
      const native = request.result
      try {
        if (failed) return
        // Dexie represents each declared schema version as ten native IDB versions.
        if (native.version !== DATABASE_SCHEMA_VERSION * 10) throw new StorageError('Unsupported workspace database version. An explicit compatible migration is required; no data was cleared.')
        const names = Array.from(native.objectStoreNames).sort()
        if (JSON.stringify(names) !== JSON.stringify(Object.keys(WORKSPACE_STORES).sort())) throw new StorageError('Malformed workspace table layout; no data was cleared.')
        const transaction = native.transaction(names, 'readonly')
        const keyPath = (token: string): string | string[] => token.startsWith('[') ? token.slice(1, -1).split('+') : token
        for (const [table, specification] of Object.entries(WORKSPACE_STORES)) {
          const tokens = specification.split(',')
          const primary = tokens.shift()!.replace(/^&/, '')
          const store = transaction.objectStore(table)
          if (store.autoIncrement || JSON.stringify(store.keyPath) !== JSON.stringify(keyPath(primary))) throw new StorageError(`Malformed ${table} identity layout; no data was cleared.`)
          const indexNames = tokens.map(token => token.replace(/^&/, '')).sort()
          if (JSON.stringify(Array.from(store.indexNames).sort()) !== JSON.stringify(indexNames)) throw new StorageError(`Malformed ${table} index layout; no data was cleared.`)
          for (const token of tokens) {
            const index = store.index(token.replace(/^&/, ''))
            if (index.unique !== token.startsWith('&') || index.multiEntry || JSON.stringify(index.keyPath) !== JSON.stringify(keyPath(index.name))) throw new StorageError(`Malformed ${table} index metadata; no data was cleared.`)
          }
        }
        // Check the mandatory v1 budget marker before Dexie opens the workspace.
        // Full counter integrity is checked once against every row after opening.
        const metadata = transaction.objectStore('metadata')
        const count = metadata.count()
        count.onerror = () => reject(new StorageError('Unable to inspect workspace schema marker; no data was cleared.', { cause: count.error }))
        count.onsuccess = () => {
          if (count.result !== 1) { reject(new StorageError('Workspace schema marker is missing or malformed; no data was cleared.')); return }
          const marker = metadata.get('schema')
          marker.onerror = () => reject(new StorageError('Unable to inspect workspace schema marker; no data was cleared.', { cause: marker.error }))
          marker.onsuccess = () => {
            try { assertWorkspaceBudget(workspaceMetadataSchema.parse(marker.result).budget); resolve() }
            catch (error) { reject(new StorageError('Workspace schema marker/budget is malformed or unsupported; no data was cleared.', { cause: error })) }
          }
        }
      } catch (error) { reject(error) } finally { native.close() }
    }
  })
}
export interface WorkspaceMetadata { key: 'schema'; version: 1; budget: WorkspaceBudget }

/**
 * Migration protocol: add a new Dexie version with an explicit, non-destructive
 * upgrade, validate old records before transformation, then update the schema marker.
 * In the same change, teach assertCompatibleDatabase preflight which legacy versions
 * and exact table/index layouts are migratable; update WORKSPACE_STORES for the target
 * layout and validation.ts's schema-marker reader for migrated records. Merely adding
 * an upgrade callback is insufficient: preflight otherwise rejects before it can run.
 * This unshipped v1 includes the mandatory budget marker. Older marker shapes
 * require an explicit migration; never clear data to recover a malformed marker.
 * Exposed tables are an escape hatch for tests and future migrations, not a write port.
 */
export class WorkspaceDatabase extends Dexie {
  questions!: Table<Question, string>
  questionVersions!: Table<Question, [string, number]>
  collections!: Table<QuestionCollection, string>
  presets!: Table<ExamPreset, string>
  history!: Table<ExamHistoryRecord, string>
  assets!: Table<AssetRecord, string>
  metadata!: Table<WorkspaceMetadata, string>

  constructor(name: string) {
    super(name)
    this.version(DATABASE_SCHEMA_VERSION).stores(WORKSPACE_STORES)
    this.on('populate', transaction => transaction.table('metadata').add({ key: 'schema', version: DATABASE_SCHEMA_VERSION, budget: calculateWorkspaceBudget() }))
  }
}
