import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const schema = readFileSync(resolve(process.cwd(), 'migrations/0001_init.sql'), 'utf8')
const securityMigration = readFileSync(resolve(process.cwd(), 'migrations/0002_security.sql'), 'utf8')

const ids = {
  receiptA: '550e8400-e29b-41d4-a716-446655440001',
  receiptB: '550e8400-e29b-41d4-a716-446655440002',
  itemA: '550e8400-e29b-41d4-a716-446655440003',
  itemB: '550e8400-e29b-41d4-a716-446655440004',
  participantA: '550e8400-e29b-41d4-a716-446655440005',
  participantB: '550e8400-e29b-41d4-a716-446655440006',
  participantOtherReceipt: '550e8400-e29b-41d4-a716-446655440007',
  participantC: '550e8400-e29b-41d4-a716-446655440008',
}

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(schema)
  db.exec(securityMigration)

  const insertReceipt = db.prepare('INSERT INTO receipts (id, title, subtotal, tax, total) VALUES (?, ?, 0, 0, 0)')
  insertReceipt.run(ids.receiptA, 'Receipt A')
  insertReceipt.run(ids.receiptB, 'Receipt B')

  const insertItem = db.prepare('INSERT INTO receipt_items (id, receipt_id, item_name, quantity, price) VALUES (?, ?, ?, ?, 1)')
  insertItem.run(ids.itemA, ids.receiptA, 'Shared item', 2)
  insertItem.run(ids.itemB, ids.receiptB, 'Other receipt item', 1)

  const insertParticipant = db.prepare('INSERT INTO participants (id, receipt_id, name) VALUES (?, ?, ?)')
  insertParticipant.run(ids.participantA, ids.receiptA, 'Amin')
  insertParticipant.run(ids.participantB, ids.receiptA, 'Bala')
  insertParticipant.run(ids.participantC, ids.receiptA, 'Chandra')
  insertParticipant.run(ids.participantOtherReceipt, ids.receiptB, 'Chong')
  return db
}

test('database triggers reject selections across different receipts', () => {
  const db = database()
  try {
    assert.throws(() => db.prepare(
      'INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)'
    ).run('selection-cross-receipt', ids.participantA, ids.itemB, 1), /selection receipt mismatch/)
  } finally {
    db.close()
  }
})

test('database triggers reject claims that exceed item quantity', () => {
  const db = database()
  try {
    const insert = db.prepare(
      'INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)'
    )
    insert.run('selection-a', ids.participantA, ids.itemA, 1)
    insert.run('selection-b', ids.participantB, ids.itemA, 1)
    assert.throws(() => insert.run('selection-c', ids.participantC, ids.itemA, 1), /selection quantity exceeds availability/)
    assert.equal(db.prepare('SELECT SUM(qty) AS total FROM selections WHERE receipt_item_id = ?').get(ids.itemA).total, 2)
  } finally {
    db.close()
  }
})

test('database update trigger prevents increasing a claim beyond remaining stock', () => {
  const db = database()
  try {
    const insert = db.prepare(
      'INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)'
    )
    insert.run('selection-a', ids.participantA, ids.itemA, 1)
    insert.run('selection-b', ids.participantB, ids.itemA, 1)

    assert.throws(() => db.prepare(
      'UPDATE selections SET qty = ? WHERE participant_id = ? AND receipt_item_id = ?'
    ).run(2, ids.participantA, ids.itemA), /selection quantity exceeds availability/)

    assert.equal(db.prepare(
      'SELECT qty FROM selections WHERE participant_id = ? AND receipt_item_id = ?'
    ).get(ids.participantA, ids.itemA).qty, 1)
  } finally {
    db.close()
  }
})

test('database update trigger rejects moving a selection across receipt boundaries', () => {
  const db = database()
  try {
    db.prepare(
      'INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)'
    ).run('selection-a', ids.participantA, ids.itemA, 1)

    assert.throws(() => db.prepare(
      'UPDATE selections SET receipt_item_id = ? WHERE participant_id = ? AND receipt_item_id = ?'
    ).run(ids.itemB, ids.participantA, ids.itemA), /selection receipt mismatch/)
  } finally {
    db.close()
  }
})

test('database triggers permit a participant to adjust their own quantity within stock', () => {
  const db = database()
  try {
    db.prepare(
      'INSERT INTO selections (id, participant_id, receipt_item_id, qty) VALUES (?, ?, ?, ?)'
    ).run('selection-a', ids.participantA, ids.itemA, 1)

    db.prepare(
      'UPDATE selections SET qty = ? WHERE participant_id = ? AND receipt_item_id = ?'
    ).run(2, ids.participantA, ids.itemA)

    assert.equal(db.prepare(
      'SELECT qty FROM selections WHERE participant_id = ? AND receipt_item_id = ?'
    ).get(ids.participantA, ids.itemA).qty, 2)
  } finally {
    db.close()
  }
})
