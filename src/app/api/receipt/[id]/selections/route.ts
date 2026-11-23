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
  const cookie = req.cookies.get(participantCookieName(id))?.value
  if (!cookie) return jsonError('Participant authorization required', 401)
  const participant = await DB.prepare('SELECT id FROM participants WHERE id = ? AND receipt_id = ? AND token_hash = ?')
    .bind(body.participant_id, id, await sha256(cookie)).first()
  if (!participant) return jsonError('Participant authorization failed', 403)
  if (!await consumeRateLimit(DB, req, 'selection:' + body.participant_id, 60, 60)) return jsonError('Too many updates. Slow down.', 429)

  const qty = body.qty as number
  if (qty === 0) {
    const result = await DB.prepare('DELETE FROM selections WHERE participant_id = ? AND receipt_item_id = ?')
      .bind(body.participant_id, body.receipt_item_id).run()
    if ((result.meta?.changes ?? 0) > 0) {
      await DB.prepare('UPDATE receipts SET version = version + 1 WHERE id = ?').bind(id).run()
    }
    return NextResponse.json({ deleted: true }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Capacity is checked inside the same SQL statement that writes the selection.
  // This avoids the old read-then-write race when two participants claim the last item.
  const write = await DB.prepare(
    `INSERT INTO selections (id, participant_id, receipt_item_id, qty)
     SELECT ?, ?, ?, ?
     WHERE EXISTS (
       SELECT 1 FROM receipt_items WHERE id = ? AND receipt_id = ?
     )
     AND (
       SELECT COALESCE(SUM(qty), 0) FROM selections
       WHERE receipt_item_id = ? AND participant_id != ?
     ) + ? <= (
       SELECT quantity FROM receipt_items WHERE id = ? AND receipt_id = ?
     )
     ON CONFLICT (participant_id, receipt_item_id)
     DO UPDATE SET qty = excluded.qty`
  ).bind(
    crypto.randomUUID(), body.participant_id, body.receipt_item_id, qty,
    body.receipt_item_id, id, body.receipt_item_id, body.participant_id, qty,
    body.receipt_item_id, id,
  ).run()

  if ((write.meta?.changes ?? 0) === 0) {
    return jsonError('Not enough quantity remaining or invalid item', 409)
  }
  await DB.prepare('UPDATE receipts SET version = version + 1 WHERE id = ?').bind(id).run()

  const row = await DB.prepare('SELECT * FROM selections WHERE participant_id = ? AND receipt_item_id = ?').bind(body.participant_id, body.receipt_item_id).first()
  return NextResponse.json(row, { headers: { 'Cache-Control': 'no-store' } })
}
