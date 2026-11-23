import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/cf'
import { consumeRateLimit, jsonError, readJson, sameOrigin } from '@/lib/security'

type ItemInput = { item_name: string; quantity: number; price: number }
type Body = { title?: string; subtotal?: number; tax?: number; total?: number; items?: ItemInput[] }
const validMoney = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonError('Invalid request origin', 403)
  const { DB } = env()
  if (!await consumeRateLimit(DB, req, 'receipt-create', 5, 3600)) return jsonError('Too many receipts created. Try again later.', 429)
  const body = await readJson<Body>(req, 64 * 1024)
  if (!body) return jsonError('Invalid or oversized request body', 400)
  const title = typeof body.title === 'string' ? body.title.trim() : 'My Receipt'
  const items = body.items
  if (!title || title.length > 120) return jsonError('Receipt title must be 1 to 120 characters', 400)
  if (!Array.isArray(items) || items.length < 1 || items.length > 100) return jsonError('Receipt must contain 1 to 100 items', 400)
  if (!validMoney(body.subtotal) || !validMoney(body.tax) || !validMoney(body.total)) return jsonError('Invalid receipt amount', 400)
  const safeItems: ItemInput[] = []
  for (const item of items) {
    if (!item || typeof item.item_name !== 'string' || !item.item_name.trim() || item.item_name.length > 160 ||
      !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || !validMoney(item.price)) {
      return jsonError('Invalid receipt item', 400)
    }
    safeItems.push({ item_name: item.item_name.trim(), quantity: item.quantity, price: item.price })
  }
  const calculated = safeItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
  if (Math.abs(calculated - body.subtotal!) > 0.02 || Math.abs(body.subtotal! + body.tax! - body.total!) > 0.02) {
    return jsonError('Receipt totals do not match item values', 400)
  }
  const id = crypto.randomUUID()
  const statements = [
    DB.prepare('INSERT INTO receipts (id, title, subtotal, tax, total) VALUES (?, ?, ?, ?, ?)').bind(id, title, body.subtotal, body.tax, body.total),
    ...safeItems.map(item => DB.prepare('INSERT INTO receipt_items (id, receipt_id, item_name, quantity, price) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, item.item_name, item.quantity, item.price)),
  ]
  try {
    await DB.batch(statements)
    return NextResponse.json({ id }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return jsonError('Unable to create receipt', 500) }
}
