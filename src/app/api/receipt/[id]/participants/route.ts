import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { name } = await req.json()
  const trimmed = String(name ?? '').trim().slice(0, 60)
  if (!trimmed) return NextResponse.json({ error: 'Name required' }, { status: 400 })

  const { DB } = env()
  const exists = await DB.prepare('SELECT 1 FROM receipts WHERE id = ?').bind(id).first()
  if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const pid = crypto.randomUUID()
  await DB.prepare('INSERT INTO participants (id, receipt_id, name) VALUES (?, ?, ?)').bind(pid, id, trimmed).run()
  const participant = await DB.prepare('SELECT * FROM participants WHERE id = ?').bind(pid).first()
  return NextResponse.json(participant)
}
