export type ParsedItem = {
  item_name: string
  quantity: number
  price: number
}

const MAX_SIDE = 1600
const JPEG_QUALITY = 0.82

// Downscale + re-encode as JPEG in the browser so uploads are small and fast.
// Falls back to the original file if anything goes wrong.
async function shrinkImage(file: File): Promise<{ blob: Blob; mimeType: string }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
    if (!blob || blob.size >= file.size) throw new Error('no gain')
    return { blob, mimeType: 'image/jpeg' }
  } catch {
    return { blob: file, mimeType: file.type }
  }
}

export async function extractTextFromImage(file: File): Promise<string> {
  const { blob, mimeType } = await shrinkImage(file)

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })

  const res = await fetch('/api/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64, mimeType }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '', requestId: '' }))
    const message = typeof body.error === 'string' && body.error
      ? body.error
      : 'OCR failed. Please try again in a moment.'
    const reference = typeof body.requestId === 'string' && body.requestId
      ? ` (Reference: ${body.requestId})`
      : ''
    throw new Error(message + reference)
  }
  const { text } = await res.json()
  return text
}

export type ParsedReceipt = { items: ParsedItem[], tax: number }

export function parseReceiptText(text: string): ParsedReceipt {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    const items: ParsedItem[] = Array.isArray(parsed.items) ? parsed.items : []
    const tax: number = typeof parsed.tax === 'number' ? parsed.tax : 0
    console.log('[OCR] Parsed items:', items, 'tax:', tax)
    return { items, tax }
  } catch {
    console.error('[OCR] Failed to parse Gemini response:', text)
    return { items: [], tax: 0 }
  }
}
