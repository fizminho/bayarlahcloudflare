import { NextRequest, NextResponse } from 'next/server.js'

export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  return !!origin && origin === req.nextUrl.origin
}

export async function readJson<T>(req: NextRequest, maxBytes = 32 * 1024): Promise<T | null> {
  if (req.headers.get('content-type')?.toLowerCase().split(';', 1)[0].trim() !== 'application/json') return null
  const contentLength = req.headers.get('content-length')
  if (contentLength !== null) {
    const length = Number(contentLength)
    if (!Number.isFinite(length) || length < 0 || length > maxBytes) return null
  }

  if (!req.body) return null
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export async function consumeRateLimit(
  DB: { prepare: (query: string) => { bind: (...values: unknown[]) => { run: () => Promise<{ meta?: { changes?: number } }> } } },
  req: NextRequest,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds
  const key = await sha256(scope + ':' + await sha256(ip) + ':' + bucket)
  const result = await DB.prepare(
    'INSERT INTO rate_limits (id, hit_count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET hit_count = hit_count + 1 WHERE hit_count < ?'
  ).bind(key, bucket + windowSeconds, limit).run()
  // D1 reports zero changed rows when the conditional upsert refuses an over-limit request.
  return result.meta?.changes === 1
}

export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function participantOwnsReceipt(
  DB: { prepare: (query: string) => { bind: (...values: unknown[]) => { first: <T>() => Promise<T | null> } } },
  receiptId: string,
  participantId: string,
  token: string,
): Promise<boolean> {
  if (!validId(receiptId) || !validId(participantId) || !token) return false
  const row = await DB.prepare(
    'SELECT id FROM participants WHERE id = ? AND receipt_id = ? AND token_hash = ?'
  ).bind(participantId, receiptId, await sha256(token)).first<{ id: string }>()
  return !!row
}

export function participantCookieName(id: string): string { return 'blp_' + id }


export function validateImagePayload(base64Input: string, mimeType: string, maxBytes = 5 * 1024 * 1024): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) return null
  const base64 = base64Input.replace(/^data:[^,]+,/, '')
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 === 1) return null

  let binary: string
  try {
    binary = atob(base64)
  } catch {
    return null
  }
  if (binary.length === 0 || binary.length > maxBytes) return null

  const byte = (index: number) => binary.charCodeAt(index)
  const isJpeg = mimeType === 'image/jpeg' &&
    binary.length >= 3 && byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff
  const isPng = mimeType === 'image/png' &&
    binary.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => byte(index) === value)
  const isWebp = mimeType === 'image/webp' &&
    binary.length >= 12 && binary.slice(0, 4) === 'RIFF' && binary.slice(8, 12) === 'WEBP'

  return isJpeg || isPng || isWebp ? base64 : null
}
