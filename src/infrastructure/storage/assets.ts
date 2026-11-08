import { z } from 'zod'
import { timestampSchema, uuidSchema } from '../../modules/question-bank/domain/common'
import { StorageError } from './errors'

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_IMAGE_PIXELS = 40_000_000
export type AssetRole = 'page' | 'crop' | 'diagram'
export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'
export interface AssetRecord {
  id: string
  schemaVersion: 1
  ownerId: string | null
  createdAt: string
  name: string
  mimeType: ImageMimeType
  role: AssetRole
  size: number
  width: number
  height: number
  sha256: string
  blob: Blob
}
export type ImageDecoder = (blob: Blob) => Promise<{ width: number; height: number }>
export const assetMetadataShape = {
  id: uuidSchema,
  schemaVersion: z.literal(1),
  ownerId: uuidSchema.nullable(),
  createdAt: timestampSchema,
  name: z.string().min(1).max(255).refine(name => !Array.from(name).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === '/' || character === '\\'), 'Image names cannot contain paths or control characters.'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  role: z.enum(['page', 'crop', 'diagram']),
  size: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  width: z.number().int().min(1).max(MAX_IMAGE_PIXELS),
  height: z.number().int().min(1).max(MAX_IMAGE_PIXELS),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}
export function isNativeBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob && Object.getPrototypeOf(value) === Blob.prototype && Object.getOwnPropertyNames(value).length === 0
}
export const assetSchema = z.object({
  ...assetMetadataShape,
  // Stored image bytes are plain immutable Blobs, never caller-overridden subclasses/getters.
  blob: z.custom<Blob>(isNativeBlob, 'An unmodified immutable image Blob is required.'),
}).strict().superRefine((value, ctx) => {
  if (value.width * value.height > MAX_IMAGE_PIXELS) ctx.addIssue({ code: 'custom', path: ['width'], message: 'Image exceeds 40 million pixels.' })
  if (isNativeBlob(value.blob) && (value.blob.size !== value.size || value.blob.type !== value.mimeType)) {
    ctx.addIssue({ code: 'custom', path: ['blob'], message: 'Blob size/type does not match image metadata.' })
  }
})

/** Supports browser File/Blob as well as older DOM File implementations. */
export async function blobBytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  if (typeof FileReader === 'undefined') throw new StorageError('This browser cannot read image/backup files.')
  return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new StorageError('Unable to read the selected file.'))
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(reader.result) : reject(new StorageError('Invalid file data.'))
    reader.readAsArrayBuffer(blob)
  }))
}
export async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new StorageError('Secure SHA-256 is unavailable. Use HTTPS or localhost in a supported browser.')
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}

function assertDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width * height > MAX_IMAGE_PIXELS) {
    throw new StorageError('Invalid image dimensions or image exceeds 40 million pixels.')
  }
}
function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length))
}
/** Inspect magic bytes and bounded header dimensions before invoking a pixel decoder. */
export function inspectImageHeader(bytes: Uint8Array<ArrayBuffer>): { mimeType: ImageMimeType; width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let mimeType: ImageMimeType
  let width = 0
  let height = 0
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    if (view.getUint32(8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') throw new StorageError('Malformed PNG header.')
    mimeType = 'image/png'
    width = view.getUint32(16)
    height = view.getUint32(20)
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mimeType = 'image/jpeg'
    let cursor = 2
    while (cursor < bytes.length) {
      if (bytes[cursor] !== 0xff) throw new StorageError('Malformed JPEG marker.')
      while (bytes[cursor] === 0xff) cursor++
      const marker = bytes[cursor++]
      if (marker === undefined || marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (cursor + 2 > bytes.length) throw new StorageError('Truncated JPEG segment.')
      const length = view.getUint16(cursor)
      if (length < 2 || cursor + length > bytes.length) throw new StorageError('Invalid JPEG segment length.')
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        if (length < 8) throw new StorageError('Invalid JPEG frame.')
        height = view.getUint16(cursor + 3)
        width = view.getUint16(cursor + 5)
        break
      }
      cursor += length
    }
    if (!width || !height) throw new StorageError('JPEG dimensions could not be verified.')
  } else if (bytes.length >= 25 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    mimeType = 'image/webp'
    if (view.getUint32(4, true) + 8 !== bytes.length) throw new StorageError('Truncated or malformed WebP container.')
    const chunk = ascii(bytes, 12, 4)
    const chunkSize = view.getUint32(16, true)
    if (chunkSize + 20 > bytes.length) throw new StorageError('Invalid WebP chunk length.')
    if (chunk === 'VP8X' && chunkSize >= 10 && bytes.length >= 30) {
      if (((bytes[20] ?? 0) & 0x02) !== 0) throw new StorageError('Animated WebP images are not supported.')
      width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16)
      height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16)
    } else if (chunk === 'VP8 ' && chunkSize >= 10 && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (chunk === 'VP8L' && chunkSize >= 5 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
    } else throw new StorageError('Unsupported WebP image header.')
  } else throw new StorageError('Only actual PNG, JPEG, and non-animated WebP images are supported; SVG/GIF are rejected.')
  assertDimensions(width, height)
  return { mimeType, width, height }
}

export const decodeBrowserImage: ImageDecoder = async blob => {
  if (typeof createImageBitmap === 'function') {
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        settled = true
        reject(new StorageError('Image decoding timed out after 15 seconds. Retry importing the image.'))
      }, 15_000)
      // createImageBitmap cannot be aborted. Keep both handlers attached after a
      // timeout so late rejections are consumed and late bitmaps are always closed.
      const failed = (error: unknown): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new StorageError('Image pixels cannot be decoded; the file may be corrupt.', { cause: error }))
      }
      try {
        void createImageBitmap(blob).then(bitmap => {
          try {
            if (!settled) {
              const dimensions = { width: bitmap.width, height: bitmap.height }
              settled = true
              clearTimeout(timer)
              resolve(dimensions)
            }
          } catch (error) { failed(error) } finally { bitmap.close() }
        }, failed).catch(failed)
      } catch (error) { failed(error) }
    })
  }
  if (typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new StorageError('A browser image decoder is required to verify pixels. This environment cannot safely import images.')
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    const finish = () => { clearTimeout(timer); URL.revokeObjectURL(url); image.onload = null; image.onerror = null }
    const timer = setTimeout(() => { finish(); image.src = ''; reject(new StorageError('Image decoding timed out.')) }, 15_000)
    image.onload = () => { const dimensions = { width: image.naturalWidth, height: image.naturalHeight }; finish(); resolve(dimensions) }
    image.onerror = () => { finish(); reject(new StorageError('Image pixels cannot be decoded; the file may be corrupt.')) }
    image.src = url
  })
}

export async function validateAsset(value: unknown, decoder: ImageDecoder): Promise<AssetRecord> {
  const asset = assetSchema.parse(value)
  const bytes = await blobBytes(asset.blob)
  if (bytes.length !== asset.size || bytes.length > MAX_IMAGE_BYTES) throw new StorageError('Actual image byte length exceeds its declared size or the 10 MiB limit.')
  const header = inspectImageHeader(bytes)
  if (header.mimeType !== asset.mimeType || header.width !== asset.width || header.height !== asset.height) {
    throw new StorageError(`Image ${asset.name}: signature/dimensions do not match its metadata.`)
  }
  if (await hashBytes(bytes) !== asset.sha256) throw new StorageError(`Image ${asset.name}: SHA-256 mismatch; image data is corrupt.`)
  const pixels = await decoder(asset.blob)
  assertDimensions(pixels.width, pixels.height)
  // Some browser decoders apply JPEG EXIF rotation; the encoded pixel count is unchanged.
  const matches = pixels.width === asset.width && pixels.height === asset.height
  const rotatedJpeg = asset.mimeType === 'image/jpeg' && pixels.width === asset.height && pixels.height === asset.width
  if (!matches && !rotatedJpeg) throw new StorageError(`Image ${asset.name}: decoded pixel dimensions differ from the header.`)
  return asset
}

export async function imageFromFile(file: File, role: AssetRole, decoder: ImageDecoder): Promise<AssetRecord> {
  if (!(file instanceof Blob) || file.size < 1 || file.size > MAX_IMAGE_BYTES) throw new StorageError('Select a non-empty image no larger than 10 MiB.')
  const bytes = await blobBytes(file)
  if (bytes.length !== file.size || bytes.length > MAX_IMAGE_BYTES) throw new StorageError('Actual image byte length exceeds its declared size or the 10 MiB limit.')
  const header = inspectImageHeader(bytes)
  if (file.type !== header.mimeType) throw new StorageError('File MIME type does not match its actual PNG/JPEG/WebP signature.')
  const basename = (file.name || 'image').split(/[\\/]/).pop() || 'image'
  const name = Array.from(basename).filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join('').trim().slice(0, 255) || 'image'
  const asset: AssetRecord = {
    id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, createdAt: new Date().toISOString(),
    name, mimeType: header.mimeType, role, size: file.size, width: header.width, height: header.height,
    sha256: await hashBytes(bytes), blob: new Blob([bytes], { type: header.mimeType }),
  }
  return validateAsset(asset, decoder)
}
