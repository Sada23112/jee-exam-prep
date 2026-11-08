import * as pdfjsLib from 'pdfjs-dist'
import { workspaceController } from '../../../app/workspace-state'
import type { AssetRecord } from '../../../infrastructure/storage/assets'

// Configure worker URL for Vite environment
if (typeof window !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString()
}

export interface RenderedPdfPage {
  pageNumber: number
  width: number
  height: number
  canvas: HTMLCanvasElement
  text: string
}

export interface LoadedPdfDocument {
  numPages: number
  getPage: (pageNumber: number) => Promise<pdfjsLib.PDFPageProxy>
  destroy: () => Promise<void>
}

/**
 * Loads a PDF document from an ArrayBuffer.
 */
export async function loadPdfDocument(data: ArrayBuffer): Promise<LoadedPdfDocument> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    useSystemFonts: true,
  })
  const pdfDoc = await loadingTask.promise

  return {
    numPages: pdfDoc.numPages,
    getPage: (pageNumber: number) => pdfDoc.getPage(pageNumber),
    destroy: () => loadingTask.destroy(),
  }
}

/**
 * Extracts plain text from a PDF page, sorting text items by reading order
 * (top-to-bottom, left-to-right).
 */
export async function extractTextFromPdfPage(page: pdfjsLib.PDFPageProxy): Promise<string> {
  const textContent = await page.getTextContent()
  const items = textContent.items as Array<{
    str?: string
    transform?: number[]
    width?: number
    height?: number
  }>

  // Sort items primarily by Y descending (top to bottom), then X ascending (left to right)
  const sorted = [...items]
    .filter(item => item.str && item.str.trim().length > 0 && Array.isArray(item.transform))
    .sort((a, b) => {
      const yA = a.transform![5] ?? 0
      const yB = b.transform![5] ?? 0
      const diffY = yB - yA // higher Y is higher on page in PDF coordinate system
      if (Math.abs(diffY) > 6) {
        return diffY
      }
      const xA = a.transform![4] ?? 0
      const xB = b.transform![4] ?? 0
      return xA - xB
    })

  let result = ''
  let lastY: number | null = null

  for (const item of sorted) {
    const currentY = item.transform![5] ?? 0
    if (lastY !== null && Math.abs(lastY - currentY) > 8) {
      result += '\n'
    } else if (result.length > 0 && !result.endsWith('\n') && !result.endsWith(' ')) {
      result += ' '
    }
    result += item.str
    lastY = currentY
  }

  return result
}

/**
 * Renders a PDF page onto an HTMLCanvasElement with high DPI scaling.
 */
export async function renderPdfPageToCanvas(
  page: pdfjsLib.PDFPageProxy,
  scale = 1.5,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not get 2D canvas context.')

  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  }).promise

  return canvas
}

/**
 * Converts a Canvas to a PNG Blob and saves it into the Workspace asset store.
 */
export async function saveCanvasAsAsset(
  canvas: HTMLCanvasElement,
  fileName: string,
  role: 'page' | 'crop' | 'diagram',
): Promise<AssetRecord> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) {
        reject(new Error('Canvas could not be converted to image blob.'))
        return
      }
      try {
        const file = new File([blob], fileName, { type: 'image/png' })
        const asset = await workspaceController.addImage(file, role)
        resolve(asset)
      } catch (err) {
        reject(err)
      }
    }, 'image/png')
  })
}
