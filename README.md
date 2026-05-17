# FiFantasy

> Solo end-to-end design, build, deploy and ops of a fantasy football data system for the FIFA World Cup 2026. **One engineer, every layer** — multi-source ETL → 4-layer ML rating model → 10k Monte Carlo bracket sim → realtime scoring engine → Next.js app → two live deployments.

**Live**
- App: [auction-bhai.vercel.app](https://auction-bhai.vercel.app) — click **"View as Guest"** on the sign-in screen to explore the running league read-only. No account needed.
- Source: this repo

---

## What one engineer built

| Layer | What's in it |
|---|---|
| **Data ingestion** | 4 source connectors (football-data.org REST API, Transfermarkt CSV via R2, Hubertsidorowicz FBref Kaggle CSV, hand-curated WC pedigree JSON). Rate-limit aware (10 req/min, 429 retry with backoff). Idempotent with `ingestion_runs` audit table. **1,213 WC players + 47,637 TM players + 25k materialized factor percentiles** in Postgres. |
| **Entity matching** | `pg_trgm` fuzzy match across 47k Transfermarkt rows to 1,213 WC players. Tiered confidence buckets (high/medium/low/none) drive downstream blend weights. **~94% high/medium recall on the WC pool.** |
| **Player rating model** | 4-layer blend, position-bucketed: **L1** position baseline + per-position age curve (GKs peak 28-34, FWDs 24-28) · **L2** `log10(market_value_eur)` z-scored within sub-position bucket (GK/CB/FB/DM/CM/AM/W/ST) · **L3** Gemini 2.5 Flash Lite LLM augmentation (316 candidates, cached, $0.10 total cost) · **L4** international pedigree z-score (caps + goals/cap). Blend weights vary by match-confidence. 30 pure-function unit tests. |
| **Bracket simulator** | 10k-sample Monte Carlo using Poisson-from-Elo goal model. **Runs in ~500ms.** Outputs P(champion), P(reach knockouts), expected matches per nation. Validated against bookmaker odds within 2 percentage points for top-6 teams. |
| **Price engine** | `rating^3.5 × P(starter) × expected_matches → normalized` so top-80 = 4× budget. Tiers (superstar / star / starter / rotation / depth) derived from price distribution. |
| **Scoring engine** | Pure function over a (lineup × stats × fixtures × votes) snapshot. Position-relative points (FPL-tuned), captain ×2, vice ×1.5 on captain-DNP, bench auto-substitution at same position, idempotent re-runs on any state change. **Hooked into 6 mutation paths** (stat edit, lineup save, MOTM resolve, finalize, unfinalize, API import). |
| **Realtime backend** | Supabase Postgres logical replication → Realtime Channels → browser. Friends watching `/matchday/[n]` during a live match see other managers' scores tick up as steward stats land. **~150ms steward-write to UK-friend-screen** after Tokyo → Mumbai DB migration. |
| **Auction state machine** | Live multi-bidder room with anti-snipe extension, proxy max-bid ladder, transactional `SELECT FOR UPDATE` bid validation, pause/resume, opt-out passing. Built on a partial unique index that enforces single-active-roster-per-player invariant. |
| **Weekly trading window** | Tuesday-only window for sell-back (50% refund), free-agent sealed-bid auction (24h blind, first-price, earliest-tie-break), and manager-to-manager trades with credit balancing. Position-quota validator after every mutation. |
| **Frontend** | 14-route Next.js 16 App Router app. Server components everywhere data-heavy, client components only where interaction or realtime needs them. Timezone-aware kickoff display (browser-default with optional /account pin). |
| **Deployment + ops** | Two Vercel projects from one branch, env-driven mode flag (`NEXT_PUBLIC_SITE_MODE=private|demo`), separate Supabase projects, vercel.json cron-ready for nightly demo reset. **22 numbered SQL migrations**, idempotent application script. |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Data sources                                                     │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ football-data  │  │ Transfermarkt│  │ FBref Kaggle │  ...    │
│  │ REST · 10/min  │  │ R2 CSV · 47k │  │ CSV · 2.7k   │         │
│  └────────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
└───────────┼─────────────────┼─────────────────┼──────────────────┘
            │ rate-limit aware │ pg_trgm match  │ schema map
            ▼                  ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│  ETL — idempotent, run-tracked (ingestion_runs)                  │
│  scripts/{ingest, import-transfermarkt, import-fbref}.ts          │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  Postgres (Supabase, Mumbai region, pinned)                      │
│  22 numbered migrations · partial unique indexes · trigger-       │
│  maintained budgets · logical replication for realtime           │
└────────────┬─────────────────────────┬───────────────────────────┘
             │                         │
             ▼                         ▼
┌──────────────────────┐     ┌──────────────────────────────┐
│  Compute layer       │     │  Realtime layer              │
│                      │     │                              │
│  lib/rating/* — 4    │     │  Supabase Realtime           │
│  layer blend         │     │  postgres_changes → channels │
│                      │     │                              │
│  lib/sim/bracket.ts  │     │  Browser subscribes →        │
│  10k Monte Carlo     │     │  router.refresh() on push    │
│                      │     │                              │
│  lib/scoring/*       │     │  Latency: ~150ms p95 cross-  │
│  pure + idempotent   │     │  continent (Mumbai→UK)       │
└──────────┬───────────┘     └──────────┬───────────────────┘
           │                            │
           └────────────┬───────────────┘
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Next.js 16 App Router (14 routes)                               │
│  Server Components / Server Actions for mutations                │
│  Client Components for realtime + interaction                    │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
       ┌───────────────────────────────────────────┐
       │  Vercel · 2 projects · 1 branch           │
       │  Env-driven: private / demo deployment    │
       └───────────────────────────────────────────┘
```

---

## Design decisions worth calling out

### 1. Tokyo → Mumbai DB region migration (measured ~100ms p95 improvement)
Initial Supabase project was `ap-northeast-1` (Tokyo). Realtime push from steward-bid in India → UK friend's browser was ~250ms (~100ms India→Tokyo + ~150ms Tokyo→UK). UK friend was losing bid races. Migrated to `ap-south-1` (Mumbai) via a two-phase script that applies migrations in order then copies data in FK dependency order. New cross-continent push: ~150ms. Documented before/after, kept the migration script for future regional changes.

`scripts/migrate-to-new-db.ts`

### 2. Layered rating model with confidence-driven blend weights
Each player gets a rating from up to 4 layers. Blend weights aren't fixed — they shift based on how confident the entity-matching step was. High-confidence TM match (~94% of pool): 25% baseline + 75% market-value-driven. No TM match (the rare 6%): 100% baseline. This lets the model degrade gracefully on missing data instead of producing garbage. Per-position age curves and sub-position bucketing solved the "wingers in same MID pool as defensive mids" failure mode that an earlier flat-position model had.

`lib/rating/{blend,buckets,baseline,market-value,layer3,pedigree}.ts`

### 3. Idempotent realtime scoring engine
Scoring is a pure function: `(manager_lineups, player_match_stats, fixtures, motm_votes) → matchday_scores`. Re-runs on every mutation that touches the inputs (stat edit, MOTM resolve, lineup save, API import, finalize, unfinalize). Safe because the function is deterministic — re-runs produce identical output. Anchored by 30 unit tests covering each scoring rule + the captain/vice multipliers + bench auto-sub edge cases. Combined with Supabase Realtime publication on `matchday_scores`, friends watching `/matchday/[n]` during a live match see points tick up in real time without polling.

`lib/scoring/{points,matchday,sweep}.ts` · `scripts/test-scoring.ts`

### 4. Partial unique indexes as state machine invariants
`UNIQUE(league_id, real_player_id) WHERE dropped_at IS NULL` enforces "a player is on at most one manager's active roster" at the DB level — no application code can violate it. Same pattern for `UNIQUE(window_key, proposer_id, recipient_id, proposer_player_id, recipient_player_id) WHERE status = 'pending'` to prevent duplicate trade proposals. State machine correctness ends up in the schema, not in the app layer where it can drift.

`lib/db/sql/008_auction_schema.sql` · `lib/db/sql/022_trades.sql`

### 5. Read-only guest access without a separate deployment
One Supabase user (`guest@auction-bhai.demo`) lives outside `league_members`. The "View as Guest" button on `/login` signs anyone in as that user. Because every mutation server action gates on `requireLeagueMember()`, the guest can browse the entire app (draft, lineups, fixtures, leaderboard, trade history) in real time — but can't bid, edit, or trade. Read-only by construction, not by client-side checks.

This avoided a second Vercel project + a parallel Supabase project + a seed-and-reset workflow. One environment, one code path, one extra database row.

`lib/util/guest.ts` · `app/(auth)/login/actions.ts`

---

## Tech stack (and why)

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | Server components + server actions = less boilerplate for data-heavy pages |
| Language | TypeScript | Strict types across DB schema → API → UI cut whole classes of bugs |
| Database | Supabase Postgres | Postgres + Realtime + Auth in one — cuts vendor count for a solo project |
| ORM | Drizzle | Type-safe queries; drops to raw SQL where the query is gnarlier than the ORM |
| Realtime | Supabase Realtime (logical replication → channels) | Push without managing a websocket layer |
| LLM | Gemini 2.5 Flash Lite | Free tier covers the 316-candidate rating Layer-3 (~$0.10 total) |
| Data sources | football-data.org · Transfermarkt CSV · FBref Kaggle | Free, well-documented, sufficient coverage |
| Hosting | Vercel (pinned `bom1` region) | Region pin matters: BOM1 server + Mumbai DB = ~5ms; BOM1 server + Tokyo DB was ~120ms |
| Package mgr | pnpm 11 | Strict, fast, handles the build-script approval correctly |

**Why TypeScript not Python+Spark?** Realtime UX was the primary design constraint — one TS codebase across server actions + client components beat the cost of an additional Python service for the data work. The data patterns (ETL idempotency, fuzzy matching, layered model with confidence weights, Monte Carlo) translate directly to my professional PySpark / Airflow stack at Capgemini.

---

## Local setup

```bash
# 1. Env
cp .env.example .env.local
# fill in Supabase + football-data.org keys

# 2. Install
pnpm install

# 3. Apply migrations
for f in lib/db/sql/0*.sql; do pnpm apply-sql "$f"; done

# 4. Ingest WC fixtures + players
pnpm ingest

# 5. Build the model
pnpm import:tm          # Transfermarkt 47k → fuzzy match
pnpm compute:ratings    # 4-layer blend
pnpm seed:elos
pnpm sim:bracket        # 10k Monte Carlo
pnpm compute:prices

# 6. Tests
pnpm test:scoring       # 30 cases
pnpm test:rating        # 10 cases

# 7. Dev server
pnpm dev
```

Required env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `FOOTBALL_DATA_API_KEY`.

---

## Project map — where the interesting code lives

| Concept | File |
|---|---|
| Rating model — 4 layers | `lib/rating/{baseline,market-value,layer3,pedigree,blend,buckets}.ts` |
| Rating pipeline | `scripts/compute-ratings.ts` |
| Monte Carlo bracket sim | `lib/sim/bracket.ts` · `scripts/simulate-bracket.ts` |
| Price engine | `lib/price/engine.ts` |
| Scoring engine (pure) | `lib/scoring/{points,matchday,sweep}.ts` |
| Auction state machine | `lib/auction/{state,proxy,finalize}.ts` |
| Trading window logic | `lib/trading/{window,quota}.ts` |
| ETL connectors | `lib/external/football-data.ts` · `scripts/{ingest,import-transfermarkt,import-fbref}.ts` |
| Schema (Drizzle) | `lib/db/schema/` |
| Migrations | `lib/db/sql/` (numbered 001-022) |
| Test suites | `scripts/test-{scoring,personal-rating}.ts` |

---

## About the author

Built solo by **Suyash Patil**.

3.5 years professional experience at Capgemini building data-intensive backend and AI/ML systems in financial services (Python · PySpark on EMR · Airflow MLOps · GPT-4 document pipelines). M.Tech Data Science from IIIT Bhopal. National Runner-Up, Smart India Hackathon 2024.

This project is a side build that proves what the CV bullets imply: **I can own a data system end-to-end** — pipeline, model, simulation, scoring engine, realtime backend, UI, deployment, and ops, alone.

If you're hiring for a senior generalist who can ship across the data + ML + backend stack, the source is above and the demo is one click away.
