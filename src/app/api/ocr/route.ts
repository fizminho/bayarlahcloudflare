import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, readJson, sameOrigin, validateImagePayload } from '@/lib/security'
import { runGeminiFallback } from '@/lib/gemini-fallback'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
type Body = { base64?: string; mimeType?: string }

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const { DB, GEMINI_API_KEY } = env()
  if (!await consumeRateLimit(DB, req, 'ocr', 5, 3600)) return jsonError('OCR limit reached. Try again later.', 429)
  const input = await readJson<Body>(req, 7 * 1024 * 1024)
  if (!input || typeof input.base64 !== 'string' || typeof input.mimeType !== 'string' || !ALLOWED_MIME.has(input.mimeType)) {
    return jsonError('Invalid image request', 400)
  }
  const base64 = validateImagePayload(input.base64, input.mimeType)
  if (!base64) return jsonError('Invalid image content or unsupported image format', 400)
  if (!GEMINI_API_KEY) return jsonError('OCR service is unavailable', 503)

  const prompt = 'Extract purchased line items and tax from this receipt. Return only JSON: {"items":[{"item_name":"string","quantity":1,"price":0}],"tax":0}. price is per-unit RM amount. Ignore subtotal, rounding, total, cash and change.'
  const payload = JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: input.mimeType, data: base64 } }] }] })
  const fallback = await runGeminiFallback(GEMINI_API_KEY, payload)
  if (fallback.data && typeof fallback.data === 'object') {
    const result = fallback.data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text
    if (text) {
      return NextResponse.json(
        { text, model: fallback.model, modelAttempts: fallback.attempts },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
  }

  return jsonError('Unable to read this receipt right now. Please try again.', 502)
}
