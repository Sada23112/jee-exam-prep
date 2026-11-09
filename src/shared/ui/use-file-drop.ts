import { useState, useRef, useCallback } from 'react'
import type { DragEvent } from 'react'

export interface UseFileDropOptions {
  onFiles: (files: File[]) => void
  accept?: string[] // e.g. ['.pdf', 'image/png', 'image/jpeg', 'image/webp'] or ['image/*']
  disabled?: boolean
}

export function useFileDrop({ onFiles, accept, disabled = false }: UseFileDropOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounter = useRef(0)

  const matchesAccept = useCallback((file: File) => {
    if (!accept || accept.length === 0) return true
    return accept.some(pattern => {
      const lowerPattern = pattern.toLowerCase()
      if (lowerPattern.startsWith('.')) {
        return file.name.toLowerCase().endsWith(lowerPattern)
      }
      if (lowerPattern.endsWith('/*')) {
        const prefix = lowerPattern.slice(0, -1)
        return file.type.toLowerCase().startsWith(prefix)
      }
      return file.type.toLowerCase() === lowerPattern
    })
  }, [accept])

  const onDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }, [disabled])

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    e.dataTransfer.dropEffect = 'copy'
  }, [disabled])

  const onDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabled) return
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setIsDragging(false)
    }
  }, [disabled])

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current = 0
    setIsDragging(false)
    if (disabled) return

    const droppedFiles = Array.from(e.dataTransfer.files)
    const validFiles = accept ? droppedFiles.filter(matchesAccept) : droppedFiles
    if (validFiles.length > 0) {
      onFiles(validFiles)
    }
  }, [disabled, accept, matchesAccept, onFiles])

  return {
    isDragging,
    dropProps: {
      onDragEnter,
      onDragOver,
      onDragLeave,
      onDrop,
    },
  }
}
