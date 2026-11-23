# BayarLah security baseline

This document records security controls for the Cloudflare Workers + D1 application. BayarLah intentionally uses public receipt links; receipt content and participant summaries are readable by anyone who has the share URL. A participant capability is required to mutate that participant's selections.

## Implemented on this branch

- Same-origin validation for state-changing receipt, participant, selection and OCR endpoints.
- Bounded JSON request bodies and strict validation for receipt titles, amounts, item names, quantities and OCR image types/sizes.
- D1-backed fixed-window rate limits for receipt creation, participant joins and selection updates; OCR has its own IP-based quota.
- Participant capability tokens are cryptographically random, stored only as SHA-256 hashes in D1 and issued in HttpOnly, Secure, SameSite=Strict cookies. Public participant IDs are not authorization secrets.
- Selection writes verify the capability token against the participant and receipt, validate item ownership and prevent aggregate claims from exceeding item quantity.
- OCR provider keys remain server-side; provider errors and image/prompt contents are not returned or logged. Provider calls have a hard timeout and model allowlist.
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
- Selection quantity checks happen before writes. Concurrent updates can race; a transaction/constraint-based reservation model should make aggregate caps strictly atomic.
- Expired rate-limit buckets need scheduled cleanup or bounded retention.
- CSP permits inline scripts for compatibility with current Next.js rendering. A nonce-based CSP can tighten this after validating Cloudflare/OpenNext output.
- There is no participant revocation or receipt deletion feature yet.
- Automated tests and production verification have not been run for this change. Run lint, build, migrations and multi-session smoke tests before merge/deploy.
