import { describe, it, expect } from 'vitest'
import { parseAnswerKeyText } from '../../src/modules/importer/domain/answer-key-parser'
import {
  extractQuestionBlocksFromText,
  parseDocumentPagesToDrafts,
} from '../../src/modules/importer/domain/rule-based-parser'
import { validateImportedQuestionForBank, createEmptyImportedQuestion } from '../../src/modules/importer/domain/import-session'

describe('Answer Key Parser', () => {
  it('parses single option letters in standard formats', () => {
    const raw = `
      1. A
      Q2: B
      3 - (C)
      Q. 4 = D
      5, (2)
    `
    const result = parseAnswerKeyText(raw)
    expect(result.totalParsed).toBe(5)
    expect(result.items[0]).toMatchObject({ questionNumber: '1', optionIds: ['A'], numericalValue: null, confidence: 'high' })
    expect(result.items[1]).toMatchObject({ questionNumber: '2', optionIds: ['B'] })
    expect(result.items[2]).toMatchObject({ questionNumber: '3', optionIds: ['C'] })
    expect(result.items[3]).toMatchObject({ questionNumber: '4', optionIds: ['D'] })
    expect(result.items[4]).toMatchObject({ questionNumber: '5', optionIds: ['B'] }) // 2 maps to B
  })

  it('parses numerical decimal values', () => {
    const raw = `
      21. 45
      Q22: -3.14
      23 -> 120
    `
    const result = parseAnswerKeyText(raw)
    expect(result.totalParsed).toBe(3)
    expect(result.items[0]).toMatchObject({ questionNumber: '21', numericalValue: '45', optionIds: [] })
    expect(result.items[1]).toMatchObject({ questionNumber: '22', numericalValue: '-3.14' })
    expect(result.items[2]).toMatchObject({ questionNumber: '23', numericalValue: '120' })
  })

  it('parses multiple choice comma-separated letters', () => {
    const raw = `
      14. A, C
      Q15: B, D
    `
    const result = parseAnswerKeyText(raw)
    expect(result.totalParsed).toBe(2)
    expect(result.items[0]?.optionIds).toEqual(['A', 'C'])
    expect(result.items[1]?.optionIds).toEqual(['B', 'D'])
  })

  it('flags ambiguous lines without throwing', () => {
    const raw = `
      1. Not clear answer
      # Comment line
      Invalid line without question number
    `
    const result = parseAnswerKeyText(raw)
    expect(result.totalParsed).toBe(1)
    expect(result.items[0]?.confidence).toBe('ambiguous')
    expect(result.unmatchedLines.length).toBe(1)
  })
})

describe('Rule-Based Question Document Parser', () => {
  it('extracts question blocks and switches subjects', () => {
    const pages = [
      {
        pageNumber: 1,
        text: `
          SECTION A: PHYSICS
          1. A block of mass $m = 2\\text{ kg}$ is placed on a rough surface.
          (A) 10 N
          (B) 20 N
          (C) 30 N
          (D) 40 N

          2. Find the electrostatic potential at the origin.
          (A) $V_0$
          (B) $2V_0$
          (C) $3V_0$
          (D) $0$
        `,
      },
      {
        pageNumber: 2,
        text: `
          SECTION B: CHEMISTRY
          3. The hybridisation of $XeF_4$ is:
          (A) $sp^3$
          (B) $dsp^2$
          (C) $sp^3d^2$
          (D) $sp^3d$
        `,
      },
    ]

    const blocks = extractQuestionBlocksFromText(pages)
    expect(blocks.length).toBe(3)
    expect(blocks[0]?.subject).toBe('Physics')
    expect(blocks[0]?.sourceQuestionNumber).toBe('1')
    expect(blocks[2]?.subject).toBe('Chemistry')
    expect(blocks[2]?.sourceQuestionNumber).toBe('3')
  })

  it('parses single-correct questions with options', () => {
    const drafts = parseDocumentPagesToDrafts([
      {
        pageNumber: 1,
        text: `
          1. A particle moves with velocity $v = 3t^2$.
          (A) $6t$
          (B) $3t$
          (C) $9t^2$
          (D) $0$
        `,
      },
    ])

    expect(drafts.length).toBe(1)
    const q = drafts[0]!
    expect(q.type).toBe('single-correct')
    expect(q.prompt).toContain('particle moves with velocity')
    expect(q.options.length).toBe(4)
    expect(q.options[0]?.text).toContain('6t')
    expect(q.verification).toBe('needs-review')
    expect(q.answerVerification).toBe('needs-review')
  })

  it('detects numerical questions when no options exist', () => {
    const drafts = parseDocumentPagesToDrafts([
      {
        pageNumber: 1,
        text: `
          25. An ideal gas undergoes isothermal expansion. Find the work done in Joules to the nearest integer.
        `,
      },
    ])

    expect(drafts.length).toBe(1)
    const q = drafts[0]!
    expect(q.type).toBe('numerical')
    expect(q.options.length).toBe(0)
    expect(q.prompt).toContain('isothermal expansion')
  })
})

describe('Imported Question Verification Gate', () => {
  it('rejects verification if prompt is empty or answer key missing', () => {
    const q = createEmptyImportedQuestion(1, '1', 'Physics')
    q.prompt = ''
    q.verification = 'verified'

    const check = validateImportedQuestionForBank(q)
    expect(check.valid).toBe(false)
    expect(check.errors.some(e => e.includes('prompt cannot be empty'))).toBe(true)
  })

  it('allows verification when prompt, options, and key are complete', () => {
    const q = createEmptyImportedQuestion(1, '1', 'Physics')
    q.prompt = 'What is the velocity?'
    q.options = [
      { id: 'A', text: '10 m/s' },
      { id: 'B', text: '20 m/s' },
      { id: 'C', text: '30 m/s' },
      { id: 'D', text: '40 m/s' },
    ]
    q.correctOptionIds = ['B']
    q.answerVerification = 'verified'
    q.verification = 'verified'

    const check = validateImportedQuestionForBank(q)
    expect(check.valid).toBe(true)
    expect(check.errors).toEqual([])
  })
})
