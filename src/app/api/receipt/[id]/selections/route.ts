import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, participantCookieName, readJson, sameOrigin, sha256, validId } from '@/lib/security'

type Body = { participant_id?: string; receipt_item_id?: string; qty?: number }

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!validId(id)) return jsonError('Receipt not found', 404)
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const body = await readJson<Body>(req, 2048)
  if (!body || !validId(body.participant_id ?? '') || !validId(body.receipt_item_id ?? '') ||
      !Number.isInteger(body.qty) || (body.qty as number) < 0 || (body.qty as number) > 999) return jsonError('Invalid selection', 400)

  const { DB } = env()
  const cookie = req.cookies.get(participantCookieName(body.participant_id!))?.value
  if (!cookie) return jsonError('Participant authorization required', 401)
  const participant = await DB.prepare('SELECT id FROM participants WHERE id = ? AND receipt_id = ? AND token_hash = ?')
    .bind(body.participant_id, id, await sha256(cookie)).first()
  if (!participant) return jsonError('Participant authorization failed', 403)
  if (!await consumeRateLimit(DB, req, 'selection:' + body.participant_id, 60, 60)) return jsonError('Too many updates. Slow down.', 429)

  const item = await DB.prepare('SELECT quantity FROM receipt_items WHERE id = ? AND receipt_id = ?')
    .bind(body.receipt_item_id, id).first<{ quantity: number }>()
  if (!item) return jsonError('Invalid receipt item', 400)
  const claimed = await DB.prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM selections WHERE receipt_item_id = ? AND participant_id != ?')
    .bind(body.receipt_item_id, body.participant_id).first<{ total: number }>()
  const qty = body.qty as number
  if (qty + (claimed?.total ?? 0) > item.quantity) return jsonError('Not enough quantity remaining', 409)

  const bump = DB.prepare('UPDATE receipts SET version = version + 1 WHERE id = ?').bind(id)
  if (qty === 0) {
    await DB.batch([DB.prepare('DELETE FROM selections WHERE participant_id = ? AND receipt_item_id = ?').bind(body.participant_id, body.receipt_item_id), bump])
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } })
  }
  await DB.batch([
    DB.prepare('INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?) ON CONFLICT (participant_id, receipt_item_id) DO UPDATE SET qty = excluded.qty')
      .bind(crypto.randomUUID(), body.participant_id, body.receipt_item_id, qty),
    bump,
  ])
  const row = await DB.prepare('SELECT * FROM selections WHERE participant_id = ? AND receipt_item_id = ?').bind(body.participant_id, body.receipt_item_id).first()
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } })
}
