import { describe, expect, it } from 'vitest'
import { calculateWorkspaceBudget, estimateBackupEnvelopeBytes, estimateJsonUtf8 } from '../../src/infrastructure/storage/budget'
import type { WorkspaceData } from '../../src/infrastructure/storage/validation'
import { canonical } from '../../src/infrastructure/storage/validation'
import { createEmptyQuestionDraft } from '../../src/modules/question-bank/domain/question'
import { onePixelPng } from '../fixtures/png'

function empty(): WorkspaceData { return { questions: [], questionVersions: [], collections: [], presets: [], history: [], assets: [] } }
const time = '2026-01-01T00:00:00.000Z'
function metadata() {
  return { id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, revision: 1, createdAt: time, updatedAt: time, deletedAt: null, remoteRevision: null }
}
function utf8(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).length }

function encodedPayload(data: WorkspaceData) {
  return { ...data, assets: data.assets.map(({ blob, ...asset }) => ({ ...asset, base64: Buffer.from(new Uint8Array(blob.size)).toString('base64') })) }
}

describe('exact deterministic JSON UTF-8 and encoded-envelope accounting', () => {
  it.each([
    '', 'ASCII', '"\\\b\t\n\f\r\u0000\u001f', 'é Ω हिंदी 数学', '😀𐐀', '\ud800', '\udc00', '\ud800x\udc00', '\u2028\u2029',
    null, true, false, 0, -0, 1.2345, 1e-7, 1e21, Number.MAX_SAFE_INTEGER, [1, 'é', null],
    { '"\\😀': ['\n\ud800', { inner: '数学', number: 12 }] },
  ])('matches JSON.stringify UTF-8 exactly for %j', value => {
    expect(estimateJsonUtf8(value).bytes).toBe(utf8(value))
    expect(estimateJsonUtf8(value).bytes).toBe(new TextEncoder().encode(canonical(value)).length)
    expect(() => estimateJsonUtf8(value, utf8(value))).not.toThrow()
    expect(() => estimateJsonUtf8(value, utf8(value) - 1)).toThrow(/encoded size limit/i)
  })
  it('matches all UTF-16 code units, escaping controls and lone surrogates but encoding real pairs', () => {
    const text = Array.from({ length: 65_536 }, (_, index) => String.fromCharCode(index)).join('')
    const value = { text, pairs: '\ud800\udc00\udbff\udfff' }
    expect(estimateJsonUtf8(value).bytes).toBe(utf8(value))
  })
  it('rejects non-JSON values rather than undercounting omitted or transformed data', () => {
    for (const value of [undefined, NaN, Infinity, () => 1, new Date(), new Blob(), { item: undefined }]) expect(() => estimateJsonUtf8(value)).toThrow()
  })
  it.each([1, 2, 3, 4, 68, 69, 70])('counts canonical base64 padding and metadata exactly for a %i-byte asset', size => {
    const asset = {
      id: crypto.randomUUID(), schemaVersion: 1 as const, ownerId: null, createdAt: time, name: '数学 😀 "original".png',
      mimeType: 'image/png' as const, role: 'page' as const, size, width: 1, height: 1, sha256: '0'.repeat(64),
      blob: new Blob([new Uint8Array(size)], { type: 'image/png' }),
    }
    const data = { ...empty(), assets: [asset] }
    const envelope = { format: 'jee-cbt-backup', version: 1, exportedAt: time, checksum: { algorithm: 'SHA-256', value: 'a'.repeat(64) }, payload: encodedPayload(data) }
    expect(estimateBackupEnvelopeBytes(data, time, envelope.checksum)).toBe(utf8(envelope))
    expect(calculateWorkspaceBudget(data).encodedBytes).toBe(utf8(envelope) + 3)
    expect(calculateWorkspaceBudget(data).nodes).toBe(estimateJsonUtf8(envelope).nodes)
    expect(calculateWorkspaceBudget(data).imageBytes).toBe(size)
  })
  it('includes every row, tombstone, immutable revision, history snapshot and header/checksum exactly', () => {
    const first = { ...metadata(), ...createEmptyQuestionDraft(), prompt: '  हिंदी 😀 "x"\\\n', solution: '\u0000\ud800' }
    const current = { ...first, revision: 2, deletedAt: time }
    const rules = {
      ...metadata(), familyId: crypto.randomUUID(), version: 1, name: 'Rules', description: 'é', durationMinutes: 60, subjects: ['Physics' as const],
      questionOrder: 'original' as const, navigation: 'free' as const, resumePolicy: 'continue-deadline' as const, multipleCorrectPolicy: 'exact-set' as const,
      marking: { 'single-correct': { correct: 4, incorrect: -1, unattempted: 0 }, 'multiple-correct': { correct: 4, incorrect: -2, unattempted: 0 }, numerical: { correct: 4, incorrect: 0, unattempted: 0 } },
    }
    const size = onePixelPng().length
    const data: WorkspaceData = {
      questions: [current], questionVersions: [first, current],
      collections: [{ ...metadata(), name: 'Archived 数学', description: '\n', questionIds: [first.id], deletedAt: time }],
      presets: [rules, { ...rules, id: crypto.randomUUID(), version: 2 }],
      history: [{ ...metadata(), name: 'Actual snapshot', presetSnapshot: rules, questionSnapshots: [first], startedAt: time, deadlineAt: '2026-01-01T01:00:00.000Z', submittedAt: null, status: 'in-progress', responses: [], totalScore: null }],
      assets: [{ id: crypto.randomUUID(), schemaVersion: 1, ownerId: null, createdAt: time, name: 'source.png', role: 'page', mimeType: 'image/png', size, width: 1, height: 1, sha256: '0'.repeat(64), blob: new Blob([onePixelPng()], { type: 'image/png' }) }],
    }
    const envelope = { format: 'jee-cbt-backup', version: 1, exportedAt: time, checksum: { algorithm: 'SHA-256', value: '0'.repeat(64) }, payload: encodedPayload(data) }
    expect(estimateBackupEnvelopeBytes(data, time)).toBe(utf8(envelope))
    expect(calculateWorkspaceBudget(data)).toMatchObject({ encodedBytes: utf8(envelope) + 3, imageBytes: size, nodes: estimateJsonUtf8(envelope).nodes, counts: { questions: 1, questionVersions: 2, collections: 1, presets: 2, history: 1, assets: 1 } })
    expect(estimateBackupEnvelopeBytes(data, '+010000-01-01T00:00:00.000Z')).toBe(calculateWorkspaceBudget(data).encodedBytes)
  })
})
