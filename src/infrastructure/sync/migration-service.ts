import { doc, setDoc } from 'firebase/firestore'
import { getFirebaseFirestore } from '../firebase/firebase'
import { workspace } from '../storage/workspace'
import { FirebaseStorageService } from '../firebase/storage-service'
import { syncDb } from './sync-db'

export interface UnmigratedSummary {
  questionsCount: number
  collectionsCount: number
  presetsCount: number
  historyCount: number
  assetsCount: number
  totalCount: number
}

export interface MigrationProgress {
  stage: string
  current: number
  total: number
  percent: number
}

export class MigrationService {
  /**
   * Detects local records in IndexedDB that do not belong to any cloud user (ownerId == null).
   */
  static async detectUnmigratedData(): Promise<UnmigratedSummary> {
    try {
      try {
        try {
      await workspace.open()
    } catch (openErr) {
      if (openErr instanceof Error && openErr.message.includes('budget counters')) {
        await workspace.repairBudget()
        await workspace.open()
      } else {
        throw openErr
      }
    }
      } catch (openErr) {
        if (openErr instanceof Error && openErr.message.includes('budget counters')) {
          await workspace.repairBudget()
          try {
      await workspace.open()
    } catch (openErr) {
      if (openErr instanceof Error && openErr.message.includes('budget counters')) {
        await workspace.repairBudget()
        await workspace.open()
      } else {
        throw openErr
      }
    }
        } else {
          throw openErr
        }
      }
      const [allQuestions, allCollections, allPresets, allHistory, allAssets] = await Promise.all([
        workspace.db.questions.toArray(),
        workspace.db.collections.toArray(),
        workspace.db.presets.toArray(),
        workspace.db.history.toArray(),
        workspace.db.assets.toArray(),
      ])

      const unmigratedQuestions = allQuestions.filter(q => q.ownerId === null).length
      const unmigratedCollections = allCollections.filter(c => c.ownerId === null).length
      const unmigratedPresets = allPresets.filter(p => p.ownerId === null).length
      const unmigratedHistory = allHistory.filter(h => h.ownerId === null).length
      const unmigratedAssets = allAssets.filter(a => a.ownerId === null).length

      const totalCount =
        unmigratedQuestions +
        unmigratedCollections +
        unmigratedPresets +
        unmigratedHistory +
        unmigratedAssets

      return {
        questionsCount: unmigratedQuestions,
        collectionsCount: unmigratedCollections,
        presetsCount: unmigratedPresets,
        historyCount: unmigratedHistory,
        assetsCount: unmigratedAssets,
        totalCount,
      }
    } catch (err) {
      console.warn('Could not inspect unmigrated data:', err)
      return {
        questionsCount: 0,
        collectionsCount: 0,
        presetsCount: 0,
        historyCount: 0,
        assetsCount: 0,
        totalCount: 0,
      }
    }
  }

  /**
   * Migrates local data to the authenticated cloud account safely and incrementally.
   */
  static async migrateLocalData(
    userId: string,
    accountUuid: string,
    onProgress?: (progress: MigrationProgress) => void,
  ): Promise<{ success: boolean; migratedCount: number; errors: string[] }> {
    const firestore = getFirebaseFirestore()
    if (!firestore) throw new Error('Firebase Firestore is not initialized.')

    try {
      await workspace.open()
    } catch (openErr) {
      if (openErr instanceof Error && openErr.message.includes('budget counters')) {
        await workspace.repairBudget()
        await workspace.open()
      } else {
        throw openErr
      }
    }

    const summary = await MigrationService.detectUnmigratedData()
    if (summary.totalCount === 0) {
      return { success: true, migratedCount: 0, errors: [] }
    }

    const errors: string[] = []
    let completed = 0
    const total = summary.totalCount

    const report = (stage: string) => {
      if (onProgress) {
        onProgress({
          stage,
          current: completed,
          total,
          percent: Math.min(100, Math.round((completed / total) * 100)),
        })
      }
    }

    report('Preparing migration…')

    // 1. Questions
    const questions = (await workspace.db.questions.toArray()).filter(q => q.ownerId === null)
    for (const q of questions) {
      try {
        const updated = { ...q, ownerId: accountUuid }
        // Save to Firestore
        const docRef = doc(firestore, 'users', userId, 'questions', q.id)
        await setDoc(docRef, JSON.parse(JSON.stringify(updated)), { merge: true })
        // Update local Dexie record to reflect assigned ownership
        await workspace.db.questions.put(updated)
        await workspace.db.questionVersions.put(updated)
      } catch (err) {
        errors.push(`Question ${q.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      report(`Migrating questions (${completed}/${total})`)
    }

    // 2. Collections
    const collections = (await workspace.db.collections.toArray()).filter(c => c.ownerId === null)
    for (const col of collections) {
      try {
        const updated = { ...col, ownerId: accountUuid }
        const docRef = doc(firestore, 'users', userId, 'collections', col.id)
        await setDoc(docRef, JSON.parse(JSON.stringify(updated)), { merge: true })
        await workspace.db.collections.put(updated)
      } catch (err) {
        errors.push(`Collection ${col.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      report(`Migrating collections (${completed}/${total})`)
    }

    // 3. Presets
    const presets = (await workspace.db.presets.toArray()).filter(p => p.ownerId === null)
    for (const pr of presets) {
      try {
        const updated = { ...pr, ownerId: accountUuid }
        const docRef = doc(firestore, 'users', userId, 'presets', pr.id)
        await setDoc(docRef, JSON.parse(JSON.stringify(updated)), { merge: true })
        await workspace.db.presets.put(updated)
      } catch (err) {
        errors.push(`Preset ${pr.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      report(`Migrating presets (${completed}/${total})`)
    }

    // 4. Exam History
    const history = (await workspace.db.history.toArray()).filter(h => h.ownerId === null)
    for (const h of history) {
      try {
        const updated = { ...h, ownerId: accountUuid }
        const docRef = doc(firestore, 'users', userId, 'history', h.id)
        await setDoc(docRef, JSON.parse(JSON.stringify(updated)), { merge: true })
        await workspace.db.history.put(updated)
      } catch (err) {
        errors.push(`Exam History ${h.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      report(`Migrating exam attempts (${completed}/${total})`)
    }

    // 5. Assets
    const assets = (await workspace.db.assets.toArray()).filter(a => a.ownerId === null)
    for (const a of assets) {
      try {
        const updated = { ...a, ownerId: accountUuid }
        // Upload blob to Storage (resilient: local IndexedDB Blob is always preserved)
        let storagePath: string | null = null
        let downloadUrl: string | null = null
        try {
          const uploaded = await FirebaseStorageService.uploadAsset(userId, updated)
          storagePath = uploaded.storagePath
          downloadUrl = uploaded.downloadUrl
        } catch (storageErr) {
          console.warn(`Storage upload skipped for asset ${a.id} (offline blob retained):`, storageErr)
        }

        // Save metadata to Firestore
        const docRef = doc(firestore, 'users', userId, 'assets', a.id)
        const metadata: Record<string, unknown> = {
          id: a.id,
          schemaVersion: 1,
          ownerId: accountUuid,
          createdAt: a.createdAt,
          name: a.name,
          mimeType: a.mimeType,
          role: a.role,
          size: a.size,
          width: a.width,
          height: a.height,
          sha256: a.sha256,
        }
        if (storagePath) metadata.storagePath = storagePath
        if (downloadUrl) metadata.downloadUrl = downloadUrl

        await setDoc(docRef, metadata, { merge: true })
        await workspace.db.assets.put(updated)
      } catch (err) {
        errors.push(`Asset ${a.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
      completed++
      report(`Uploading document assets (${completed}/${total})`)
    }

    // Record lastSyncAt
    const now = new Date().toISOString()
    await syncDb.syncMetadata.put({
      key: 'lastSyncAt',
      value: now,
      updatedAt: now,
    })

    // Re-align local database budget with updated ownership metadata
    try {
      await workspace.repairBudget()
    } catch (budgetErr) {
      console.warn('Could not recalculate budget after migration:', budgetErr)
    }

    report('Migration complete!')
    return {
      success: errors.length === 0,
      migratedCount: completed,
      errors,
    }
  }
}
