import Link from "next/link";

export const metadata = {
  title: "System design — FiFantasy",
};

export default function SystemDesignPage() {
  return (
    <div className="space-y-12 max-w-4xl">
      <header className="space-y-3">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">
          System design
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Architecture, state machines, and the trade-offs behind them
        </h1>
        <p className="text-sm text-muted-foreground">
          The diagrams an interviewer would want to talk through. The{" "}
          <Link
            href="/about"
            className="text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            about page
          </Link>{" "}
          covers the &quot;what&quot;; this page covers the &quot;how it
          actually fits together.&quot;
        </p>
      </header>

      <Section title="1. End-to-end architecture">
        <pre className="rounded-lg border border-border bg-card p-4 text-[10px] sm:text-xs overflow-x-auto leading-tight">{`
┌──────────────────────────────────────────────────────────────────┐
│  EXTERNAL DATA SOURCES                                           │
│                                                                  │
│  ┌─────────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │ football-data   │ │ Transfermarkt│ │ FBref Kaggle │         │
│  │ /v4 REST · 10/m │ │ R2 CSV · 47k │ │ CSV · 2.7k   │         │
│  │ → fixtures      │ │ → market     │ │ → club stats │         │
│  │ → goals, cards  │ │   value      │ │              │         │
│  │ → match data    │ │ rows         │ │              │         │
│  └────────┬────────┘ └──────┬───────┘ └──────┬───────┘         │
│           │                  │                │                  │
└───────────┼──────────────────┼────────────────┼──────────────────┘
            │ rate-limited     │ idempotent     │ schema-mapped
            │ 429-retry        │ upsert         │
            ▼                  ▼                ▼
┌──────────────────────────────────────────────────────────────────┐
│  ETL — scripts/{ingest, import-transfermarkt, import-fbref}.ts   │
│  Idempotent · run-tracked (ingestion_runs) · pg_trgm fuzzy match │
│                                                                  │
│      ↓ fuzzy-match 47k → 1213 WC players (~94% recall)           │
│                                                                  │
│      ↓ Gemini 2.5 Flash Lite augment top 316 (cached)            │
│                                                                  │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│  POSTGRES (Supabase · Mumbai · pinned bom1)                      │
│                                                                  │
│  22 numbered migrations · drizzle ORM + raw SQL where it matters │
│                                                                  │
│  Invariants in the schema (not the app layer):                   │
│   · partial unique index: 1 active roster per player per league  │
│   · partial unique index: 1 pending trade per player-pair        │
│   · trigger-maintained budget aggregates                         │
│   · REPLICA IDENTITY FULL on rosters (cascade-delete safe)       │
│                                                                  │
│  Logical replication slot → supabase_realtime publication        │
└────────────┬─────────────────────────┬───────────────────────────┘
             │                         │
             ▼                         ▼
┌──────────────────────┐     ┌──────────────────────────────────┐
│  COMPUTE             │     │  REALTIME                        │
│                      │     │                                  │
│  4-layer rating      │     │  Supabase Realtime (channels)    │
│   L1 baseline        │     │  postgres_changes per table      │
│   L2 log market val  │     │                                  │
│   L3 LLM augmented   │     │  Browser subscribes:             │
│   L4 intl pedigree   │     │   · matchday_scores              │
│  → blend weights     │     │   · auction_lots/bids            │
│    by match confidence│    │   · trades                       │
│                      │     │   · motm_votes                   │
│  Bracket sim:        │     │   · free_agent_bids              │
│   10k Monte Carlo    │     │                                  │
│   Poisson-from-Elo   │     │  On change → router.refresh()    │
│   ~500ms             │     │                                  │
│                      │     │  Cross-continent latency:        │
│  Pricing engine:     │     │   ~150ms p95 Mumbai → UK         │
│   r^3.5 × P(start) × │     │   (was ~250ms when in Tokyo)     │
│   expected_matches   │     │                                  │
│                      │     │                                  │
│  Scoring engine:     │     │                                  │
│   pure fn, idempotent│     │                                  │
│   30 unit tests      │     │                                  │
│   hooks into 6       │     │                                  │
│   mutation paths     │     │                                  │
└──────────┬───────────┘     └──────────┬───────────────────────┘
           │                            │
           └──────────────┬─────────────┘
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│  NEXT.JS 16 APP ROUTER · 14 routes · 2 layouts                   │
│                                                                  │
│  Server components everywhere data-heavy (≈80% of pages)         │
│  Client components only for interaction + realtime hooks         │
│  Server actions for every mutation (gated by requireLeagueMember)│
│  Middleware: route auth, locale-aware redirects                  │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
        ┌──────────────────────────────────────┐
        │  VERCEL · region pinned · bom1       │
        │  Region pin matters:                 │
        │   BOM1 server + Mumbai DB = ~5ms     │
        │   BOM1 server + Tokyo DB was ~120ms  │
        │                                      │
        │  Pre-launch: friends-only invite     │
        │  Public: "View as Guest" button on   │
        │  /login → shared read-only user      │
        └──────────────────────────────────────┘
`}</pre>
      </Section>

      <Section title="2. Auction state machine">
        <p className="text-xs text-muted-foreground mb-3">
          The auction is a multi-bidder live room. State transitions are
          transactional + audit-logged. Anti-snipe extension + proxy
          ladder + opt-out passing are layered on top.
        </p>
        <pre className="rounded-lg border border-border bg-card p-4 text-[10px] sm:text-xs overflow-x-auto leading-tight">{`
                       ┌──────────────┐
                       │  scheduled   │ ← created by /draft/admin
                       └──────┬───────┘    settings editable
                              │ start()
                              ▼
              ┌─────────────────────────────────┐
              │             live                │ ← bidding active
              │  ┌────────────────────────────┐ │
              │  │  per-lot state machine     │ │
              │  │                            │ │
              │  │  nominating ──pick──▶ open │ │
              │  │      │                │    │ │
              │  │   timeout            bid   │ │
              │  │      ▼                │    │ │
              │  │   passed              ▼    │ │
              │  │                  ┌─closing─┘ │
              │  │  (last-10s bid?)─┘     │     │
              │  │              t+15s     │     │
              │  │                  ─sold─┘     │
              │  │                              │
              │  │  Invariants:                 │
              │  │  · bid > current_bid + min   │
              │  │  · bidder has budget         │
              │  │  · bidder has position slot  │
              │  │  All checked inside          │
              │  │  SELECT FOR UPDATE           │
              │  └────────────────────────────┘ │
              │  Commissioner can:              │
              │   · pause/resume                │
              │   · void lot (audit-logged)    │
              │   · manual award (audit-logged)│
              │   · reset (typed-confirmation) │
              └────────┬────────────────────────┘
                       │ every manager has filled
                       │ rosterSize slots
                       ▼
                ┌──────────────┐
                │   complete   │ ← rosters frozen until trading
                └──────────────┘    window opens (Tuesdays)
`}</pre>
      </Section>

      <Section title="3. Scoring sweep dependency graph">
        <p className="text-xs text-muted-foreground mb-3">
          Scoring runs every time the inputs change. Because the function
          is pure + idempotent, every trigger point is a safe
          fire-and-rerun. No retry logic, no &quot;already scored&quot;
          guards needed.
        </p>
        <pre className="rounded-lg border border-border bg-card p-4 text-[10px] sm:text-xs overflow-x-auto leading-tight">{`
   inputs (read-only at sweep time):
   ┌─────────────────┐  ┌──────────────────────┐  ┌──────────────┐
   │ manager_lineups │  │ player_match_stats   │  │ fixtures     │
   │  · starters[]   │  │  · minutes           │  │  · stage     │
   │  · bench[]      │  │  · goals             │  │              │
   │  · captain      │  │  · cleanSheet        │  │              │
   │  · vice         │  │  · motmVoteWinner    │  │              │
   └────────┬────────┘  └──────────┬───────────┘  └──────┬───────┘
            │                      │                      │
            └──────────────┬───────┴──────────────────────┘
                           ▼
                ┌──────────────────────────┐
                │  scoreMatchday(snapshot) │  pure function · 30 tests
                │                          │
                │  · position-relative pts │
                │  · captain ×2            │
                │  · vice ×1.5 on cap-DNP  │
                │  · bench auto-sub        │
                │  · stage multiplier      │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  matchday_scores upsert  │
                │  · points (numeric 6,1)  │
                │  · breakdown jsonb       │
                │  · captainPlayed flag    │
                └────────────┬─────────────┘
                             │ supabase_realtime
                             ▼
                ┌──────────────────────────┐
                │  All clients: refresh    │
                │  Leaderboard ticks up    │
                └──────────────────────────┘

   trigger paths (auto-rescore hooks):
   · upsertPlayerStats     → rescore the fixture's matchday
   · setFixtureScore       → rescore (recompute clean sheets first)
   · finalizeFixtureStats  → rescore
   · unfinalizeFixtureStats → rescore (clears MOTM bonus)
   · importMatchStatsFromApi → rescore
   · resolveMotm           → rescore (applies +3 MOTM bonus)
   · saveLineup            → rescore that MD (lineup change → diff pts)
`}</pre>
      </Section>

      <Section title="4. Schema migration timeline">
        <p className="text-xs text-muted-foreground mb-3">
          22 numbered SQL files in <code>lib/db/sql/</code>. Hand-written
          (not generated) where the SQL is sharper than what an ORM would
          produce — partial indexes, triggers, REPLICA IDENTITY, realtime
          publication management. Drizzle schema files mirror them for
          type-safe queries from the app.
        </p>
        <div className="space-y-1.5 font-mono text-xs">
          {MIGRATIONS.map((m) => (
            <div
              key={m.n}
              className="grid grid-cols-[3rem_1fr] gap-3 rounded border border-border bg-card px-3 py-1.5"
            >
              <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">
                {m.n}
              </span>
              <span className="text-muted-foreground">{m.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="5. Data-source trade-offs">
        <p className="text-xs text-muted-foreground mb-3">
          For each external dependency: what was considered, what was
          chosen, why, and the fallback if it disappears.
        </p>
        <div className="space-y-3">
          <TradeoffCard
            title="football-data.org REST"
            chose="Free tier, 10 req/min, fixture + match data"
            rejected="API-Football (more endpoints but paid), thesportsdb (gappy WC coverage)"
            risk="429s under load; mitigated with rate-limit aware client + 429 retry with backoff"
            fallback="football-data Pro tier ($10/month) if free hits ceiling; same client"
          />
          <TradeoffCard
            title="Transfermarkt market value (via dcaribou/transfermarkt-datasets Cloudflare R2)"
            chose="Pre-scraped CSV, no auth, 47k players global"
            rejected="Transfermarkt scraping directly (TOS issues + rate limits), commercial APIs (~$2k/year)"
            risk="Dataset goes stale or repo dies; market values are point-in-time"
            fallback="One-off CSV from another source; the pg_trgm matcher is dataset-agnostic"
          />
          <TradeoffCard
            title="Gemini 2.5 Flash Lite (LLM Layer-3 rating augmentation)"
            chose="Free tier covers 316 candidates × prompt with 100% headroom; cached"
            rejected="GPT-3.5/4o (paid), local Llama 3 (latency + no improvement over Gemini for this task)"
            risk="Gemini deprecates the model; the cache (gemini_research table) means we never have to re-run"
            fallback="Static cache; rating engine works without L3 just fine (blend weight goes to 0 for that layer)"
          />
          <TradeoffCard
            title="Supabase (Postgres + Realtime + Auth)"
            chose="Three vendors in one for a solo build; pooler + direct connections supported"
            rejected="Firebase (no Postgres), RDS + ElastiCache + Cognito (vendor count too high)"
            risk="Supabase pricing changes; vendor lock-in on Realtime"
            fallback="Postgres is portable. Realtime is replaceable with Pusher / Ably / self-hosted nchan"
          />
        </div>
      </Section>

      <Section title="6. What I'd do differently at scale">
        <p className="text-xs text-muted-foreground leading-relaxed">
          The system is built for 4 friends. The patterns generalize but
          some choices wouldn&apos;t. If this had to serve, say, 50,000
          fantasy leagues:
        </p>
        <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1.5 mt-2">
          <li>
            <strong>Move scoring + sim to a worker pool</strong> (Inngest /
            Trigger.dev). Right now matchday sweep runs synchronously on
            mutation. At scale that becomes the bottleneck — would batch
            into a background job per matchday.
          </li>
          <li>
            <strong>Multi-tenant schema</strong>. Current schema is
            hardcoded to 1 league. Adding a <code>league_id</code> partition
            key + row-level security policies is mechanical but
            indispensable.
          </li>
          <li>
            <strong>Move LLM Layer-3 off the request path</strong> and into
            a scheduled augmentation job. Right now it&apos;s precomputed
            via script (which is fine) but at scale you&apos;d want a
            dedicated worker.
          </li>
          <li>
            <strong>OLAP separation</strong>. Analytics queries (rating
            distributions, leaderboard rollups) currently hit the OLTP
            Postgres. At scale: CDC into a warehouse (BigQuery /
            Snowflake), serve analytics from there.
          </li>
          <li>
            <strong>Realtime: from postgres_changes to a streaming
            broker</strong>. Postgres logical replication is fine for our
            traffic shape. At 50k leagues with concurrent matchdays,
            move to Kafka/Redpanda → fan-out to channels.
          </li>
        </ul>
      </Section>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-center">
        <p className="text-muted-foreground">
          Want to see the numbers behind the claims?
        </p>
        <Link
          href="/metrics"
          className="inline-block mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 px-3 py-1.5 transition text-sm"
        >
          Live metrics page →
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const MIGRATIONS = [
  { n: "001", label: "auth.users → profiles trigger" },
  { n: "002", label: "pg_trgm + similarity extensions" },
  { n: "003", label: "Transfermarkt staging table" },
  { n: "004", label: "rating tables + indexes" },
  { n: "005", label: "club_stats + gemini_research cache" },
  { n: "006", label: "backfill Gemini cache" },
  { n: "007", label: "country Elo + sim columns" },
  { n: "008", label: "auction state machine (6 tables + invariants)" },
  { n: "009", label: "enable realtime publication" },
  { n: "010", label: "rosters REPLICA IDENTITY FULL" },
  { n: "011", label: "auction_lot_passes + timer tuning" },
  { n: "012", label: "wc_pedigree (caps + intl goals)" },
  { n: "013", label: "personal_ratings (manager-specific weights)" },
  { n: "014", label: "ingestion_kind enum extension" },
  { n: "015", label: "fbref full stat columns" },
  { n: "016", label: "predictions side-game" },
  { n: "017", label: "phase 5 scoring (lineups, MOTM, scores)" },
  { n: "018", label: "profile.timezone" },
  { n: "019", label: "relax lineup cardinality CHECKs" },
  { n: "020", label: "draft defaults: 500cr / 16-player / 2-5-5-4" },
  { n: "021", label: "free_agent_bids + resolutions" },
  { n: "022", label: "trades (player swap + credit balance)" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div>{children}</div>
    </section>
  );
}

function TradeoffCard({
  title,
  chose,
  rejected,
  risk,
  fallback,
}: {
  title: string;
  chose: string;
  rejected: string;
  risk: string;
  fallback: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-1.5 text-xs">
      <h3 className="text-sm font-semibold mb-1">{title}</h3>
      <div className="grid sm:grid-cols-[5rem_1fr] gap-x-3 gap-y-1 leading-relaxed">
        <span className="text-emerald-600 dark:text-emerald-400 uppercase tracking-wider text-[10px]">
          Chose
        </span>
        <span className="text-muted-foreground">{chose}</span>
        <span className="text-muted-foreground uppercase tracking-wider text-[10px]">
          Rejected
        </span>
        <span className="text-muted-foreground">{rejected}</span>
        <span className="text-amber-600 dark:text-amber-400 uppercase tracking-wider text-[10px]">
          Risk
        </span>
        <span className="text-muted-foreground">{risk}</span>
        <span className="text-sky-600 dark:text-sky-400 uppercase tracking-wider text-[10px]">
          Fallback
        </span>
        <span className="text-muted-foreground">{fallback}</span>
      </div>
    </div>
  );
}
