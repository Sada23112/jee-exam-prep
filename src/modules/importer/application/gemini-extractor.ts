import type { Subject, QuestionType } from '../../question-bank/domain/question'
import {
  createEmptyImportedQuestion,
  normalizeOptionId,
  normalizeDraftOptionsAndKey,
  type ImportedQuestionDraft,
} from '../domain/import-session'

export const GEMINI_API_KEY_STORAGE = 'jee_cbt_gemini_api_key'
export const GEMINI_MODEL_STORAGE = 'jee_cbt_gemini_model'
const metaEnv = typeof import.meta !== 'undefined'
  ? (import.meta as unknown as { env?: { VITE_GEMINI_API_KEY?: string; VITE_GEMINI_MODEL?: string } }).env
  : undefined

export const DEFAULT_GEMINI_MODEL = metaEnv?.VITE_GEMINI_MODEL || 'gemini-3.5-flash-lite'

export function getStoredGeminiApiKey(): string | null {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(GEMINI_API_KEY_STORAGE)?.trim()
    if (stored) return stored
  }
  return metaEnv?.VITE_GEMINI_API_KEY?.trim() || null
}

export function setStoredGeminiApiKey(key: string): void {
  if (typeof localStorage === 'undefined') return
  if (!key.trim()) {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE)
  } else {
    localStorage.setItem(GEMINI_API_KEY_STORAGE, key.trim())
  }
}

export function getStoredGeminiModel(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(GEMINI_MODEL_STORAGE)?.trim()
    if (stored) return stored
  }
  return DEFAULT_GEMINI_MODEL
}

export function setStoredGeminiModel(model: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(GEMINI_MODEL_STORAGE, model)
}

interface RawAiQuestion {
  questionNumber?: string
  subject?: string
  chapter?: string
  topic?: string
  type?: string
  prompt?: string
  options?: Array<{ id: string; text: string }>
  correctOptionIds?: string[]
  numericalAnswer?: string
  solution?: string
  notes?: string
}

const EXTRACTION_SYSTEM_PROMPT = `You are an expert JEE examination document extraction assistant.
Extract all examination questions present on this question paper page.
Ensure mathematical equations and formulas are formatted strictly in standard LaTeX math notation using $...$ for inline math and $$...$$ for display math.
Preserve exact wording, signs, and values.
Do NOT invent answers or options if they are not visible.
Option IDs: Always standardize multiple-choice option IDs as "A", "B", "C", "D". If the question paper numbers options as (1), (2), (3), (4) or 1, 2, 3, 4, map 1 -> A, 2 -> B, 3 -> C, 4 -> D.
Always return structured JSON matching this schema:
{
  "questions": [
    {
      "questionNumber": "1",
      "subject": "Physics" | "Chemistry" | "Mathematics",
      "chapter": "Electromagnetism",
      "topic": "Magnetic Dipole",
      "type": "single-correct" | "multiple-correct" | "numerical",
      "prompt": "Transcribed prompt text with $LaTeX$",
      "options": [
        { "id": "A", "text": "Option A text" },
        { "id": "B", "text": "Option B text" },
        { "id": "C", "text": "Option C text" },
        { "id": "D", "text": "Option D text" }
      ],
      "correctOptionIds": ["A"],
      "numericalAnswer": "12.5",
      "solution": "Step by step solution if present"
    }
  ]
}
If no questions are on the page, return { "questions": [] }.`

export async function extractQuestionsWithGemini(options: {
  apiKey?: string
  model?: string
  pageNumber: number
  imageBase64?: string
  text?: string
}): Promise<ImportedQuestionDraft[]> {
  const apiKey = options.apiKey || getStoredGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Add your API key in Settings or enter it in the prompt.')
  }

  const model = options.model || getStoredGeminiModel()
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
    { text: EXTRACTION_SYSTEM_PROMPT },
  ]

  if (options.text) {
    parts.push({ text: `Page ${options.pageNumber} OCR / extracted text:\n${options.text}` })
  }

  if (options.imageBase64) {
    // Strip data:image/...;base64, prefix if present
    const base64Data = options.imageBase64.includes(',')
      ? options.imageBase64.split(',')[1]!
      : options.imageBase64

    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: base64Data,
      },
    })
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    let errorMsg = `Gemini API returned status ${response.status}`
    try {
      const parsed = JSON.parse(errorBody) as { error?: { message?: string } }
      if (parsed.error?.message) errorMsg = parsed.error.message
    } catch {
      // ignore
    }
    throw new Error(errorMsg)
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!candidateText) {
    throw new Error('No response text received from Gemini API.')
  }

  const parsedJson = JSON.parse(candidateText) as { questions?: RawAiQuestion[] }
  const rawList = parsedJson.questions || []

  return rawList.map(raw => {
    let subject: Subject = 'Physics'
    if (raw.subject && /chem/i.test(raw.subject)) subject = 'Chemistry'
    if (raw.subject && /math/i.test(raw.subject)) subject = 'Mathematics'

    let type: QuestionType = 'single-correct'
    if (raw.type === 'multiple-correct' || raw.type === 'numerical') {
      type = raw.type
    }

    const draft = createEmptyImportedQuestion(
      options.pageNumber,
      raw.questionNumber || '',
      subject,
    )

    draft.chapter = (raw.chapter || '').slice(0, 300)
    draft.topic = (raw.topic || '').slice(0, 300)
    draft.type = type
    draft.prompt = raw.prompt || ''
    draft.solution = raw.solution || ''

    if (type !== 'numerical' && Array.isArray(raw.options) && raw.options.length > 0) {
      draft.options = raw.options.map((o, idx) => ({
        id: normalizeOptionId(o.id || 'A', idx),
        text: o.text || '',
      }))
      draft.correctOptionIds = Array.isArray(raw.correctOptionIds)
        ? raw.correctOptionIds.map((id, idx) => normalizeOptionId(id, idx))
        : []
    } else if (type === 'numerical') {
      draft.options = []
      draft.numericalAnswer = raw.numericalAnswer || ''
    }

    // AI extractions ALWAYS start in needs-review state — never automatically verified
    draft.verification = 'needs-review'
    draft.answerVerification = 'needs-review'
    draft.answerSource = 'ai-extracted'
    draft.answerKeyStatus = draft.correctOptionIds.length > 0 || draft.numericalAnswer.trim()
      ? 'needs-correction'
      : 'missing'

    const flags: string[] = ['AI extracted: please verify formulas, options and answers against the original.']
    if (!draft.prompt) flags.push('Missing prompt text.')
    if (type !== 'numerical' && draft.options.length === 0) flags.push('No options extracted.')
    draft.uncertainFlags = flags

    return normalizeDraftOptionsAndKey(draft)
  })
}
