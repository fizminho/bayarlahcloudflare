import test from 'node:test'
import assert from 'node:assert/strict'
import { GEMINI_FREE_MODELS, runGeminiFallback } from '../src/lib/gemini-fallback.ts'

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })
const fail = (status: number) => new Response(JSON.stringify({ error: { message: 'provider error' } }), { status })

test('Gemini fallback retries 429 once, then advances to the next free model', async () => {
  const calls: string[] = []
  const result = await runGeminiFallback('test-key', '{}', async input => {
    calls.push(String(input))
    return calls.length <= 2 ? fail(429) : ok()
  }, { retryDelayMs: 0 })

  assert.ok(result.data)
  assert.equal(result.model, GEMINI_FREE_MODELS[1])
  assert.deepEqual(result.attempts.map(x => x.outcome), ['retry', 'fallback', 'success'])
})

test('Gemini fallback retries 500/503 once per model before advancing', async () => {
  const calls: string[] = []
  const result = await runGeminiFallback('test-key', '{}', async () => {
    calls.push('called')
    return calls.length === 1 ? fail(503) : calls.length === 2 ? fail(500) : ok()
  }, { retryDelayMs: 0 })

  assert.equal(result.model, GEMINI_FREE_MODELS[1])
  assert.deepEqual(result.attempts.map(x => x.outcome), ['retry', 'fallback', 'success'])
})

test('Gemini fallback skips unavailable 404 model IDs without retry', async () => {
  let calls = 0
  const result = await runGeminiFallback('test-key', '{}', async () => {
    calls++
    return calls === 1 ? fail(404) : ok()
  }, { retryDelayMs: 0 })

  assert.equal(calls, 2)
  assert.equal(result.model, GEMINI_FREE_MODELS[1])
  assert.deepEqual(result.attempts.map(x => x.outcome), ['fallback', 'success'])
})

test('Gemini fallback stops immediately for authentication and malformed request errors', async () => {
  for (const status of [400, 401, 403]) {
    let calls = 0
    const result = await runGeminiFallback('test-key', '{}', async () => {
      calls++
      return fail(status)
    }, { retryDelayMs: 0 })

    assert.equal(calls, 1)
    assert.equal(result.lastStatus, status)
    assert.equal(result.attempts[0].outcome, 'stop')
  }
})

test('Gemini fallback contains only the intended free-tier model chain', () => {
  assert.deepEqual(GEMINI_FREE_MODELS, [
    'gemini-3.8-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
  ])
})
