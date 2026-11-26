import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, readJson, sameOrigin, validateImagePayload } from '@/lib/security'
import { runGeminiFallback } from '@/lib/gemini-fallback'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
type Body = { base64?: string; mimeType?: string }

const OCR_PROMPT = [
  'Read this Malaysian receipt carefully.',
  'Extract purchased line items and tax.',
  'Return ONLY valid JSON with this exact shape: {"items":[{"item_name":"string","quantity":1,"price":0}],"tax":0}.',
  'The price is the per-unit amount in RM. Use numbers, not strings.',
  'Ignore subtotal, rounding adjustment, grand total, cash, change and payment details.',
  'If tax is not shown, return tax as 0. Do not invent items or amounts.',
].join(' ')

function extractReceiptJson(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null

  const candidate = cleaned.slice(start, end + 1)
  try {
    const parsed = JSON.parse(candidate) as { items?: unknown; tax?: unknown }
    if (!Array.isArray(parsed.items) || typeof parsed.tax !== 'number') return null
    if (!parsed.items.every(item => {
      if (!item || typeof item !== 'object') return false
      const row = item as { item_name?: unknown; quantity?: unknown; price?: unknown }
      return typeof row.item_name === 'string'
        && typeof row.quantity === 'number'
        && typeof row.price === 'number'
    })) return null
    return JSON.stringify({ items: parsed.items, tax: parsed.tax })
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const { DB, GEMINI_API_KEY } = env() as ReturnType<typeof env> & { GEMINI_API_KEY?: string }
  if (!await consumeRateLimit(DB, req, 'ocr', 5, 3600)) return jsonError('OCR limit reached. Try again later.', 429)

  const input = await readJson<Body>(req, 7 * 1024 * 1024)
  if (!input || typeof input.base64 !== 'string' || typeof input.mimeType !== 'string' || !ALLOWED_MIME.has(input.mimeType)) {
    return jsonError('Invalid image request', 400)
  }
  const base64 = validateImagePayload(input.base64, input.mimeType)
  if (!base64) return jsonError('Invalid image content or unsupported image format', 400)
  if (!GEMINI_API_KEY) return jsonError('OCR service is unavailable', 503)

  const requestId = crypto.randomUUID()
  const payload = JSON.stringify({
    contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: input.mimeType, data: base64 } }] }],
  })
  const result = await runGeminiFallback(GEMINI_API_KEY, payload)

  if (result.data && typeof result.data === 'object') {
    const response = result.data as {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
      promptFeedback?: { blockReason?: string }
    }
    const text = extractReceiptJson(response.candidates?.[0]?.content?.parts?.[0]?.text)
    if (text) {
      return NextResponse.json(
        {
          text,
          model: result.model,
          provider: 'gemini',
          fallbackUsed: false,
          modelAttempts: result.attempts,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }

    console.error('[OCR] Gemini response contained no valid receipt JSON', {
      requestId,
      model: result.model,
      candidateCount: response.candidates?.length ?? 0,
      finishReason: response.candidates?.[0]?.finishReason ?? null,
      blockReason: response.promptFeedback?.blockReason ?? null,
    })
  } else {
    console.error('[OCR] Gemini OCR exhausted model chain', {
      requestId,
      model: result.model,
      lastStatus: result.lastStatus,
      attempts: result.attempts,
    })
  }

  return NextResponse.json(
    { error: 'Unable to read this receipt right now. Please try again.', requestId },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  )
}
