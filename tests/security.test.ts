import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server.js'
import {
  consumeRateLimit,
  participantCookieName,
  participantOwnsReceipt,
  readJson,
  sameOrigin,
  sha256,
  validId,
} from '../src/lib/security.ts'

function request(url = 'https://bayarlah.test/api', init: ConstructorParameters<typeof NextRequest>[1] = {}) {
  return new NextRequest(url, init)
}

test('sameOrigin accepts only an exact matching Origin', () => {
  assert.equal(sameOrigin(request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { origin: 'https://bayarlah.test' },
  })), true)

  for (const origin of [
    null,
    'https://attacker.test',
    'https://bayarlah.test.attacker.test',
    'http://bayarlah.test',
    'null',
  ]) {
    const headers = new Headers()
    if (origin !== null) headers.set('origin', origin)
    assert.equal(sameOrigin(request('https://bayarlah.test/api', { method: 'POST', headers })), false)
  }
})

test('readJson accepts valid JSON with the required content type', async () => {
  const req = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ title: 'Dinner' }),
  })
  assert.deepEqual(await readJson<{ title: string }>(req), { title: 'Dinner' })
})

test('readJson rejects missing or incorrect content types', async () => {
  const missing = request('https://bayarlah.test/api', {
    method: 'POST',
    body: '{"ok":true}',
  })
  const incorrect = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: '{"ok":true}',
  })
  assert.equal(await readJson(missing), null)
  assert.equal(await readJson(incorrect), null)
})

test('readJson rejects malformed JSON and bodies over the byte limit', async () => {
  const malformed = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"broken":',
  })
  const oversized = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ value: 'x'.repeat(128) }),
  })
  assert.equal(await readJson(malformed), null)
  assert.equal(await readJson(oversized, 32), null)
})

test('readJson rejects an oversized declared Content-Length before reading', async () => {
  const req = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': '999999',
    },
    body: '{"ok":true}',
  })
  assert.equal(await readJson(req, 32), null)
})

test('validId accepts UUIDs and rejects malformed identifiers', () => {
  assert.equal(validId('550e8400-e29b-41d4-a716-446655440000'), true)
  assert.equal(validId('550e8400-e29b-01d4-a716-446655440000'), false)
  assert.equal(validId('not-a-uuid'), false)
  assert.equal(validId(''), false)
})

test('participant cookie names are scoped to the receipt identifier', () => {
  assert.equal(
    participantCookieName('550e8400-e29b-41d4-a716-446655440000'),
    'blp_550e8400-e29b-41d4-a716-446655440000',
  )
})

test('sha256 returns a stable lowercase hexadecimal digest', async () => {
  assert.equal(
    await sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})

test('rate limiting accepts only the configured number of hits', async () => {
  let hitCount = 0
  const db = {
    prepare: () => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          const limit = Number(values[2])
          if (hitCount >= limit) return { meta: { changes: 0 } }
          hitCount += 1
          return { meta: { changes: 1 } }
        },
      }),
    }),
  }

  const req = request('https://bayarlah.test/api', {
    method: 'POST',
    headers: { 'cf-connecting-ip': '203.0.113.10' },
  })
  const results = await Promise.all(
    Array.from({ length: 8 }, () => consumeRateLimit(db, req, 'test-scope', 3, 3600)),
  )

  assert.equal(results.filter(Boolean).length, 3)
  assert.equal(results.filter(value => !value).length, 5)
})


test('participant authorization is bound to receipt, participant and hashed capability', async () => {
  const receiptId = '550e8400-e29b-41d4-a716-446655440000'
  const participantId = '550e8400-e29b-41d4-a716-446655440001'
  const token = 'opaque-capability-secret'
  const expectedHash = await sha256(token)
  const authorizedRows = new Set([participantId + ':' + receiptId + ':' + expectedHash])
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async () => {
          assert.match(sql, /id = \? AND receipt_id = \? AND token_hash = \?/)
          assert.notEqual(values[2], token)
          return authorizedRows.has(values.join(':')) ? { id: participantId } : null
        },
      }),
    }),
  }

  assert.equal(await participantOwnsReceipt(db, receiptId, participantId, token), true)
  assert.equal(await participantOwnsReceipt(db, receiptId, participantId, 'wrong-token'), false)
  assert.equal(await participantOwnsReceipt(db, '550e8400-e29b-41d4-a716-446655440002', participantId, token), false)
  assert.equal(await participantOwnsReceipt(db, receiptId, '550e8400-e29b-41d4-a716-446655440003', token), false)
  assert.equal(await participantOwnsReceipt(db, 'invalid', participantId, token), false)
})
