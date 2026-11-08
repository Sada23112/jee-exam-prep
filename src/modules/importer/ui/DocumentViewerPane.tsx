import { useState, useRef, useEffect, useCallback } from 'react'
import type { MouseEvent } from 'react'
import { cropImageToAsset, type CropRectangle } from '../application/image-cropper'
import type { AssetRecord } from '../../../infrastructure/storage/assets'
import { Icon } from '../../../shared/ui/Icon'

interface DocumentViewerPaneProps {
  pageCanvas: HTMLCanvasElement | null
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onCropSaved: (asset: AssetRecord) => void
  onAttachWholePage: () => void
  isAttachingPage?: boolean
}

export function DocumentViewerPane({
  pageCanvas,
  currentPage,
  totalPages,
  onPageChange,
  onCropSaved,
  onAttachWholePage,
  isAttachingPage = false,
}: DocumentViewerPaneProps) {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState<number>(1.0)
  const [isSelecting, setIsSelecting] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)
  const [currentRect, setCurrentRect] = useState<CropRectangle | null>(null)
  const [isCropping, setIsCropping] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)

  // Redraw source canvas to display canvas whenever source canvas or zoom changes
  useEffect(() => {
    if (!pageCanvas || !displayCanvasRef.current) return
    const display = displayCanvasRef.current
    display.width = pageCanvas.width
    display.height = pageCanvas.height
    const ctx = display.getContext('2d')
    if (ctx) {
      ctx.drawImage(pageCanvas, 0, 0)
    }
    // Clear any active crop selection when page changes
    setCurrentRect(null)
    setCropError(null)
  }, [pageCanvas, currentPage])

  const getCanvasCoordinates = useCallback((e: MouseEvent<HTMLCanvasElement>) => {
    const canvas = displayCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }, [])

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!pageCanvas || isCropping) return
    const coords = getCanvasCoordinates(e)
    setStartPoint(coords)
    setIsSelecting(true)
    setCurrentRect(null)
    setCropError(null)
  }

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isSelecting || !startPoint || !pageCanvas) return
    const coords = getCanvasCoordinates(e)
    const x = Math.min(startPoint.x, coords.x)
    const y = Math.min(startPoint.y, coords.y)
    const width = Math.abs(coords.x - startPoint.x)
    const height = Math.abs(coords.y - startPoint.y)

    setCurrentRect({ x, y, width, height })
  }

  const handleMouseUp = () => {
    if (!isSelecting) return
    setIsSelecting(false)
    if (currentRect && (currentRect.width < 10 || currentRect.height < 10)) {
      // Too small to be an intentional crop
      setCurrentRect(null)
    }
  }

  const handleCropSave = async () => {
    if (!pageCanvas || !currentRect) return
    setIsCropping(true)
    setCropError(null)
    try {
      const asset = await cropImageToAsset(pageCanvas, currentRect, `p${currentPage}-crop`, 'diagram')
      onCropSaved(asset)
      setCurrentRect(null)
    } catch (err) {
      setCropError(err instanceof Error ? err.message : 'Failed to crop image.')
    } finally {
      setIsCropping(false)
    }
  }

  // Calculate percentage-based positioning for selection box
  const getSelectionBoxStyle = () => {
    if (!currentRect || !pageCanvas || pageCanvas.width === 0 || pageCanvas.height === 0) return { display: 'none' }
    return {
      left: `${(currentRect.x / pageCanvas.width) * 100}%`,
      top: `${(currentRect.y / pageCanvas.height) * 100}%`,
      width: `${(currentRect.width / pageCanvas.width) * 100}%`,
      height: `${(currentRect.height / pageCanvas.height) * 100}%`,
    }
  }

  return (
    <div className="doc-viewer-pane">
      <div className="viewer-toolbar">
        <div className="viewer-pagination">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            ← Previous
          </button>
          <span className="page-indicator">
            Page <strong>{currentPage}</strong> of <strong>{totalPages || 1}</strong>
          </span>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>

        <div className="viewer-zoom">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setZoom(z => Math.max(0.5, Number((z - 0.2).toFixed(1))))}
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="zoom-value">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setZoom(z => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => setZoom(1.0)}
          >
            Reset
          </button>
        </div>

        <div className="viewer-actions">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={onAttachWholePage}
            disabled={!pageCanvas || isAttachingPage}
          >
            {isAttachingPage ? 'Attaching…' : 'Attach Page'}
          </button>
        </div>
      </div>

      <div className="viewer-instructions">
        <Icon name="search" size={14} />
        <span>Click and drag on the page below to crop diagrams or equations.</span>
      </div>

      {cropError && <div className="crop-error-notice">{cropError}</div>}

      <div className="canvas-scroll-container">
        <div
          className="canvas-wrapper"
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'top center',
          }}
        >
          <canvas
            ref={displayCanvasRef}
            className="source-document-canvas"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          />

          {currentRect && (
            <div className="crop-selection-box" style={getSelectionBoxStyle()}>
              <div className="crop-toolbar">
                <button
                  type="button"
                  className="button button-primary button-small crop-action-btn"
                  onClick={handleCropSave}
                  disabled={isCropping}
                >
                  {isCropping ? 'Cropping…' : 'Crop Diagram'}
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small crop-action-btn"
                  onClick={() => setCurrentRect(null)}
                  disabled={isCropping}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
