# FiFantasy — context for Claude

This file is loaded into every Claude Code session opened in this repo. Read
it first. It captures the project vision, current state, design decisions,
and pending work, so a new chat can continue exactly where the previous one
left off.

---

## Mission

Private fantasy football app for **4 friends** for the **FIFA World Cup 2026**
(June 11 – July 19, 2026). The user wants this to be *really good*, not
quick-and-dirty. The user has explicitly chosen quality over speed at multiple
inflection points.

### Format (locked)

- **Auction draft**, exclusive ownership, 4 managers
- **200 credits/manager**, 20-player squad (2 GK / 6 DEF / 7 MID / 5 FWD)
- 11 starters + 4 bench, captain ×2, vice auto-promotes if captain plays 0 min
- **League MOTM by peer vote** (not API) — better trash talk
- Match stats entered by rotating "stewards" (manual entry path; saves API cost)
- Stage multipliers: group ×1.0 · R16 ×1.4 · QF ×1.6 · SF ×1.8 · Final ×2.0

### Hard constraints

- **$0 infra budget** (except Gemini at <$5 total)
- 4 trusted friends — RLS is accident prevention, not adversarial
- 1 league row, hardcoded — no multi-tenancy
- No transfers in v1 (so no wildcard / free-hit chips)
- **Trades Lite** planned for Phase 6 (player-for-player, 2 per manager, mutual accept, locked at knockouts)
- AI scope: **one feature only** — Smart Search (Gemini Flash, natural language → DB query)

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack, server actions) |
| Language | TypeScript |
| Styling | Tailwind v4 + shadcn-compatible theme variables |
| Database | Supabase Postgres |
| ORM | Drizzle (schema in `lib/db/schema/`) |
| Auth | Supabase Auth — **email + password** (was magic-link, switched in Phase 0 due to 2/hr rate limit) |
| Realtime | Supabase Realtime (postgres_changes) |
| Scheduled jobs | Inngest (planned for Phase 5; currently manual via `pnpm ingest`) |
| AI | Google Gemini 2.5 Flash Lite |
| Hosting | Vercel (Hobby tier) |
| Package mgr | pnpm 11 |

### Critical pnpm config — don't lose this

`pnpm-workspace.yaml` has `allowBuilds: { sharp, esbuild, protobufjs, '@sentry/cli', unrs-resolver }: true`. Without this, `pnpm install` exits with code 1 (build-script approval gate), which in turn breaks **every** pnpm script via the `verifyDepsBeforeRun` hook. `.npmrc` also has `verify-deps-before-run=false` for belt-and-suspenders.

---

## Phases shipped

### Phase 0 — Foundations (commit `Phase 0:` + `fix(pnpm):` + `fix(db):` + `auth:`)

- Next.js 16 scaffold
- Email + password auth (magic-link removed; rate-limit pain)
- Postgres trigger `handle_new_auth_user` auto-creates profile on sign-up
- Supabase SSR helpers, `proxy.ts` auth gate
- 13 tables: profiles, leagues, league_members, tournaments, countries, real_players, fixtures, fixture_lineups, match_events, player_match_stats, ai_search_cache, ai_search_log, ingestion_runs, audit_log
- App shell, dashboard placeholder

### Phase 1 — Football data ingestion (commit `Phase 1:`)

- **football-data.org** client (free tier, 10 req/min) with X-Auth-Token, rate-limit headers, 429 retry
- WC 2026 = competition `WC` / id `2000`, free-tier accessible
- Bulk upsert: 1 tournament · 48 countries · 1213 players · 72 fixtures (32 knockout placeholders skipped, will fill as bracket draws)
- `/admin/ingest` UI + recent-runs table from `ingestion_runs`
- `pnpm ingest` CLI for one-shot runs

### Phase 2.1 — Rating engine layers 1 + 2 (commit `Phase 2.1:`)

- Transfermarkt staging via dcaribou/transfermarkt-datasets Cloudflare R2 CSV (no auth needed)
- 47,637 TM players imported; pg_trgm fuzzy-matched to our 1213 WC players (1005 high / 1 medium / 125 low / 82 none)
- Layer 1: position baseline (50) + age curve adjustment
- Layer 2: log10(market_value_eur), z-scored within position bucket, mapped to 0-100
- Blend weights: high 0.25/0.75, medium 0.5/0.5, low 0.8/0.2, none 1.0/0.0
- `pnpm import:tm`, `pnpm compute:ratings`

### Phase 2.2 — Refinements (commit `Phase 2.2:`)

- **Per-position age curve** (GKs peak 28-34, DEFs 26-31, MIDs 25-30, FWDs 24-28)
- **Sub-position bucketing** (GK/CB/FB/DM/CM/AM/W/ST) — fixed the "wingers vs defensive mids in same MID pool" problem
- **Gemini Layer 3** (`gemini-2.5-flash-lite`, 4.5s/req for 15 RPM limit) — 316 candidates (top-30 per position + all none/low) — $0.10 total. Cached in `gemini_research` table; default re-runs skip API calls.

### Phase 2.3 — Layer 4 + FBref + reporter player page (commit `Phase 2.3:`)

- **Layer 4 international pedigree**: caps_volume + goals/cap z-scored within position → additive ±5 adjustment. Fixed the Mac-Allister-vs-Rice complaint (Mac Allister 88.7 > Rice 86.2 in MID now).
- **FBref Kaggle import** (`hubertsidorowicz/football-players-stats-2025-2026`): user downloads CSV manually to `lib/data/fbref_25_26.csv`, `pnpm import:fbref`. 2779 rows → 493 matched WC players (top-5-league coverage ~40% of squad pool).
- **Reporter-style player detail page**: hero with rank-in-position bar, narrative built from real stats (goals/assists/per-90s/saves), position-aware stat grid, collapsible technical breakdown.
- **Position normalization tightened**: ±3σ → ±42 (was ±2.5σ → ±50). No more 6-way ties at 100.

### Phase 2.4 + 2.5 — Bracket sim + Price engine (commit `Phase 2.4 + 2.5:`)

- **Country Elos** seeded for all 48 WC participants (`pnpm seed:elos`). FIFA code vs ISO code aliases handled (DEU vs GER, POR vs PRT etc.)
- **Bracket Monte Carlo** in `lib/sim/bracket.ts` (10k sims in 0.5s). Poisson-from-Elo goal model. Top results: ARG 22.2% champion, FRA 18.1%, ESP 15.3%, ENG 12.1%, BRA 10.0%
- **Price engine** in `lib/price/engine.ts`: rating^3.5 × P(starter) × expected_matches → raw, normalized so top-80 = 4 × 200 × 1.10 = 880
- Sample prices: Mbappé 46, Rodri 39, Mac Allister 28, Hakimi 23
- **Tiers**: 6 superstar / 14 star / 40 starter / 100 rotation / 1053 depth
- Players list now defaults to sort-by-price with tier badges

### Phase 3.1 — Auction draft schema + state machine (commit `Phase 3.1:`)

- 6 new tables: drafts, auction_lots, auction_bids, proxy_bids, manager_budgets, rosters
- Partial unique index on rosters(league, player) WHERE dropped_at IS NULL = exclusive ownership invariant
- `on_lot_sold` trigger: when status flips to 'sold', creates roster row + bumps manager_budgets atomically
- State machine in `lib/auction/state.ts`: maxBidNow, validateBid, nextNominator
- Server actions in `app/(app)/draft/actions.ts`: startDraft, nominate, placeBid (with SELECT FOR UPDATE), resolveExpired
- `pnpm seed:league` creates league + adds all profiles as members + creates scheduled draft

### Phase 3.2 — Realtime + countdown + anti-snipe + proxy (commit `Phase 3.2:`)

- Supabase realtime publication on auction tables (`lib/db/sql/009_*`)
- `AuctionRoom.tsx` client component: subscribes via supabase-js, router.refresh() on change
- 250ms-tick local countdown timer; CountdownBar (green→amber→red) + CountdownText with pulse
- Anti-snipe: bid in last 10s → closes_at = now + 15s, status flips to 'closing'
- Proxy bids: `lib/auction/proxy.ts` resolves proxy ladder in transaction. Drops a proxy if its holder runs out of position cap-space.
- Quick-bid buttons (+1, +5, +10, MAX)

### Phase 3.3 — Commissioner console (commit `Phase 3.3:`)

- `/draft/admin` page
- Actions: pauseDraft / resumeDraft (shifts closes_at forward by pause duration) / voidLot / manualAwardLot / resetDraft (requires typing "RESET")
- Every action writes to `audit_log` with actor + before/after jsonb
- AuctionRoom shows paused banner, disables bid form when paused

---

## Phase plan — what's next

Calendar reminder: today is around May 14-15, 2026. **WC kicks off June 11.** Draft target was June 9 but with auction system done early, can be earlier.

### Phase 3.4 — User-driven dry run

Deploy to Vercel, 4 friends sign up, run a full practice draft. **No more engineering needed** unless bugs surface.

Vercel env vars needed:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ALLOWED_EMAILS`, `GEMINI_API_KEY`, `NEXT_PUBLIC_SITE_URL` (set to deployed URL after first build)

Supabase needs the Vercel URL added under **Authentication → URL Configuration → Site URL + Redirect URLs**.

### Phase 5 — Lineups, stat entry, scoring (next big block)

- **Lineup builder = pitch view** with formation picker (3-4-3, 4-3-3, 4-4-2, 4-5-1, 5-3-2, 5-4-1, 3-5-2). Drag-drop roster cards into slots. Captain/vice picker. Bench order. Locks at first kickoff of matchday.
- **Stat entry workflow** — rotating "stewards" assigned per fixture, 60-min window after FT, mobile-first 3-min-completion form. Goals/scorers auto-populated from football-data.org; everything else (lineups, assists, cards, subs, MOTM) manual.
- **MOTM peer vote** (24h window after stats finalize, players in that match, ties split bonus)
- **Scoring engine** `score.matchday(n)` — pure function over snapshot, idempotent, replayable. See plan §4 for points table.
- **Live rating updates** during the tournament — Bayesian update from match performance + form_rating from last 3 games

### Phase 6 — Predictions, chips, trades, Smart Search

- Score predictions UI + scoring
- Bracket builder (locks at knockout start)
- Chips: Triple Captain + Bench Boost only (no Wildcard/Free Hit since no transfers)
- **Trades Lite**: player-for-player, 2/manager, mutual accept, locked at knockouts
- **Smart Search**: ⌘K palette, Gemini Flash with function-calling tool schema (find_players, find_fixtures, find_lineups, etc.), result caching in `ai_search_cache`. **No raw SQL ever leaves the server.**
- Web push for goals by your players

### Phase 7 — Polish

- **FIFA-style player cards** (CSS-only, no images) on `/players` and `/team` — gradient by tier, position color, rating top-left, country flag, name across bottom
- Mobile audit
- Awards page (golden boot among-owned, biggest blowout, etc.)
- Manager Elo + skill/luck decomposition (hidden during tournament, revealed on awards)
- Draft recap page (built from auction_bids timeline)
- End-of-tournament awards (generated narratives)

---

## Design principles the user cares about

1. **Empirical, not generative.** When in doubt, ground in real data. The rating engine is layered (deterministic → market value → AI-augmented → pedigree) so every contribution is auditable, not vibes.
2. **Transparent.** Every rating + price shows its breakdown. Audit log for every admin action. The breakdown should read like a reporter's notes, not a spreadsheet.
3. **Subtle AI.** The user explicitly rejected heavy generative features (AI Pundit, daily recaps, etc.) in favor of one ambient feature (Smart Search). Don't propose new AI features without asking.
4. **No transfers, but trades planned.** v1 has zero in-tournament roster mutations except the planned Trades Lite in Phase 6.
5. **For 4 friends, polished is better than fast.** They have time to do this right.

---

## Useful commands

```bash
pnpm dev                    # next dev (Turbopack)
pnpm typecheck              # tsc --noEmit
pnpm build                  # next build (verified clean as of Phase 3.3)
pnpm db:push                # drizzle push (interactive; usually paste SQL files instead)
pnpm apply-sql <file>       # apply a hand-written SQL file (bypasses drizzle TUI)
pnpm ingest                 # football-data.org full ingest
pnpm import:tm              # Transfermarkt CSV import (auto-fetches from R2)
pnpm import:fbref           # FBref Kaggle CSV import (manual file at lib/data/fbref_25_26.csv)
pnpm compute:ratings        # rerun rating engine (uses cached Gemini)
pnpm compute:ratings --with-ai  # refresh Gemini cache (~$0.10, ~25 min for 316 candidates)
pnpm seed:elos              # seed country Elos
pnpm sim:bracket            # 10k Monte Carlo, writes expected_matches
pnpm compute:prices         # rating + expected_matches → price + tier
pnpm seed:league            # create league + add all profiles as members
pnpm purge:users            # NUCLEAR: delete all auth users + reset draft (asks for YES confirmation)
```

---

## Gotchas

- **football-data.org country codes are FIFA codes** (DEU, POR, HRV, ALG, RSA, HTI, ANT, CPV) — not ISO 3166-1 alpha-3. Both are seeded for Elo lookup.
- **Drizzle's `db.execute` returns snake_case keys** (real_player_id, not realPlayerId). The query builder API returns camelCase. Don't mix them up.
- **`max(rating)` ≠ "latest rating"** — use `distinct on (real_player_id) order by as_of desc` for the time-series rating table.
- **Gemini 2.0 Flash is deprecated for new accounts** — use `gemini-2.5-flash-lite` (15 RPM free tier).
- **Bid validation must run inside SELECT FOR UPDATE** — otherwise concurrent bids race.
- **FBref dataset has no xG** in the Hubertsidorowicz top-5 CSV. Plan B is a different dataset; for now we use goals/assists/shots/saves/tackles which is enough.
- **Trigger on auth.users insert** lives in SQL outside Drizzle's schema management — see `lib/db/sql/001_profile_trigger.sql`.

---

## Where the key business logic lives

| Concept | File |
|---|---|
| Rating layers | `lib/rating/{baseline,market-value,layer3,pedigree,blend,match,buckets}.ts` |
| Rating compute | `scripts/compute-ratings.ts` |
| Bracket sim | `lib/sim/bracket.ts` |
| Price engine | `lib/price/engine.ts` |
| Auction state machine | `lib/auction/state.ts` |
| Proxy resolution | `lib/auction/proxy.ts` |
| Auction server actions | `app/(app)/draft/actions.ts` + `app/(app)/draft/admin/actions.ts` |
| Auction UI | `app/(app)/draft/AuctionRoom.tsx` |
| Schema (Drizzle) | `lib/db/schema/` |
| Hand-written SQL migrations | `lib/db/sql/` (numbered 001-009) |

---

## User profile

- One person driving the project (handle: `test` display name initially, plans to delete and re-sign-up with proper name for production)
- 4 friends in the league. Emails in `.env.local`:
  - rishi.suyash01@gmail.com
  - adityapansare2404@gmail.com
  - sanskarchaudhari@gmail.com
  - sumedhnakodx@gmail.com
- On Windows with PowerShell (paths use backslashes, but bash via Git Bash also works)
- pnpm 11 with strict build-script gating (handled in pnpm-workspace.yaml)
- Repo: https://github.com/SuyashPatil98/auctionBhai

## When you (Claude) resume

Read the latest 5-10 commit messages with `git log --oneline -10` to confirm the most recent state. Phase commit messages are detailed and authoritative about what landed.

The user prefers:
- Plans before code, especially for big phases
- Honest tradeoffs over optimism
- Concrete next actions over open-ended questions
- Pragmatic empiricism over theoretical correctness — but they'll push for real data when the heuristic is too soft (they pushed back on "trust the auction price" and wanted FBref data instead)
