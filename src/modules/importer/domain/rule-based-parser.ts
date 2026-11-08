import type { Subject } from '../../question-bank/domain/question'
import { createEmptyImportedQuestion, type ImportedQuestionDraft } from './import-session'

interface RawQuestionBlock {
  sourceQuestionNumber: string
  subject: Subject
  pageNumber: number
  text: string
}

const SUBJECT_HEADER_REGEX = /(?:SECTION\s*[-–—:]?\s*[A-Z0-9]*\s*[-–—:]?\s*)?(PHYSICS|CHEMISTRY|MATHEMATICS)/i

/**
 * Splits document text across pages into question blocks using regex boundaries.
 */
export function extractQuestionBlocksFromText(
  pages: Array<{ pageNumber: number; text: string }>,
): RawQuestionBlock[] {
  let currentSubject: Subject = 'Physics'
  const blocks: RawQuestionBlock[] = []

  // Question starter:
  // e.g. "Q. 1", "Question 25", "1.", "Q1:", "[15]" at the start of a line or paragraph
  const qStartRegex = /(?:^|\n)\s*(?:Q(?:uestion)?\.?\s*(\d+)|(\d+)\.(?!\d)|\[(\d+)\]|\((\d+)\))\s*[:\-.]?\s*/gi

  for (const page of pages) {
    const lines = page.text.split(/\r?\n/)
    let pageTextWithoutHeaders = ''

    for (const line of lines) {
      const subjectMatch = SUBJECT_HEADER_REGEX.exec(line)
      if (subjectMatch) {
        const sub = subjectMatch[1]!.toUpperCase()
        if (sub.includes('PHYS')) currentSubject = 'Physics'
        else if (sub.includes('CHEM')) currentSubject = 'Chemistry'
        else if (sub.includes('MATH')) currentSubject = 'Mathematics'
      } else {
        pageTextWithoutHeaders += line + '\n'
      }
    }

    // Split pageTextWithoutHeaders by question starters
    const matches: Array<{ index: number; qNum: string; length: number }> = []
    let match: RegExpExecArray | null
    qStartRegex.lastIndex = 0

    while ((match = qStartRegex.exec(pageTextWithoutHeaders)) !== null) {
      const qNum = match[1] || match[2] || match[3] || match[4] || ''
      matches.push({ index: match.index, qNum, length: match[0].length })
    }

    if (matches.length === 0) {
      // If no question numbers detected on this page, but there is substantive text,
      // treat the whole page as a draft question block to review
      if (pageTextWithoutHeaders.trim().length > 20) {
        blocks.push({
          sourceQuestionNumber: '',
          subject: currentSubject,
          pageNumber: page.pageNumber,
          text: pageTextWithoutHeaders.trim(),
        })
      }
      continue
    }

    for (let i = 0; i < matches.length; i++) {
      const current = matches[i]!
      const start = current.index + current.length
      const end = i + 1 < matches.length ? matches[i + 1]!.index : pageTextWithoutHeaders.length
      const chunkText = pageTextWithoutHeaders.slice(start, end).trim()

      blocks.push({
        sourceQuestionNumber: current.qNum,
        subject: currentSubject,
        pageNumber: page.pageNumber,
        text: chunkText,
      })
    }
  }

  return blocks
}

/**
 * Parses individual question text into a structured ImportedQuestionDraft.
 */
export function parseQuestionBlock(block: RawQuestionBlock): ImportedQuestionDraft {
  const draft = createEmptyImportedQuestion(
    block.pageNumber,
    block.sourceQuestionNumber,
    block.subject,
  )
  draft.rawText = block.text

  const uncertainFlags: string[] = []

  // Check if multiple choice or numerical
  // Standard options patterns:
  // 1) (A) ... (B) ... (C) ... (D) ...
  // 2) (1) ... (2) ... (3) ... (4) ...
  // 3) A. ... B. ... C. ... D. ...
  const optionsRegex = /(?:^|\n|\s)(?:\(([A-Da-d1-4])\)|([A-Da-d])\.)\s+([^\n()]+)/g
  const optionMatches: Array<{ id: string; text: string }> = []
  let optMatch: RegExpExecArray | null

  // We find matches
  while ((optMatch = optionsRegex.exec(block.text)) !== null) {
    const rawId = (optMatch[1] || optMatch[2] || '').toUpperCase()
    // Map 1->A, 2->B, 3->C, 4->D
    let letterId = rawId
    if (rawId === '1') letterId = 'A'
    if (rawId === '2') letterId = 'B'
    if (rawId === '3') letterId = 'C'
    if (rawId === '4') letterId = 'D'

    const optText = (optMatch[3] || '').trim()
    if (letterId && optText) {
      optionMatches.push({ id: letterId, text: optText })
    }
  }

  // Find index of first option to separate prompt
  let firstOptIndex = -1
  if (optionMatches.length >= 2) {
    // Find where the first option starts in block.text
    const firstOptPattern = /(?:^|\n|\s)(?:\(([Aa1])\)|([Aa])\.)\s+/
    const firstMatch = firstOptPattern.exec(block.text)
    if (firstMatch) {
      firstOptIndex = firstMatch.index
    }
  }

  if (optionMatches.length >= 2 && firstOptIndex > 0) {
    draft.type = 'single-correct'
    draft.prompt = block.text.slice(0, firstOptIndex).trim()

    // Ensure we have A, B, C, D
    const optionsMap = new Map<string, string>()
    for (const opt of optionMatches) {
      optionsMap.set(opt.id, opt.text)
    }

    draft.options = ['A', 'B', 'C', 'D'].map(id => ({
      id,
      text: optionsMap.get(id) || '',
    }))

    if (draft.options.some(o => !o.text)) {
      uncertainFlags.push('Some options could not be cleanly extracted; check options A-D.')
    }
  } else {
    // Numerical question or no clear options detected
    draft.type = 'numerical'
    draft.options = []
    draft.prompt = block.text.trim()
    uncertainFlags.push('No distinct options detected; marked as numerical by default.')
  }

  if (!draft.prompt) {
    uncertainFlags.push('Prompt is empty or unparsed.')
  }

  // Check if text mentions multiple correct
  if (/one or more than one|multiple correct/i.test(block.text)) {
    draft.type = 'multiple-correct'
  }

  draft.uncertainFlags = uncertainFlags
  draft.verification = 'needs-review'
  draft.answerVerification = 'needs-review'

  return draft
}

/**
 * Full parsing pipeline from extracted page texts into question drafts.
 */
export function parseDocumentPagesToDrafts(
  pages: Array<{ pageNumber: number; text: string }>,
): ImportedQuestionDraft[] {
  const blocks = extractQuestionBlocksFromText(pages)
  return blocks.map(parseQuestionBlock)
}
