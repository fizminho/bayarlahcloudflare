import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

// Upsert a selection. qty <= 0 deletes it.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { participant_id, receipt_item_id, qty } = await req.json()
  const { DB } = env()

  // Make sure participant and item both belong to this receipt
  const ok = await DB.prepare(
    `SELECT 1 FROM participants p, receipt_items i
     WHERE p.id = ? AND p.receipt_id = ? AND i.id = ? AND i.receipt_id = ?`
  ).bind(participant_id, id, receipt_item_id, id).first()
  if (!ok) return NextResponse.json({ error: 'Invalid participant or item' }, { status: 400 })

  const bounded = Math.max(0, Math.floor(Number(qty) || 0))
  if (bounded === 0) {
    await DB.prepare('DELETE FROM selections WHERE participant_id = ? AND receipt_item_id = ?')
      .bind(participant_id, receipt_item_id).run()
    return NextResponse.json({ deleted: true })
  }

  await DB.prepare(
    `INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)
     ON CONFLICT (participant_id, receipt_item_id) DO UPDATE SET qty = excluded.qty`
  ).bind(crypto.randomUUID(), participant_id, receipt_item_id, bounded).run()

  const row = await DB.prepare('SELECT * FROM selections WHERE participant_id = ? AND receipt_item_id = ?')
    .bind(participant_id, receipt_item_id).first()
  return NextResponse.json(row)
}
