import { httpsCallable } from 'firebase/functions'
import { getFirebaseFunctions, getFirebaseAuth } from './firebase'
import { getStoredGeminiApiKey, getStoredGeminiModel } from '../../modules/importer/application/gemini-extractor'

export interface GeminiRequestOptions {
  prompt: string
  model?: string
  temperature?: number
  task?: 'extraction' | 'tutoring' | 'general'
  apiKey?: string
  responseMimeType?: string
}

export interface GeminiResponse {
  text: string
  source: 'cloud-function-proxy' | 'direct-client-api'
  usageRemaining?: number
}

/**
 * Executes a Gemini AI request.
 * Prioritizes the authenticated server-side Cloud Function proxy when available.
 * Transparently falls back to direct client-side execution if unauthenticated, offline,
 * or using personal API keys.
 */
export async function executeGeminiRequest(options: GeminiRequestOptions): Promise<GeminiResponse> {
  const auth = getFirebaseAuth()
  const functions = getFirebaseFunctions()
  const currentUser = auth?.currentUser

  // 1. Try server-side Cloud Function proxy if authenticated
  if (currentUser && functions) {
    try {
      const proxyFn = httpsCallable<
        { prompt: string; model?: string; temperature?: number; task?: string },
        { success: boolean; text: string; usageRemaining?: number }
      >(functions, 'geminiProxy')

      const result = await proxyFn({
        prompt: options.prompt,
        model: options.model || getStoredGeminiModel(),
        temperature: options.temperature ?? 0.3,
        task: options.task || 'general',
      })

      if (result.data.success && result.data.text) {
        return {
          text: result.data.text,
          source: 'cloud-function-proxy',
          usageRemaining: result.data.usageRemaining,
        }
      }
    } catch (proxyError) {
      console.warn('Server-side Gemini proxy unavailable, falling back to direct API key:', proxyError)
    }
  }

  // 2. Direct client-side API fallback
  const apiKey = options.apiKey || getStoredGeminiApiKey()
  if (!apiKey) {
    throw new Error(
      'Gemini API key is not configured. Please sign in to use JEE CBT AI Cloud or configure your personal API key in Settings.',
    )
  }

  const model = options.model || getStoredGeminiModel()
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`

  const requestBody: {
    contents: Array<{ parts: Array<{ text: string }> }>
    generationConfig?: { temperature?: number; responseMimeType?: string }
  } = {
    contents: [{ parts: [{ text: options.prompt }] }],
    generationConfig: {
      temperature: options.temperature ?? 0.3,
    },
  }

  if (options.responseMimeType) {
    requestBody.generationConfig!.responseMimeType = options.responseMimeType
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
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

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!reply) {
    throw new Error('No content returned from Gemini model.')
  }

  return {
    text: reply,
    source: 'direct-client-api',
  }
}
