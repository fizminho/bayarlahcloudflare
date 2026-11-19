# BayarLah

Upload a receipt, share a link, split the bill. Runs on Cloudflare Workers + D1.

## Setup

```bash
npm install
npm i -D wrangler@latest @opennextjs/cloudflare@latest

npx wrangler login
npx wrangler d1 create bayarlah          # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put GEMINI_API_KEY
npm run deploy
```

## Local dev

```bash
cp .dev.vars.example .dev.vars           # add your Gemini key
npm run db:migrate:local
npm run dev                              # or `npm run preview` to run in workerd
```
