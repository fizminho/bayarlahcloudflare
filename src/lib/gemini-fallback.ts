export const GEMINI_FREE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
] as const

const RETRYABLE_STATUSES = new Set([429, 500, 503])
const FALLTHROUGH_STATUSES = new Set([404, 429, 500, 503])

export type GeminiAttempt = {
  model: string
  attempt: number
  status?: number
  providerMessage?: string
  outcome: 'success' | 'retry' | 'fallback' | 'stop' | 'network-error'
}

export type GeminiFallbackResult = {
  data: unknown | null
  model: string | null
  attempts: GeminiAttempt[]
  lastStatus: number | null
}

/** Free-tier model chain with a shared request deadline. */
export async function runGeminiFallback(
  apiKey: string,
  requestBody: string,
  fetcher: typeof fetch = fetch,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<GeminiFallbackResult> {
  const timeoutMs = options.timeoutMs ?? 20_000
  const retryDelayMs = options.retryDelayMs ?? 1_500
  const deadline = Date.now() + timeoutMs
  const attempts: GeminiAttempt[] = []
  let lastStatus: number | null = null
  let lastModel: string | null = null

  for (const model of GEMINI_FREE_MODELS) {
    lastModel = model
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent'

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), remaining)
      let response: Response
      let responseData: unknown = null
      let providerMessage: string | undefined
      try {
        response = await fetcher(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: requestBody,
          signal: controller.signal,
        })
        // Keep the deadline active while consuming the provider response body too.
        if (response.ok) {
          responseData = await response.json()
        } else {
          try {
            const errorBody = await response.json() as { error?: { message?: unknown } }
            if (typeof errorBody.error?.message === 'string') {
              providerMessage = errorBody.error.message.slice(0, 240)
            }
          } catch {
            try { await response.body?.cancel() } catch { /* discard provider error body */ }
          }
        }
      } catch {
        attempts.push({ model, attempt: attempt + 1, outcome: 'network-error' })
        break
      } finally {
        clearTimeout(timeout)
      }

      lastStatus = response.status
      if (response.ok) {
        attempts.push({ model, attempt: attempt + 1, status: response.status, outcome: 'success' })
        return { data: responseData, model, attempts, lastStatus }
      }

      const retryable = RETRYABLE_STATUSES.has(response.status)
      const shouldRetry = retryable && attempt === 0 && Date.now() < deadline
      const shouldFallback = FALLTHROUGH_STATUSES.has(response.status)
      attempts.push({
        model,
        attempt: attempt + 1,
        status: response.status,
        ...(providerMessage ? { providerMessage } : {}),
        outcome: shouldRetry ? 'retry' : shouldFallback ? 'fallback' : 'stop',
      })

      if (shouldRetry) {
        const delay = Math.min(retryDelayMs * (attempt + 1), Math.max(0, deadline - Date.now()))
        if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }

      if (shouldFallback) break
      return { data: null, model, attempts, lastStatus }
    }

    if (Date.now() >= deadline) break
    if (lastStatus !== null && !FALLTHROUGH_STATUSES.has(lastStatus)) break
  }

  return { data: null, model: lastModel, attempts, lastStatus }
}
