import { NextRequest, NextResponse } from 'next/server'

type D1 = ReturnType<typeof import('@opennextjs/cloudflare').getCloudflareContext>['env']['DB']

export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  return !!origin && origin === req.nextUrl.origin
}

export async function readJson<T>(req: NextRequest, maxBytes = 32 * 1024): Promise<T | null> {
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > maxBytes) return null
  const raw = await req.text()
  if (new TextEncoder().encode(raw).byteLength > maxBytes) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export async function consumeRateLimit(DB: any, req: NextRequest, scope: string, limit: number, windowSeconds: number): Promise<boolean> {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds
  const key = await sha256(scope + ':' + await sha256(ip) + ':' + bucket)
  await DB.prepare('INSERT INTO rate_limits (id, hit_count, expires_at) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET hit_count = hit_count + 1 WHERE hit_count < ?')
    .bind(key, bucket + windowSeconds, limit).run()
  const row = await DB.prepare('SELECT hit_count FROM rate_limits WHERE id = ?').bind(key).first()
  return !!row && row.hit_count <= limit
}

export function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export function participantCookieName(id: string): string { return 'blp_' + id }
