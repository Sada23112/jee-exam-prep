import { onCall, HttpsError } from 'firebase-functions/v2/https'
import * as admin from 'firebase-admin'

if (!admin.apps.length) {
  admin.initializeApp()
}

const firestore = admin.firestore()

interface GeminiProxyPayload {
  prompt: string
  model?: string
  temperature?: number
  task?: 'extraction' | 'tutoring' | 'general'
}

const DAILY_LIMIT = 100

export const geminiProxy = onCall({ cors: true }, async request => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to use the EXAMORA Gemini AI proxy.')
  }

  const { uid } = request.auth
  const payload = request.data as GeminiProxyPayload

  if (!payload || typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
    throw new HttpsError('invalid-argument', 'A valid text prompt is required.')
  }

  const model = payload.model || 'gemini-3.5-flash-lite'
  const temperature = typeof payload.temperature === 'number' ? payload.temperature : 0.3
  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw new HttpsError('failed-precondition', 'Server-side Gemini API key is not configured on this deployment.')
  }

  // Quota enforcement in Firestore
  const today = new Date().toISOString().slice(0, 10)
  const usageDocRef = firestore.collection('users').doc(uid).collection('usage').doc(`gemini-${today}`)

  const usageSnap = await usageDocRef.get()
  const currentCount = usageSnap.exists ? (usageSnap.data()?.count || 0) : 0

  if (currentCount >= DAILY_LIMIT) {
    throw new HttpsError('resource-exhausted', `Daily AI quota of ${DAILY_LIMIT} requests exceeded. Quota resets at 00:00 UTC.`)
  }

  // Call Gemini REST API securely on server
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: payload.prompt }] }],
        generationConfig: { temperature },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      let message = `Gemini API returned HTTP ${response.status}`
      try {
        const parsed = JSON.parse(errorBody) as { error?: { message?: string } }
        if (parsed.error?.message) message = parsed.error.message
      } catch {
        // use status
      }
      throw new HttpsError('internal', `Gemini API error: ${message}`)
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
      throw new HttpsError('internal', 'No content returned from Gemini model.')
    }

    // Increment usage counter atomically
    await usageDocRef.set(
      {
        date: today,
        count: admin.firestore.FieldValue.increment(1),
        lastRequestAt: new Date().toISOString(),
      },
      { merge: true },
    )

    return {
      success: true,
      text: reply,
      usageRemaining: DAILY_LIMIT - (currentCount + 1),
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    throw new HttpsError('internal', `Proxy execution failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})
