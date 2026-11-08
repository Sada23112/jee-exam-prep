import { workspaceController } from '../../../app/workspace-state'
import type { AssetRecord } from '../../../infrastructure/storage/assets'

export interface CropRectangle {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Crops a bounding rectangle from a source canvas or image and saves it
 * as an asset in the workspace asset store.
 */
export async function cropImageToAsset(
  source: CanvasImageSource,
  rect: CropRectangle,
  namePrefix = 'crop',
  role: 'crop' | 'diagram' = 'crop',
): Promise<AssetRecord> {
  const x = Math.max(0, Math.round(rect.x))
  const y = Math.max(0, Math.round(rect.y))
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not create canvas 2D rendering context for cropping.')

  // Fill with white background for transparency safety
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) {
        reject(new Error('Cropped canvas could not be exported to blob.'))
        return
      }
      try {
        const fileName = `${namePrefix}-${Date.now().toString(36)}.png`
        const file = new File([blob], fileName, { type: 'image/png' })
        const asset = await workspaceController.addImage(file, role)
        resolve(asset)
      } catch (err) {
        reject(err)
      }
    }, 'image/png')
  })
}
