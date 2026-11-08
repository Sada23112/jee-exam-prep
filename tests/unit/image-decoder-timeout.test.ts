import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeBrowserImage, imageFromFile } from '../../src/infrastructure/storage/assets'
import { onePixelPng } from '../fixtures/png'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function bitmap() { return { width: 1, height: 1, close: vi.fn() } as unknown as ImageBitmap }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bounded browser bitmap decoding', () => {
  it('returns decoded dimensions and closes successful bitmaps without leaving a timer', async () => {
    vi.useFakeTimers()
    const result = bitmap()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(result))
    await expect(decodeBrowserImage(new Blob())).resolves.toEqual({ width: 1, height: 1 })
    expect(result.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects after 15 seconds and closes a late bitmap rather than leaking pixel memory', async () => {
    vi.useFakeTimers()
    const decode = deferred<ImageBitmap>()
    vi.stubGlobal('createImageBitmap', vi.fn(() => decode.promise))
    const pending = decodeBrowserImage(new Blob())
    const rejection = expect(pending).rejects.toThrow(/timed out.*15 seconds.*Retry/i)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await rejection
    const late = bitmap()
    decode.resolve(late)
    await Promise.resolve()
    expect(late.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('consumes late decoder rejections after timeout without an unhandled promise', async () => {
    vi.useFakeTimers()
    const decode = deferred<ImageBitmap>()
    vi.stubGlobal('createImageBitmap', vi.fn(() => decode.promise))
    const pending = decodeBrowserImage(new Blob())
    const rejection = expect(pending).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    decode.reject(new Error('late corrupt pixels'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('handles synchronous and asynchronous decoder failures and clears their timers', async () => {
    vi.useFakeTimers()
    for (const create of [() => { throw new Error('sync failure') }, () => Promise.reject(new Error('async failure'))]) {
      vi.stubGlobal('createImageBitmap', vi.fn(create))
      await expect(decodeBrowserImage(new Blob())).rejects.toThrow(/pixels cannot be decoded/i)
      expect(vi.getTimerCount()).toBe(0)
    }
  })
  it('rejects an original image before imageFromFile can return an asset when bitmap decoding hangs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const decode = deferred<ImageBitmap>()
    const create = vi.fn(() => decode.promise)
    vi.stubGlobal('createImageBitmap', create)
    const pending = imageFromFile(new File([onePixelPng()], 'source.png', { type: 'image/png' }), 'page', decodeBrowserImage)
    const rejection = expect(pending).rejects.toThrow(/timed out/i)
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    await vi.advanceTimersByTimeAsync(15_000)
    await rejection
    const late = bitmap()
    decode.resolve(late)
    await Promise.resolve()
    expect(late.close).toHaveBeenCalledTimes(1)
  })
})
