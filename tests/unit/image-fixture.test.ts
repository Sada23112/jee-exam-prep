import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { onePixelPng } from '../fixtures/png'

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

describe('original PNG test fixture', () => {
  it('has valid CRCs for every chunk and a decodable 1px grayscale-alpha scanline', () => {
    const bytes = onePixelPng()
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    const chunks: string[] = []
    let cursor = 8
    while (cursor < bytes.length) {
      const size = view.getUint32(cursor)
      const type = new TextDecoder().decode(bytes.slice(cursor + 4, cursor + 8))
      expect(view.getUint32(cursor + 8 + size)).toBe(crc32(bytes.slice(cursor + 4, cursor + 8 + size)))
      if (type === 'IHDR') {
        expect(view.getUint32(cursor + 8)).toBe(1)
        expect(view.getUint32(cursor + 12)).toBe(1)
        expect([...bytes.slice(cursor + 16, cursor + 21)]).toEqual([8, 4, 0, 0, 0])
      }
      if (type === 'IDAT') {
        expect(view.getUint32(cursor + 8 + size)).toBe(0xefa2a75b)
        const pixels = inflateSync(bytes.slice(cursor + 8, cursor + 8 + size))
        expect([...pixels]).toEqual([1, 255, 255]) // Sub filter; first/only white pixel, opaque alpha.
      }
      chunks.push(type)
      cursor += size + 12
    }
    expect(cursor).toBe(bytes.length)
    expect(chunks).toEqual(['IHDR', 'IDAT', 'IEND'])
  })
})
