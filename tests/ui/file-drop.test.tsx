// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, fireEvent, renderHook, act } from '@testing-library/react'
import { useFileDrop } from '../../src/shared/ui/use-file-drop'

afterEach(cleanup)

describe('useFileDrop hook', () => {
  it('manages isDragging counter properly across nested drag enter/leave events', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() => useFileDrop({ onFiles }))

    expect(result.current.isDragging).toBe(false)

    // Drag enter parent
    act(() => {
      result.current.dropProps.onDragEnter({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { items: [{ kind: 'file', type: 'application/pdf' }] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragging).toBe(true)

    // Drag enter nested child (counter becomes 2)
    act(() => {
      result.current.dropProps.onDragEnter({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { items: [{ kind: 'file', type: 'application/pdf' }] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragging).toBe(true)

    // Drag leave nested child (counter becomes 1, still dragging)
    act(() => {
      result.current.dropProps.onDragLeave({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragging).toBe(true)

    // Drag leave parent (counter becomes 0, isDragging becomes false)
    act(() => {
      result.current.dropProps.onDragLeave({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragging).toBe(false)
  })

  it('filters files based on accept list (MIME types and extensions)', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() =>
      useFileDrop({
        onFiles,
        accept: ['.pdf', 'image/*'],
      })
    )

    const pdfFile = new File(['dummy pdf'], 'sample.pdf', { type: 'application/pdf' })
    const pngFile = new File(['dummy png'], 'photo.png', { type: 'image/png' })
    const txtFile = new File(['dummy txt'], 'notes.txt', { type: 'text/plain' })

    act(() => {
      result.current.dropProps.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [pdfFile, pngFile, txtFile],
        },
      } as unknown as React.DragEvent)
    })

    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles).toHaveBeenCalledWith([pdfFile, pngFile])
    expect(result.current.isDragging).toBe(false)
  })

  it('does not trigger onFiles or drag state when disabled', () => {
    const onFiles = vi.fn()
    const { result } = renderHook(() =>
      useFileDrop({
        onFiles,
        disabled: true,
      })
    )

    act(() => {
      result.current.dropProps.onDragEnter({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: { items: [{ kind: 'file' }] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.isDragging).toBe(false)

    act(() => {
      result.current.dropProps.onDrop({
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        dataTransfer: {
          files: [new File(['dummy'], 'test.pdf', { type: 'application/pdf' })],
        },
      } as unknown as React.DragEvent)
    })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('renders a dropzone component and handles drag-over and drop events in DOM', () => {
    const onFiles = vi.fn()

    function TestDropzone() {
      const { isDragging, dropProps } = useFileDrop({ onFiles, accept: ['image/*'] })
      return (
        <div data-testid="drop-target" className={isDragging ? 'is-dragging' : ''} {...dropProps}>
          <span>Drop file here</span>
        </div>
      )
    }

    const { getByTestId } = render(<TestDropzone />)
    const element = getByTestId('drop-target')

    expect(element.classList.contains('is-dragging')).toBe(false)

    fireEvent.dragEnter(element, {
      dataTransfer: { items: [{ kind: 'file', type: 'image/jpeg' }] },
    })
    expect(element.classList.contains('is-dragging')).toBe(true)

    const preventDefault = vi.fn()
    const dataTransfer = { dropEffect: 'none' }
    fireEvent.dragOver(element, { preventDefault, dataTransfer })
    expect(dataTransfer.dropEffect).toBe('copy')

    const file = new File(['image data'], 'diagram.png', { type: 'image/png' })
    fireEvent.drop(element, {
      dataTransfer: { files: [file] },
    })

    expect(element.classList.contains('is-dragging')).toBe(false)
    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
