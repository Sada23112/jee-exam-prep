import {
  ref,
  uploadBytesResumable,
  getBytes,
  getDownloadURL,
  deleteObject,
  type StorageReference,
} from 'firebase/storage'
import { getFirebaseStorage } from './firebase'
import type { AssetRecord } from '../storage/assets'
import { workspace } from '../storage/workspace'

export interface UploadProgressInfo {
  bytesTransferred: number
  totalBytes: number
  percent: number
}

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
const MAX_ASSET_BYTES = 10 * 1024 * 1024 // 10 MB

export class FirebaseStorageService {
  /**
   * Upload an asset blob to Firebase Storage under users/{userId}/assets/{assetId}/{name}.
   */
  static async uploadAsset(
    userId: string,
    asset: AssetRecord,
    onProgress?: (info: UploadProgressInfo) => void,
  ): Promise<{ storagePath: string; downloadUrl: string }> {
    const storage = getFirebaseStorage()
    if (!storage) throw new Error('Firebase Storage is not initialized or configured.')

    if (!ALLOWED_MIME_TYPES.has(asset.mimeType)) {
      throw new Error(`Unsupported MIME type: ${asset.mimeType}`)
    }
    if (asset.size > MAX_ASSET_BYTES) {
      throw new Error(`Asset size (${Math.round(asset.size / 1024)} KB) exceeds 10 MB limit.`)
    }

    const safeName = asset.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `users/${userId}/assets/${asset.id}/${safeName}`
    const storageRef = ref(storage, storagePath)

    const metadata = {
      contentType: asset.mimeType,
      customMetadata: {
        assetId: asset.id,
        sha256: asset.sha256,
        ownerId: asset.ownerId || '',
        role: asset.role,
        width: String(asset.width),
        height: String(asset.height),
      },
    }

    await new Promise<void>((resolve, reject) => {
      const uploadTask = uploadBytesResumable(storageRef, asset.blob, metadata)

      uploadTask.on(
        'state_changed',
        snapshot => {
          if (onProgress && snapshot.totalBytes > 0) {
            onProgress({
              bytesTransferred: snapshot.bytesTransferred,
              totalBytes: snapshot.totalBytes,
              percent: Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100),
            })
          }
        },
        error => reject(error),
        () => resolve(),
      )
    })

    const downloadUrl = await getDownloadURL(storageRef)
    return { storagePath, downloadUrl }
  }

  /**
   * Downloads an asset from Firebase Storage and caches it locally into Dexie's assets table if missing.
   */
  static async downloadAndCacheAsset(
    userId: string,
    assetMetadata: {
      id: string
      name: string
      mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
      role: 'page' | 'crop' | 'diagram'
      size: number
      width: number
      height: number
      sha256: string
      ownerId: string | null
      createdAt: string
      storagePath?: string
    },
  ): Promise<AssetRecord | null> {
    // Check if asset already exists in local Dexie store
    const existing = await workspace.getAsset(assetMetadata.id)
    if (existing && existing.sha256 === assetMetadata.sha256) {
      return existing
    }

    const storage = getFirebaseStorage()
    if (!storage) return null

    const safeName = assetMetadata.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = assetMetadata.storagePath || `users/${userId}/assets/${assetMetadata.id}/${safeName}`
    const storageRef: StorageReference = ref(storage, storagePath)

    try {
      const arrayBuffer = await getBytes(storageRef, MAX_ASSET_BYTES)
      const blob = new Blob([arrayBuffer], { type: assetMetadata.mimeType })

      const assetRecord: AssetRecord = {
        id: assetMetadata.id,
        schemaVersion: 1,
        ownerId: assetMetadata.ownerId,
        createdAt: assetMetadata.createdAt,
        name: assetMetadata.name,
        mimeType: assetMetadata.mimeType,
        role: assetMetadata.role,
        size: blob.size,
        width: assetMetadata.width,
        height: assetMetadata.height,
        sha256: assetMetadata.sha256,
        blob,
      }

      // Add to local Dexie workspace assets table
      await workspace.db.assets.put(assetRecord)
      return assetRecord
    } catch (err) {
      console.warn(`Could not cache asset ${assetMetadata.id} from cloud:`, err)
      return null
    }
  }

  /**
   * Upload user profile avatar.
   */
  static async uploadAvatar(userId: string, file: File): Promise<string> {
    const storage = getFirebaseStorage()
    if (!storage) throw new Error('Firebase Storage is not initialized or configured.')

    if (!file.type.startsWith('image/')) {
      throw new Error('Avatar must be an image file.')
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('Avatar image must be smaller than 2 MB.')
    }

    const ext = file.name.split('.').pop() || 'png'
    const storagePath = `users/${userId}/avatars/avatar_${Date.now()}.${ext}`
    const storageRef = ref(storage, storagePath)

    await uploadBytesResumable(storageRef, file, { contentType: file.type })
    return getDownloadURL(storageRef)
  }

  /**
   * Delete asset from cloud storage.
   */
  static async deleteAsset(userId: string, assetId: string, name: string): Promise<void> {
    const storage = getFirebaseStorage()
    if (!storage) return
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `users/${userId}/assets/${assetId}/${safeName}`
    try {
      await deleteObject(ref(storage, storagePath))
    } catch {
      // Ignore not-found or delete errors
    }
  }
}
