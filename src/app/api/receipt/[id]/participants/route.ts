import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, participantCookieName, readJson, sameOrigin, sha256, validId } from '@/lib/security'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) return jsonError('Receipt not found', 404)
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const { DB } = env()
  if (!await consumeRateLimit(DB, req, 'participant-join', 10, 600)) return jsonError('Too many join attempts. Try again later.', 429)
  const body = await readJson<{ name?: string }>(req, 2048)
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 60) return jsonError('Name must be 1 to 60 characters', 400)
  const exists = await DB.prepare('SELECT 1 FROM receipts WHERE id = ?').bind(id).first()
  if (!exists) return jsonError('Receipt not found', 404)
  const pid = crypto.randomUUID()
  const token = crypto.randomUUID() + '.' + crypto.randomUUID()
  await DB.batch([
    DB.prepare('INSERT INTO participants (id, receipt_id, name, token_hash) VALUES (?, ?, ?, ?)').bind(pid, id, name, await sha256(token)),
    DB.prepare('UPDATE receipts SET version = version + 1 WHERE id = ?').bind(id),
  ])
  const participant = await DB.prepare('SELECT id, receipt_id, name, joined_at FROM participants WHERE id = ?').bind(pid).first()
  const response = NextResponse.json(participant, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(participantCookieName(id), token, { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 2592000 })
  return response
}
