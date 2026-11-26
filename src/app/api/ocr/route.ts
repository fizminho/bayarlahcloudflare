import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, readJson, sameOrigin, validateImagePayload } from '@/lib/security'
import { runGeminiFallback } from '@/lib/gemini-fallback'

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const WORKERS_AI_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
const WORKERS_AI_TIMEOUT_MS = 20_000
type Body = { base64?: string; mimeType?: string }
type WorkersAI = {
  run: (model: string, input: { prompt: string; image: string; max_tokens: number; temperature: number }) => Promise<unknown>
}

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

async function runWorkersAIOcr(ai: WorkersAI, base64: string, mimeType: string): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      ai.run(WORKERS_AI_MODEL, {
        prompt: OCR_PROMPT,
        image: `data:${mimeType};base64,${base64}`,
        max_tokens: 2048,
        temperature: 0,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Workers AI OCR timed out')), WORKERS_AI_TIMEOUT_MS)
      }),
    ])
    const response = result && typeof result === 'object'
      ? (result as { response?: unknown; result?: { response?: unknown } }).response
        ?? (result as { result?: { response?: unknown } }).result?.response
      : null
    return extractReceiptJson(response)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const bindings = env() as ReturnType<typeof env> & { AI?: WorkersAI; GEMINI_API_KEY?: string }
  const { DB, GEMINI_API_KEY, AI } = bindings
  if (!await consumeRateLimit(DB, req, 'ocr', 5, 3600)) return jsonError('OCR limit reached. Try again later.', 429)
  const input = await readJson<Body>(req, 7 * 1024 * 1024)
  if (!input || typeof input.base64 !== 'string' || typeof input.mimeType !== 'string' || !ALLOWED_MIME.has(input.mimeType)) {
    return jsonError('Invalid image request', 400)
  }
  const base64 = validateImagePayload(input.base64, input.mimeType)
  if (!base64) return jsonError('Invalid image content or unsupported image format', 400)
  if (!AI && !GEMINI_API_KEY) return jsonError('OCR service is unavailable', 503)

  const requestId = crypto.randomUUID()

  let workersAiFallbackReason: 'binding-unavailable' | 'timeout' | 'provider-error' | 'invalid-response' | null = null

  if (!AI) {
    workersAiFallbackReason = 'binding-unavailable'
    console.warn('[OCR] Workers AI binding unavailable; using Gemini fallback', { requestId })
  }

  if (AI) {
    try {
      const text = await runWorkersAIOcr(AI, base64, input.mimeType)
      if (text) {
        console.info('[OCR] Workers AI succeeded', { requestId, model: WORKERS_AI_MODEL })
        return NextResponse.json(
          { text, model: WORKERS_AI_MODEL, provider: 'cloudflare-workers-ai', fallbackUsed: false },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      }
      workersAiFallbackReason = 'invalid-response'
      console.warn('[OCR] Workers AI returned unusable receipt JSON; falling back to Gemini', {
        requestId,
        model: WORKERS_AI_MODEL,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 160) : 'unknown'
      workersAiFallbackReason = /timed out/i.test(reason) ? 'timeout' : 'provider-error'
      console.warn('[OCR] Workers AI failed; falling back to Gemini', {
        requestId,
        model: WORKERS_AI_MODEL,
        fallbackReason: workersAiFallbackReason,
        reason,
      })
    }
  }

  if (GEMINI_API_KEY) {
    const payload = JSON.stringify({
      contents: [{ parts: [{ text: OCR_PROMPT }, { inline_data: { mime_type: input.mimeType, data: base64 } }] }],
    })
    const fallback = await runGeminiFallback(GEMINI_API_KEY, payload)
    if (fallback.data && typeof fallback.data === 'object') {
      const result = fallback.data as {
        candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[]
        promptFeedback?: { blockReason?: string }
      }
      const text = extractReceiptJson(result.candidates?.[0]?.content?.parts?.[0]?.text)
      if (text) {
        return NextResponse.json(
          {
            text,
            model: fallback.model,
            provider: 'gemini',
            fallbackUsed: true,
            fallbackReason: workersAiFallbackReason,
            workersAiModel: WORKERS_AI_MODEL,
            modelAttempts: fallback.attempts,
          },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      }

      console.error('[OCR] Gemini response contained no valid receipt JSON', {
        requestId,
        model: fallback.model,
        candidateCount: result.candidates?.length ?? 0,
        finishReason: result.candidates?.[0]?.finishReason ?? null,
        blockReason: result.promptFeedback?.blockReason ?? null,
      })
    } else {
      console.error('[OCR] Gemini fallback exhausted', {
        requestId,
        model: fallback.model,
        lastStatus: fallback.lastStatus,
        attempts: fallback.attempts,
      })
    }
  }

  return NextResponse.json(
    { error: 'Unable to read this receipt right now. Please try again.', requestId },
    { status: 502, headers: { 'Cache-Control': 'no-store' } },
  )
}
