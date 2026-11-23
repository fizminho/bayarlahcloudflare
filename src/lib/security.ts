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

export function participantCookieName(id: string): string { return 'blp_' + id }
