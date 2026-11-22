import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

const NO_STORE = { 'Cache-Control': 'no-store' }

// GET /api/receipt/:id?v=<clientVersion>
//  - v unknown (-1): returns everything
//  - v matches server version: returns { changed: false } after a single 1-row read
//  - v differs: returns only participants + selections (receipt/items never change)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { DB } = env()
  const clientV = Number(new URL(req.url).searchParams.get('v') ?? -1)

  const row = await DB.prepare('SELECT version FROM receipts WHERE id = ?').bind(id).first<{ version: number }>()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (clientV === row.version) {
    return NextResponse.json({ changed: false, version: row.version }, { headers: NO_STORE })
  }

  const full = clientV < 0
  const stmts = [
    DB.prepare('SELECT * FROM participants WHERE receipt_id = ? ORDER BY joined_at').bind(id),
    DB.prepare(
      `SELECT s.* FROM selections s
       JOIN participants p ON p.id = s.participant_id
       WHERE p.receipt_id = ?`
    ).bind(id),
  ]
  if (full) {
    stmts.push(
      DB.prepare('SELECT * FROM receipts WHERE id = ?').bind(id),
      DB.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').bind(id)
    )
  }
  const [participants, selections, receipt, items] = await DB.batch(stmts)

  return NextResponse.json(
    {
      changed: true,
      version: row.version,
      participants: participants.results,
      selections: selections.results,
      ...(full ? { receipt: receipt.results[0], items: items.results } : {}),
    },
    { headers: NO_STORE }
  )
}
