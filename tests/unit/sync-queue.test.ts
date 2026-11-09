import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { syncDb, enqueueSync, getPendingSyncCount, clearSyncQueue } from '../../src/infrastructure/sync/sync-db'

describe('Multi-Device Sync Queue Persistence (jee-cbt-sync)', () => {
  beforeEach(async () => {
    await clearSyncQueue()
  })

  it('enqueues pending mutations properly', async () => {
    await enqueueSync('questions', 'q-101', 'upsert')
    await enqueueSync('presets', 'preset-202', 'upsert')

    const count = await getPendingSyncCount()
    expect(count).toBe(2)

    const items = await syncDb.queue.toArray()
    expect(items).toHaveLength(2)
    expect(items[0]?.collection).toBe('questions')
    expect(items[0]?.recordId).toBe('q-101')
    expect(items[1]?.collection).toBe('presets')
  })

  it('deduplicates multiple rapid updates for the exact same record', async () => {
    await enqueueSync('questions', 'q-101', 'upsert')
    await enqueueSync('questions', 'q-101', 'upsert')
    await enqueueSync('questions', 'q-101', 'delete')

    const count = await getPendingSyncCount()
    expect(count).toBe(1)

    const items = await syncDb.queue.toArray()
    const item = items[0]
    expect(item?.recordId).toBe('q-101')
    expect(item?.action).toBe('delete')
  })
})
