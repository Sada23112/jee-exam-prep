import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
} from 'firebase/firestore'
import { getFirebaseFirestore } from '../firebase/firebase'
import { workspace } from '../storage/workspace'
import { syncDb, enqueueSync, getPendingSyncCount, type PendingSyncItem } from './sync-db'
import { FirebaseStorageService } from '../firebase/storage-service'
import type { Question } from '../../modules/question-bank/domain/question'
import type { QuestionCollection } from '../../modules/question-bank/domain/collection'
import type { ExamPreset } from '../../modules/exam-engine/domain/preset'
import type { ExamHistoryRecord } from '../../modules/results/domain/history'
import type { AssetRecord } from '../storage/assets'

export type SyncStatus = 'synced' | 'syncing' | 'offline' | 'pending' | 'error'

export interface SyncState {
  status: SyncStatus
  lastSyncAt: string | null
  pendingCount: number
  errorMessage: string | null
  isOnline: boolean
}

type SyncStateListener = (state: SyncState) => void

export class SyncService {
  private static instance: SyncService | null = null
  private listeners = new Set<SyncStateListener>()
  private isSyncing = false
  private currentUserId: string | null = null
  private accountUuid: string | null = null

  private state: SyncState = {
    status: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'synced',
    lastSyncAt: null,
    pendingCount: 0,
    errorMessage: null,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
  }

  private constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.updateState({ isOnline: true })
        void this.triggerSync()
      })
      window.addEventListener('offline', () => {
        this.updateState({ isOnline: false, status: 'offline' })
      })
    }
  }

  static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService()
    }
    return SyncService.instance
  }

  subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): SyncState {
    return this.state
  }

  private updateState(partial: Partial<SyncState>): void {
    this.state = { ...this.state, ...partial }
    this.listeners.forEach(l => l(this.state))
  }

  setUser(userId: string | null, accountUuid: string | null): void {
    this.currentUserId = userId
    this.accountUuid = accountUuid
    if (userId && this.state.isOnline) {
      void this.triggerSync()
    }
  }

  /**
   * Schedules a record to be pushed to cloud.
   */
  async queueChange(
    tableName: 'questions' | 'collections' | 'presets' | 'history' | 'assets',
    recordId: string,
    action: 'upsert' | 'delete' = 'upsert',
  ): Promise<void> {
    await enqueueSync(tableName, recordId, action)
    const count = await getPendingSyncCount()
    this.updateState({
      pendingCount: count,
      status: !this.state.isOnline ? 'offline' : count > 0 ? 'pending' : 'synced',
    })

    if (this.currentUserId && this.state.isOnline && !this.isSyncing) {
      void this.triggerSync()
    }
  }

  /**
   * Main synchronization loop: processes pending outgoing queue then pulls cloud updates.
   */
  async triggerSync(): Promise<void> {
    if (this.isSyncing || !this.currentUserId || !this.accountUuid) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      this.updateState({ status: 'offline', isOnline: false })
      return
    }

    const firestore = getFirebaseFirestore()
    if (!firestore) return

    this.isSyncing = true
    this.updateState({ status: 'syncing', errorMessage: null })

    try {
      try {
        await workspace.open()
      } catch (openErr) {
        if (openErr instanceof Error && (
          openErr.message.includes('budget') ||
          openErr.message.includes('missing image')
        )) {
          await workspace.repairMissingAssets()
          await workspace.repairBudget()
          await workspace.open()
        } else {
          throw openErr
        }
      }

      // 1. Flush pending queue to cloud
      await this.flushPendingQueue(this.currentUserId)

      // 2. Pull remote delta updates from cloud
      await this.pullRemoteDeltas(this.currentUserId, this.accountUuid)

      const remainingPending = await getPendingSyncCount()
      const now = new Date().toISOString()

      this.updateState({
        status: remainingPending > 0 ? 'pending' : 'synced',
        lastSyncAt: now,
        pendingCount: remainingPending,
        errorMessage: null,
      })
    } catch (err) {
      console.warn('Sync failed:', err)
      const pending = await getPendingSyncCount()
      this.updateState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
        pendingCount: pending,
      })
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Upload all queued local changes to Cloud Firestore and Firebase Storage.
   */
  private async flushPendingQueue(userId: string): Promise<void> {
    const firestore = getFirebaseFirestore()
    if (!firestore) return

    const pendingItems = await syncDb.queue.limit(50).toArray()
    if (pendingItems.length === 0) return

    for (const item of pendingItems) {
      try {
        await this.syncOutgoingItem(userId, item)
        if (item.id !== undefined) {
          await syncDb.queue.delete(item.id)
        }
      } catch (err) {
        console.warn(`Failed to sync queued item ${item.collection}:${item.recordId}`, err)
        if (item.id !== undefined) {
          await syncDb.queue.update(item.id, {
            retries: item.retries + 1,
            lastError: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  private async syncOutgoingItem(userId: string, item: PendingSyncItem): Promise<void> {
    const firestore = getFirebaseFirestore()
    if (!firestore) return

    const colRef = collection(firestore, 'users', userId, item.collection)
    const docRef = doc(colRef, item.recordId)

    if (item.collection === 'questions') {
      const record = await workspace.db.questions.get(item.recordId)
      if (record) {
        await setDoc(docRef, sanitizeForFirestore(record), { merge: true })
      }
    } else if (item.collection === 'collections') {
      const record = await workspace.db.collections.get(item.recordId)
      if (record) {
        await setDoc(docRef, sanitizeForFirestore(record), { merge: true })
      }
    } else if (item.collection === 'presets') {
      const record = await workspace.db.presets.get(item.recordId)
      if (record) {
        await setDoc(docRef, sanitizeForFirestore(record), { merge: true })
      }
    } else if (item.collection === 'history') {
      const record = await workspace.db.history.get(item.recordId)
      if (record) {
        await setDoc(docRef, sanitizeForFirestore(record), { merge: true })
      }
    } else if (item.collection === 'assets') {
      const record = await workspace.db.assets.get(item.recordId)
      if (record) {
        // 1. Upload binary blob to Storage (resilient fallback if Storage bucket not ready)
        let storagePath: string | null = null
        let downloadUrl: string | null = null
        try {
          const res = await FirebaseStorageService.uploadAsset(userId, record)
          storagePath = res.storagePath
          downloadUrl = res.downloadUrl
        } catch (storageErr) {
          console.warn(`Storage upload skipped for asset ${record.id} (offline blob retained):`, storageErr)
        }

        // 2. Save metadata in Firestore
        const metadataDoc: Record<string, unknown> = {
          id: record.id,
          schemaVersion: 1,
          ownerId: record.ownerId,
          createdAt: record.createdAt,
          name: record.name,
          mimeType: record.mimeType,
          role: record.role,
          size: record.size,
          width: record.width,
          height: record.height,
          sha256: record.sha256,
        }
        if (storagePath) metadataDoc.storagePath = storagePath
        if (downloadUrl) metadataDoc.downloadUrl = downloadUrl
        await setDoc(docRef, metadataDoc, { merge: true })
      }
    }
  }

  /**
   * Pull delta records from Cloud Firestore down to local Dexie.
   */
  private async pullRemoteDeltas(userId: string, accountUuid: string): Promise<void> {
    const firestore = getFirebaseFirestore()
    if (!firestore) return

    // Read lastSyncAt from metadata
    const metaRecord = await syncDb.syncMetadata.get('lastSyncAt')
    const lastSyncAt = metaRecord ? (metaRecord.value as string) : null

    // 1. Pull questions
    await this.pullCollection<Question>(
      userId,
      'questions',
      lastSyncAt,
      async remoteItem => {
        const local = await workspace.db.questions.get(remoteItem.id)
        if (!local || isRemoteNewer(local, remoteItem)) {
          // Normalize ownerId to user's accountUuid
          const recordToSave: Question = { ...remoteItem, ownerId: accountUuid }
          await workspace.db.questions.put(recordToSave)
          // Also record immutable version
          await workspace.db.questionVersions.put(recordToSave)
        }
      },
    )

    // 2. Pull collections
    await this.pullCollection<QuestionCollection>(
      userId,
      'collections',
      lastSyncAt,
      async remoteItem => {
        const local = await workspace.db.collections.get(remoteItem.id)
        if (!local || isRemoteNewer(local, remoteItem)) {
          await workspace.db.collections.put({ ...remoteItem, ownerId: accountUuid })
        }
      },
    )

    // 3. Pull presets
    await this.pullCollection<ExamPreset>(
      userId,
      'presets',
      lastSyncAt,
      async remoteItem => {
        const local = await workspace.db.presets.get(remoteItem.id)
        if (!local || isRemoteNewer(local, remoteItem) || remoteItem.version > (local.version || 0)) {
          await workspace.db.presets.put({ ...remoteItem, ownerId: accountUuid })
        }
      },
    )

    // 4. Pull exam history
    await this.pullCollection<ExamHistoryRecord>(
      userId,
      'history',
      lastSyncAt,
      async remoteItem => {
        const local = await workspace.db.history.get(remoteItem.id)
        // If local is already submitted, never overwrite with non-submitted
        if (local && local.status === 'submitted' && remoteItem.status !== 'submitted') {
          return
        }
        if (!local || isRemoteNewer(local, remoteItem)) {
          await workspace.db.history.put({ ...remoteItem, ownerId: accountUuid })
        }
      },
    )

    // 5. Pull assets metadata and cache binary blobs
    await this.pullCollection<AssetRecord & { storagePath?: string }>(
      userId,
      'assets',
      lastSyncAt,
      async remoteAsset => {
        const local = await workspace.db.assets.get(remoteAsset.id)
        if (!local && remoteAsset.storagePath) {
          try {
            await FirebaseStorageService.downloadAndCacheAsset(userId, {
              ...remoteAsset,
              ownerId: accountUuid,
            })
          } catch (dlErr) {
            console.warn(`Could not download remote asset ${remoteAsset.id}:`, dlErr)
          }
        }
      },
      'createdAt',
    )

    // Update lastSyncAt checkpoint
    const now = new Date().toISOString()
    await syncDb.syncMetadata.put({
      key: 'lastSyncAt',
      value: now,
      updatedAt: now,
    })

    // Re-align local database budget with pulled changes
    try {
      await workspace.repairBudget()
    } catch (budgetErr) {
      console.warn('Could not recalculate budget after sync:', budgetErr)
    }
  }

  private async pullCollection<T extends { id: string }>(
    userId: string,
    collectionName: string,
    lastSyncAt: string | null,
    onRemoteItem: (item: T) => Promise<void>,
    timestampField = 'updatedAt',
  ): Promise<void> {
    const firestore = getFirebaseFirestore()
    if (!firestore) return

    const colRef = collection(firestore, 'users', userId, collectionName)
    let q = query(colRef)
    if (lastSyncAt) {
      q = query(colRef, where(timestampField, '>', lastSyncAt))
    }

    const snap = await getDocs(q)
    for (const docSnap of snap.docs) {
      const data = docSnap.data() as T
      await onRemoteItem(data)
    }
  }
}

export const syncService = SyncService.getInstance()

/**
 * Deterministic Conflict Resolution:
 * Checks whether remote record supersedes local record based on revision and updatedAt timestamp.
 */
function isRemoteNewer(
  local: { revision?: number; updatedAt: string },
  remote: { revision?: number; updatedAt: string },
): boolean {
  const localRev = local.revision ?? 1
  const remoteRev = remote.revision ?? 1

  if (remoteRev > localRev) return true
  if (localRev > remoteRev) return false

  return Date.parse(remote.updatedAt) > Date.parse(local.updatedAt)
}

/**
 * Strips non-serializable fields or complex prototypes before sending to Firestore.
 */
function sanitizeForFirestore<T extends object>(data: T): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(data)) as Record<string, unknown>
  delete plain.blob // Assets blobs are stored in Firebase Storage, not Firestore documents
  return plain
}
