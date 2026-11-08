/** Valid 1x1, 8-bit grayscale+alpha PNG; IDAT CRC is efa2a75b (not ef9ad999). */
export function onePixelPng(): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), character => character.charCodeAt(0))
}
