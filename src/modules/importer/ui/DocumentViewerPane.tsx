import { useState, useRef, useEffect, useCallback } from 'react'
import type { MouseEvent } from 'react'
import { cropImageToAsset, type CropRectangle } from '../application/image-cropper'
import type { AssetRecord } from '../../../infrastructure/storage/assets'
import { Icon } from '../../../shared/ui/Icon'
import { useFileDrop } from '../../../shared/ui/use-file-drop'

interface DocumentViewerPaneProps {
  pageCanvas: HTMLCanvasElement | null
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  onCropSaved: (asset: AssetRecord, targetOptionId?: string) => void
  onAttachWholePage: () => void
  isAttachingPage?: boolean
  fileName?: string
  isLoadingDoc?: boolean
  onReattachDocument?: () => void
  onFileDrop?: (file: File) => void
  optionIds?: string[]
}

export function DocumentViewerPane({
  pageCanvas,
  currentPage,
  totalPages,
  onPageChange,
  onCropSaved,
  onAttachWholePage,
  isAttachingPage = false,
  fileName,
  isLoadingDoc = false,
  onReattachDocument,
  onFileDrop,
  optionIds = [],
}: DocumentViewerPaneProps) {
  const displayCanvasRef = useRef<HTMLCanvasElement>(null)
  const [zoom, setZoom] = useState<number>(1.0)
  const [isSelecting, setIsSelecting] = useState(false)
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null)
  const [currentRect, setCurrentRect] = useState<CropRectangle | null>(null)
  const [isCropping, setIsCropping] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)

  const { isDragging: isDraggingDoc, dropProps: docDropProps } = useFileDrop({
    onFiles: files => {
      const file = files[0]
      if (file && onFileDrop) onFileDrop(file)
    },
    accept: ['.pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
    disabled: !onFileDrop,
  })

  // Redraw source canvas to display canvas whenever source canvas or zoom changes
  useEffect(() => {
    if (!pageCanvas || !displayCanvasRef.current) return
    const display = displayCanvasRef.current
    display.width = pageCanvas.width
    display.height = pageCanvas.height
    const ctx = display.getContext('2d')
    if (ctx) {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, display.width, display.height)
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

  const handleCropSave = async (targetOptionId?: string) => {
    if (!pageCanvas || !currentRect) return
    setIsCropping(true)
    setCropError(null)
    try {
      const name = targetOptionId ? `p${currentPage}-crop-option-${targetOptionId}` : `p${currentPage}-crop`
      const asset = await cropImageToAsset(pageCanvas, currentRect, name, 'diagram')
      onCropSaved(asset, targetOptionId)
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
    <div className={`doc-viewer-pane ${isDraggingDoc ? 'is-dragging-doc' : ''}`} {...docDropProps}>
      {isDraggingDoc && (
        <div className="viewer-drop-overlay">
          <Icon name="upload" size={36} />
          <strong>Drop PDF or image to attach document</strong>
        </div>
      )}
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
          {onReattachDocument && (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={onReattachDocument}
              title="Re-attach or replace the PDF document file"
            >
              Re-attach PDF
            </button>
          )}
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
        {isLoadingDoc ? (
          <div className="viewer-placeholder-card">
            <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto 12px auto' }} />
            <p>Rendering document preview…</p>
          </div>
        ) : !pageCanvas ? (
          <div className="viewer-placeholder-card">
            <div className="placeholder-icon-wrap" style={{ marginBottom: 12 }}>
              <Icon name="bank" size={32} />
            </div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: 16 }}>Document Preview Not Loaded</h4>
            <p style={{ margin: '0 0 8px 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
              Your {totalPages ? `${totalPages}-page session with all questions and verified answer keys` : 'questions and answer keys'} are safely preserved in browser memory.
            </p>
            <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: 13, lineHeight: 1.5 }}>
              To view, zoom, and crop diagrams from the PDF again, re-attach <strong>{fileName || 'the PDF document'}</strong>.
            </p>
            {onReattachDocument && (
              <button
                type="button"
                className="button button-primary"
                onClick={onReattachDocument}
              >
                Re-attach Document File
              </button>
            )}
          </div>
        ) : (
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
                    onClick={() => handleCropSave()}
                    disabled={isCropping}
                    title="Attach cropped diagram to question prompt"
                  >
                    {isCropping ? 'Cropping…' : 'Crop Prompt'}
                  </button>
                  {optionIds && optionIds.length > 0 && (
                    <div className="crop-opt-group">
                      <span className="crop-opt-label">Option:</span>
                      {optionIds.map(optId => (
                        <button
                          key={optId}
                          type="button"
                          className="button button-secondary button-small crop-opt-btn"
                          onClick={() => handleCropSave(optId)}
                          disabled={isCropping}
                          title={`Crop directly for Option ${optId}`}
                        >
                          {optId}
                        </button>
                      ))}
                    </div>
                  )}
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
        )}
      </div>
    </div>
  )
}
