import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'

export async function POST(req: NextRequest) {
  const { title, subtotal, tax, total, items } = await req.json()
  const { DB } = env()

  const id = crypto.randomUUID()
  const stmts = [
    DB.prepare('INSERT INTO receipts (id, title, subtotal, tax, total) VALUES (?, ?, ?, ?, ?)')
      .bind(id, title || 'My Receipt', subtotal ?? 0, tax ?? 0, total ?? 0),
  ]
  for (const i of (items ?? []) as { item_name: string; quantity: number; price: number }[]) {
    if (!i.item_name?.trim()) continue
    stmts.push(
      DB.prepare('INSERT INTO receipt_items (id, receipt_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), id, i.item_name, i.quantity, i.price)
    )
  }
  await DB.batch(stmts)

  return NextResponse.json({ id })
}
