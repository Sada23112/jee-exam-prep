export interface ParsedAnswerItem {
  questionNumber: string
  answerRaw: string
  optionIds: string[]
  numericalValue: string | null
  confidence: 'high' | 'medium' | 'ambiguous'
  notes?: string
}

export interface AnswerKeyParseResult {
  items: ParsedAnswerItem[]
  unmatchedLines: string[]
  totalParsed: number
}

/**
 * Normalizes option identifiers: converts 1->A, 2->B, 3->C, 4->D if applicable,
 * or standardizes A, B, C, D letters.
 */
function normalizeOptionLetter(token: string): string | null {
  const clean = token.trim().toUpperCase()
  if (/^[A-D]$/.test(clean)) return clean
  if (clean === '1') return 'A'
  if (clean === '2') return 'B'
  if (clean === '3') return 'C'
  if (clean === '4') return 'D'
  return null
}

/**
 * Parses raw answer key text into structured items.
 * Supports line formats such as:
 * "1. A"
 * "Q1: B"
 * "23 - 42.5"
 * "14: (C)"
 * "5. A, C"
 * "Q. 25 = 120"
 * "1, B"
 */
export function parseAnswerKeyText(rawText: string): AnswerKeyParseResult {
  const lines = rawText.split(/\r?\n/)
  const items: ParsedAnswerItem[] = []
  const unmatchedLines: string[] = []

  // Regex patterns:
  // e.g. "Q. 1 : A" or "1. B" or "1 - 45.2" or "Q1 = 3"
  const linePattern = /^(?:Q(?:uestion)?\.?\s*)?(\d+)\s*(?:[.:\t=,-]|->|\))\s*([^\r\n]+)$/i

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
      continue
    }

    const match = linePattern.exec(trimmed)
    if (!match) {
      unmatchedLines.push(trimmed)
      continue
    }

    const qNum = match[1]!
    const rawVal = match[2]!.trim()

    // Check if it's multiple options like "A, C" or "A,B"
    const commaSplit = rawVal.split(/[,\s]+/).filter(Boolean)
    const possibleLetters = commaSplit.map(normalizeOptionLetter).filter((l): l is string => l !== null)

    if (possibleLetters.length > 0 && possibleLetters.length === commaSplit.length) {
      items.push({
        questionNumber: qNum,
        answerRaw: rawVal,
        optionIds: possibleLetters,
        numericalValue: null,
        confidence: 'high',
      })
      continue
    }

    // Check single letter with parentheses like "(A)" or "(1)"
    const parenMatch = /^\(?([A-Da-d1-4])\)?$/.exec(rawVal)
    if (parenMatch) {
      const normalized = normalizeOptionLetter(parenMatch[1]!)
      if (normalized) {
        items.push({
          questionNumber: qNum,
          answerRaw: rawVal,
          optionIds: [normalized],
          numericalValue: null,
          confidence: 'high',
        })
        continue
      }
    }

    // Check if numerical decimal value: e.g. "45", "-2.5", "120"
    const cleanNum = rawVal.replace(/[^\d.-]/g, '')
    if (/^-?\d+(?:\.\d+)?$/.test(cleanNum)) {
      items.push({
        questionNumber: qNum,
        answerRaw: rawVal,
        optionIds: [],
        numericalValue: cleanNum,
        confidence: 'high',
      })
      continue
    }

    // Ambiguous or complex line
    items.push({
      questionNumber: qNum,
      answerRaw: rawVal,
      optionIds: [],
      numericalValue: null,
      confidence: 'ambiguous',
      notes: `Could not parse authoritative choice or number from "${rawVal}".`,
    })
  }

  return {
    items,
    unmatchedLines,
    totalParsed: items.length,
  }
}
