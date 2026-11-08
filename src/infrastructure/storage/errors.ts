export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(message, options); this.name = 'StorageError' }
}
export class ConflictError extends StorageError {
  constructor(message: string) { super(message); this.name = 'ConflictError' }
}

export async function storageOperation<T>(action: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation() } catch (error) {
    if (error instanceof StorageError) throw error
    const detail = error instanceof Error ? error.message : 'Unknown storage failure'
    const quota = error instanceof Error && error.name === 'QuotaExceededError'
    throw new StorageError(`${action}: ${quota ? 'Browser storage quota exceeded. Export a backup or free space; no records were cleared.' : detail}`, { cause: error })
  }
}
