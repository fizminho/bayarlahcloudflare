import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { DB } = env()

  const [receipt, items, participants, selections] = await DB.batch([
    DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id),
    DB.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').bind(id),
    DB.prepare('SELECT * FROM participants WHERE receipt_id = ? ORDER BY joined_at').bind(id),
    DB.prepare(
      `SELECT s.* FROM selections s
       JOIN participants p ON p.id = s.participant_id
       WHERE p.receipt_id = ?`
    ).bind(id),
  ])

  if (!receipt.results.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json(
    {
      receipt: receipt.results[0],
      items: items.results,
      participants: participants.results,
      selections: selections.results,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
