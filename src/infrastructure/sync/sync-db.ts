import Dexie, { type Table } from 'dexie'

export type SyncCollectionType = 'questions' | 'collections' | 'presets' | 'history' | 'assets'
export type SyncActionType = 'upsert' | 'delete'

export interface PendingSyncItem {
  id?: number
  collection: SyncCollectionType
  recordId: string
  action: SyncActionType
  timestamp: string
  retries: number
  lastError?: string
}

export interface SyncMetadataRecord {
  key: string
  value: string | number | boolean | object | null
  updatedAt: string
}

export class SyncDatabase extends Dexie {
  queue!: Table<PendingSyncItem, number>
  syncMetadata!: Table<SyncMetadataRecord, string>

  constructor(dbName = 'jee-cbt-sync') {
    super(dbName)
    this.version(1).stores({
      queue: '++id,collection,recordId,timestamp,retries',
      syncMetadata: '&key',
    })
  }
}

export const syncDb = new SyncDatabase()

export async function enqueueSync(
  collection: SyncCollectionType,
  recordId: string,
  action: SyncActionType = 'upsert',
): Promise<void> {
  const now = new Date().toISOString()
  await syncDb.transaction('rw', syncDb.queue, async () => {
    // Deduplicate existing pending item for same record and collection
    const existing = await syncDb.queue
      .where({ collection, recordId })
      .first()

    if (existing && existing.id !== undefined) {
      await syncDb.queue.update(existing.id, {
        action,
        timestamp: now,
        retries: 0,
      })
    } else {
      await syncDb.queue.add({
        collection,
        recordId,
        action,
        timestamp: now,
        retries: 0,
      })
    }
  })
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    return await syncDb.queue.count()
  } catch {
    return 0
  }
}

export async function clearSyncQueue(): Promise<void> {
  await syncDb.queue.clear()
}
