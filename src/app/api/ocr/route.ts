import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, readJson, sameOrigin } from '@/lib/security'

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite']
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
type Body = { base64?: string; mimeType?: string }

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const { DB, GEMINI_API_KEY } = env()
  if (!await consumeRateLimit(DB, req, 'ocr', 5, 3600)) return jsonError('OCR limit reached. Try again later.', 429)
  const input = await readJson<Body>(req, 7 * 1024 * 1024)
  if (!input || typeof input.base64 !== 'string' || typeof input.mimeType !== 'string' || !ALLOWED_MIME.has(input.mimeType)) {
    return jsonError('Invalid image request', 400)
  }
  const base64 = input.base64.replace(/^data:[^,]+,/, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) {
    return jsonError('Image is too large or invalid', 413)
  }
  if (Math.floor(base64.length * 3 / 4) > MAX_IMAGE_BYTES) return jsonError('Image is too large', 413)
  if (!GEMINI_API_KEY) return jsonError('OCR service is unavailable', 503)

  const prompt = 'Extract purchased line items and tax from this receipt. Return only JSON: {"items":[{"item_name":"string","quantity":1,"price":0}],"tax":0}. price is per-unit RM amount. Ignore subtotal, rounding, total, cash and change.'
  const payload = JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: input.mimeType, data: base64 } }] }] })
  for (const model of MODELS) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY }, body: payload, signal: controller.signal,
      })
      if (response.ok) {
        const result = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) return NextResponse.json({ text }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (response.status === 401 || response.status === 403) break
    } catch { /* continue with next allowlisted model */ }
    finally { clearTimeout(timeout) }
  }
  return jsonError('Unable to read this receipt right now. Please try again.', 502)
}
