import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

const MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]
const RETRYABLE = new Set([429, 503, 502, 500])

export async function POST(req: NextRequest) {
  const { base64, mimeType } = await req.json()
  const apiKey = env().GEMINI_API_KEY

  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not set on this Worker' }, { status: 500 })
  }

  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          text: `You are a receipt parser. Extract all purchased line items and tax from this receipt image. Return ONLY a valid JSON object, no markdown, no explanation.\n\nRules:\n- "items" array: each object must have item_name (string), quantity (integer), price (number, per-unit price in RM)\n- "tax" field: total of all tax/SST/GST/service charge lines combined as a single RM number (0 if none)\n- The rightmost number column on the receipt is the LINE TOTAL (quantity x unit price)\n- Calculate unit price = line total / quantity\n- Every item MUST have a price greater than 0.00 unless it is explicitly marked as free or RM0.00 on the receipt\n- If you cannot read a price clearly, make your best estimate based on surrounding context\n- Ignore lines for: subtotal, rounding, total, cash, change, credit, debit\n\nFormat: {"items":[{"item_name":"...","quantity":1,"price":0.00}],"tax":0.00}`
        },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }]
  })

  let lastError = 'unknown error'

  for (const model of MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 3000))
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body,
      })

      if (res.ok) {
        const json = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text
        if (text) return NextResponse.json({ text })
        lastError = `${model}: empty response`
        break // try next model
      }

      const detail = (await res.text()).slice(0, 300)
      lastError = `${model} -> ${res.status}: ${detail}`
      console.error('[OCR]', lastError)

      if (RETRYABLE.has(res.status)) continue // retry same model
      if (res.status === 401 || res.status === 403 || res.status === 400) {
        // bad key / bad request: other models will fail the same way
        return NextResponse.json({ error: lastError }, { status: 502 })
      }
      break // 404 etc: try next model
    }
  }

  return NextResponse.json({ error: lastError }, { status: 502 })
}
