# BayarLah security baseline

This document records security controls for the Cloudflare Workers + D1 application. BayarLah intentionally uses public receipt links; receipt content and participant summaries are readable by anyone who has the share URL. A participant capability is required to mutate that participant's selections.

## Implemented on this branch

- Same-origin validation for state-changing receipt, participant, selection and OCR endpoints.
- Bounded JSON request bodies and strict validation for receipt titles, amounts, item names, quantities and OCR image types/sizes. OCR validates JPEG, PNG and WebP file signatures against the declared MIME type, not just the client-supplied header.
- D1-backed fixed-window rate limits for receipt creation, participant joins and selection updates; OCR has its own IP-based quota.
- Participant capability tokens are cryptographically random, stored only as SHA-256 hashes in D1 and issued in HttpOnly, Secure, SameSite=Strict cookies. Public participant IDs are not authorization secrets.
- Selection writes verify the capability token against the participant and receipt. Capacity checks are performed in the write statement itself, and D1 triggers enforce same-receipt ownership and aggregate quantity limits as defense in depth.
- OCR provider keys remain server-side; provider errors and image/prompt contents are not returned or logged. Provider calls share a single 20-second request-wide deadline across the model fallback list, with an explicit model allowlist.
- Security headers include CSP, HSTS, frame denial, no-sniff, referrer and permissions policies; powered-by header is disabled.
- API responses containing shared receipt state are marked no-store.

## Public share model

- GET /api/receipt/:id remains public by design so guests can view a receipt and participant progress.
- Anyone with the share URL can view receipt details, participant names and item selections. Treat the share URL as a bearer link.
- Joining creates a participant identity and an HttpOnly capability cookie. Selection changes require that cookie. Knowing or guessing a participant UUID alone is insufficient.
- There is no owner account or owner-only editing/deletion workflow in the current product model.

## Deployment requirements

1. Apply migrations/0002_security.sql to local and remote D1 before deploying this branch.
2. Deploy the Worker only after migration succeeds.
3. Verify join, selection update, polling and sharing in two separate browser sessions.
4. Confirm production uses HTTPS. Participant cookies are Secure-only.
5. Configure Cloudflare edge rate limiting/WAF as an additional layer for public endpoints.
6. Keep GEMINI_API_KEY as a Worker secret. Never put it in NEXT_PUBLIC variables.

## Known limitations and follow-up

- IP-based D1 limits use a SHA-256 fingerprint of CF-Connecting-IP; this is pseudonymous, not keyed HMAC.
- Selection capacity is guarded by a conditional INSERT/UPSERT and D1 triggers. Keep the SQL checks and triggers aligned if selection logic changes.
- Expired rate-limit buckets need scheduled cleanup or bounded retention. Configure a Worker Cron cleanup before the rate-limit table grows significantly.
- CSP permits inline scripts for compatibility with current Next.js rendering. A nonce-based CSP can tighten this after validating Cloudflare/OpenNext output.
- There is no participant revocation or receipt deletion feature yet.
- Automated Node.js tests cover exact-origin checks, JSON content-type and size handling, UUID validation, participant cookie naming, SHA-256 output, rate-limit enforcement and participant capability isolation (receipt ID + participant ID + hashed token), and OCR image signature, MIME mismatch, malformed base64 and size validation. The rate-limit contract uses a lightweight D1 mock.
- SQLite integration tests execute both production migrations in an in-memory SQLite database and verify receipt-boundary enforcement, over-claim prevention on INSERT, over-claim prevention on UPDATE, cross-receipt UPDATE rejection and valid quantity adjustments.
- Selection deletion is additionally scoped to the receipt ID in its SQL predicate, providing defense in depth for legacy or inconsistent rows.
- GitHub Actions runs ESLint, the security test suite and a Next.js production build on pushes to `main` / this hardening branch and pull requests targeting `main`.
- Current dependency metadata has a peer-range conflict: the resolved `@opennextjs/cloudflare` release does not declare compatibility with the repository's pinned Next.js `16.2.7`. CI currently uses `--legacy-peer-deps` to proceed with verification; this is a compatibility warning to resolve by aligning/pinning the adapter and Next.js versions, not a security control.
- GitHub Actions run `45118517568` completed successfully: ESLint, all 15 automated tests and the Next.js production build passed. Live Cloudflare D1 migration, browser multi-session tests and production verification remain outstanding.

## Verification checklist

- Create a receipt with valid totals; reject mismatched totals, empty names, negative values, more than 100 items and oversized JSON.
- Submit receipt creation and OCR from a different Origin; expect 403.
- Join a receipt; confirm the participant cookie is HttpOnly, Secure and SameSite=Strict, and no token is returned in JSON or stored in plaintext.
- Refresh the participant page; confirm the cookie restores only that browser's participant identity.
- Change a participant ID in the selection request; expect 403. Remove the cookie; expect 401.
- Attempt to select an item from another receipt; expect 409 and no database change.
- Have two participants concurrently claim the final available unit; only one write should succeed.
- Exceed each configured rate limit; requests after the limit must receive 429.
- Confirm GET share endpoints remain public by design and return no-store cache headers.
- Confirm browser response headers include CSP, HSTS, frame denial, no-sniff and referrer policy.
