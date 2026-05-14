# FiFantasy

Private 4-manager fantasy football app for the FIFA World Cup 2026.
Auction draft · exclusive ownership · matchday lineups · peer-voted MOTM ·
AI-powered Smart Search.

## Stack

- Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind v4 · shadcn/ui
- Supabase (Postgres, Auth, Realtime, Storage) — magic-link auth
- Drizzle ORM + drizzle-kit
- Inngest (scheduled jobs + retries)
- Gemini 2.5 Flash (Smart Search, free tier)
- football-data.org + TheSportsDB (free data sources)
- Vercel (Hobby tier)
- Sentry (errors, free tier)

## Phase 0 — Foundations (done)

- Next.js 16 + TS + Tailwind v4 scaffold
- Supabase SSR helpers, auth via `proxy.ts`
- Email + password sign-up/sign-in, email allowlist
- Postgres trigger auto-creates `profiles` row on sign-up
- Drizzle schema for identity, real-world entities, AI cache, ops
- App shell (nav, login, dashboard placeholder)

## Local setup

```bash
# 1. Copy env template and fill it in
cp .env.example .env.local

# 2. Install
pnpm install

# 3. Push schema to Supabase
pnpm db:push

# 4. Dev server
pnpm dev
```

Required env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ALLOWED_EMAILS`.

## Scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start dev server (Turbopack) on :3000 |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint |
| `pnpm db:generate` | Generate SQL migration from Drizzle schema |
| `pnpm db:push` | Push schema directly (dev) |
| `pnpm db:migrate` | Apply generated migrations (prod) |
| `pnpm db:studio` | Open Drizzle Studio |

## Project layout

```
app/
  (auth)/login/        magic-link sign-in
  (app)/dashboard/     authenticated dashboard
  auth/callback/       magic-link return handler
components/layout/     nav
lib/
  db/                  Drizzle client + schema/
  supabase/            server, client, middleware helpers
  utils/cn.ts          Tailwind className merge
  env.ts               zod-validated env access
proxy.ts               Next.js 16 auth gating
drizzle.config.ts
```

## Format

- **4 managers, auction draft.** 200 credits · 20-player squad (2 GK / 6 DEF / 7 MID / 5 FWD).
- 11 starters + 4 bench · captain ×2 · vice auto-promotes if captain plays 0 min.
- Stage multipliers: group ×1.0 · R16 ×1.4 · QF ×1.6 · SF ×1.8 · Final ×2.0.
- League MOTM by peer vote (not API).
- Match stats entered by rotating "stewards" (one per fixture).

## Status

Phase 0 complete · Phase 1 (ingestion) next · Draft target June 9 · Kickoff June 11.
