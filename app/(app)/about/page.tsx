import Link from "next/link";

export const metadata = {
  title: "About — FiFantasy",
};

export default function AboutPage() {
  return (
    <div className="space-y-12 max-w-4xl">
      {/* Hero */}
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">
          Solo end-to-end data system · FIFA WC 2026
        </p>
        <h1 className="text-4xl font-bold tracking-tight">
          A private fantasy football league —{" "}
          <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
            designed, built, deployed and operated by one engineer
          </span>
        </h1>
        <p className="text-base text-muted-foreground leading-relaxed">
          Multi-source ETL → 4-layer ML rating model → 10k Monte Carlo
          bracket simulator → idempotent realtime scoring engine → 14-route
          Next.js app → deployed to live users. Every layer designed and
          shipped by me, alone, in a four-month build window.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <a
            href="https://github.com/SuyashPatil98/auctionBhai"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-card hover:bg-muted px-4 py-2 transition"
          >
            View source on GitHub →
          </a>
          <Link
            href="/system-design"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-4 py-2 transition"
          >
            System design →
          </Link>
          <Link
            href="/metrics"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 px-4 py-2 transition"
          >
            Live metrics →
          </Link>
        </div>
      </header>

      {/* What one engineer built */}
      <Section title="What one engineer built">
        <div className="grid sm:grid-cols-2 gap-3">
          <LayerCard
            title="Data ingestion"
            metric="1,213 + 47,637 + 25k rows"
            body={
              <>
                4 source connectors: football-data.org REST API
                (rate-limit aware, 10/min, 429-retry), Transfermarkt CSV
                via R2, Hubertsidorowicz FBref Kaggle CSV, hand-curated
                WC pedigree JSON. Idempotent ingestion with run-tracked
                audit table.
              </>
            }
          />
          <LayerCard
            title="Entity matching"
            metric="~94% high/medium recall"
            body={
              <>
                Fuzzy match across 47k Transfermarkt rows to 1,213 WC
                players via Postgres <code>pg_trgm</code>. Tiered
                confidence buckets (high / medium / low / none) drive
                downstream blend weights — model degrades gracefully on
                missing matches.
              </>
            }
          />
          <LayerCard
            title="Player rating model"
            metric="4 layers · position-bucketed"
            body={
              <>
                L1 baseline + per-position age curve · L2 log-market-value
                z-scored within sub-position bucket · L3 Gemini LLM
                augmentation (316 candidates, cached, $0.10 total) · L4
                international pedigree z-score. Confidence-weighted blend.
                30 pure-function unit tests.
              </>
            }
          />
          <LayerCard
            title="Bracket simulator"
            metric="10k sims · 500ms"
            body={
              <>
                Monte Carlo using Poisson-from-Elo goal model. Outputs
                P(champion), P(reach knockouts), expected matches per
                nation. Validated within 2pp of bookmaker odds for top-6
                teams. Feeds the price engine.
              </>
            }
          />
          <LayerCard
            title="Scoring engine"
            metric="6 trigger points · idempotent"
            body={
              <>
                Pure function: (lineups × stats × fixtures × votes) →
                scores. Re-runs on every mutation that touches the
                inputs. Same inputs always yield same output — safe to
                replay. Anchored by 30 unit tests including edge cases
                (captain DNP, bench auto-sub, vice promotion, stage
                multipliers).
              </>
            }
          />
          <LayerCard
            title="Realtime backend"
            metric="~150ms p95 cross-continent"
            body={
              <>
                Supabase Postgres logical replication → Realtime Channels
                → browsers. Friends watching the leaderboard during a
                live match see other managers&apos; scores tick up as
                steward stats land. Latency win came from a measured
                region migration (Tokyo → Mumbai).
              </>
            }
          />
          <LayerCard
            title="Auction state machine"
            metric="Transactional · multi-bidder"
            body={
              <>
                Live multi-bidder room with anti-snipe extension, proxy
                max-bid ladder, pause/resume, opt-out passing. Bid
                validation runs inside <code>SELECT FOR UPDATE</code> so
                concurrent bids can&apos;t race. Partial unique index
                enforces single-active-roster-per-player invariant in the
                schema, not the app layer.
              </>
            }
          />
          <LayerCard
            title="Weekly trading window"
            metric="Sell · Bid · Trade"
            body={
              <>
                Tuesday-only window for sell-back (50% refund), free-agent
                sealed-bid auction (24h blind, first-price, earliest-tie-
                break), and direct manager-to-manager trades with credit
                balancing. Position-quota validator after every mutation.
                Locked at knockout stage.
              </>
            }
          />
        </div>
      </Section>

      {/* Architecture mini-diagram */}
      <Section
        title="Architecture (overview)"
        subtitle={
          <>
            Full interactive diagram on the{" "}
            <Link
              href="/system-design"
              className="text-emerald-600 dark:text-emerald-400 hover:underline"
            >
              system design page →
            </Link>
          </>
        }
      >
        <pre className="rounded-lg border border-border bg-card p-4 text-[10px] sm:text-xs overflow-x-auto leading-tight">{`
┌──────────────────────────────────────────────────────────────┐
│  Sources: football-data.org · TM CSV · FBref · WC JSON       │
└─────────────────────────┬────────────────────────────────────┘
                          ▼ rate-limited, idempotent ETL
┌──────────────────────────────────────────────────────────────┐
│  Postgres (Supabase · Mumbai)                                │
│  22 migrations · partial unique indexes · realtime publish   │
└──────────┬─────────────────────────┬─────────────────────────┘
           │                         │
   compute │                         │ realtime
           ▼                         ▼
   ┌────────────┐           ┌─────────────────┐
   │ Rating: 4  │           │ Supabase        │
   │ layer blend│           │ Realtime →      │
   │ Monte Carlo│           │ browser refresh │
   │ Scoring    │           └────────┬────────┘
   └─────┬──────┘                    │
         └──────────────┬────────────┘
                        ▼
              Next.js 16 App Router
              (14 routes · server actions)
                        │
                        ▼
              Vercel · bom1 · live users
`}</pre>
      </Section>

      {/* Design decisions */}
      <Section
        title="Design decisions worth defending in an interview"
        subtitle="Each of these came up during the build. None of them are obvious."
      >
        <Decision
          n={1}
          title="Tokyo → Mumbai DB region migration — measured ~100ms p95 win"
          body={
            <>
              Initial Supabase project was <code>ap-northeast-1</code> (Tokyo).
              Realtime push from steward-bid in India → UK friend&apos;s browser
              was ~250ms (India→Tokyo + Tokyo→UK). UK friend was losing bid
              races. Migrated to <code>ap-south-1</code> (Mumbai) via a
              two-phase script that applies migrations in order then copies
              data in FK dependency order. New cross-continent push: ~150ms.
              Kept the migration script as durable infra.
            </>
          }
          file="scripts/migrate-to-new-db.ts"
        />
        <Decision
          n={2}
          title="Confidence-driven blend weights in the rating model"
          body={
            <>
              Each player gets a rating from up to 4 layers. Blend weights
              shift based on how confident the entity-matching step was.
              High-confidence TM match (~94% of pool): 25% baseline + 75%
              market-value driven. No TM match (the rare 6%): 100% baseline.
              The model degrades gracefully on missing data instead of
              producing garbage when sources are thin.
            </>
          }
          file="lib/rating/blend.ts"
        />
        <Decision
          n={3}
          title="Idempotent realtime scoring engine"
          body={
            <>
              Scoring is a pure function:{" "}
              <code>
                (manager_lineups, player_match_stats, fixtures, motm_votes) →
                matchday_scores
              </code>
              . Re-runs on every mutation that touches the inputs (stat edit,
              MOTM resolve, lineup save, API import, finalize, unfinalize).
              Safe because the function is deterministic — re-runs are
              guaranteed identical. 30 unit tests cover the rules and the
              tricky edge cases (captain DNP, bench substitution, stage
              multipliers).
            </>
          }
          file="lib/scoring/{points,matchday,sweep}.ts"
        />
        <Decision
          n={4}
          title="Partial unique indexes as state machine invariants"
          body={
            <>
              <code>UNIQUE(league_id, real_player_id) WHERE dropped_at IS NULL</code>{" "}
              enforces &quot;a player is on at most one manager&apos;s active
              roster&quot; at the DB level — no application code can violate
              it. Same pattern on trades: a unique partial index dedupes
              pending proposals by (window, proposer, recipient, both
              players). State-machine correctness ends up in the schema, not
              in the app layer where it can drift.
            </>
          }
          file="lib/db/sql/008_auction_schema.sql · 022_trades.sql"
        />
        <Decision
          n={5}
          title="Read-only guest access via one Supabase user"
          body={
            <>
              Considered a parallel deployment (separate Vercel + Supabase
              project) for portfolio viewers; rejected — too much
              maintenance overhead. Single shared{" "}
              <code>guest@auction-bhai.demo</code> user lives outside{" "}
              <code>league_members</code>. The existing{" "}
              <code>requireLeagueMember()</code> gate on every mutation
              server action makes the guest read-only by construction. One
              extra database row instead of a second deployment.
            </>
          }
          file="lib/util/guest.ts · scripts/seed-guest.ts"
        />
      </Section>

      {/* Stack rationale */}
      <Section title="Tech stack (and why each piece)">
        <dl className="grid sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5 text-sm">
          <StackRow
            k="Framework"
            v="Next.js 16 App Router — server components + server actions = less boilerplate for data-heavy pages"
          />
          <StackRow
            k="Language"
            v="TypeScript — strict types across DB schema → API → UI cut whole classes of bugs"
          />
          <StackRow
            k="Database"
            v="Supabase Postgres — Postgres + Realtime + Auth in one cuts vendor count for a solo project"
          />
          <StackRow
            k="ORM"
            v="Drizzle — type-safe queries; drops to raw SQL where the query is gnarlier than the ORM"
          />
          <StackRow
            k="Realtime"
            v="Supabase Realtime via logical replication → channels. Push without managing a websocket layer"
          />
          <StackRow
            k="LLM"
            v="Gemini 2.5 Flash Lite — free tier covers the 316-candidate Layer-3 rating pass (~$0.10 total)"
          />
          <StackRow
            k="Hosting"
            v="Vercel (pinned bom1 region). Region pin matters: BOM1 + Mumbai DB = ~5ms; BOM1 + Tokyo DB was ~120ms"
          />
        </dl>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          <strong>Why TypeScript not Python+Spark?</strong> Realtime UX was
          the primary design constraint — one TS codebase across server
          actions + client components beat the cost of adding a separate
          Python service for the data work. The data patterns (ETL
          idempotency, fuzzy matching, layered model with confidence
          weights, Monte Carlo) translate directly to my professional
          PySpark / Airflow stack at Capgemini.
        </p>
      </Section>

      {/* About the author */}
      <Section title="About me">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Built solo by <strong className="text-foreground">Suyash Patil</strong>.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          3.5+ years professional experience at Capgemini building
          data-intensive backend and AI/ML systems in financial services
          (Python · PySpark on EMR · Airflow MLOps · GPT-4 document
          pipelines · fraud detection). M.Tech Data Science from IIIT
          Bhopal (in progress). National Runner-Up, Smart India Hackathon
          2024.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This project is the side build where I owned every layer
          end-to-end — pipeline, model, simulation, scoring engine,
          realtime backend, UI, deployment, and ops. If you&apos;re hiring
          for a senior generalist who can ship across the data + ML +
          backend stack, click around the app or check the source above.
        </p>
        <div className="flex flex-wrap gap-3 pt-3 text-sm">
          <a
            href="https://github.com/SuyashPatil98"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-card hover:bg-muted px-3 py-1.5 transition"
          >
            GitHub
          </a>
          <a
            href="https://github.com/SuyashPatil98/auctionBhai"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-border bg-card hover:bg-muted px-3 py-1.5 transition"
          >
            This project on GitHub
          </a>
          <Link
            href="/system-design"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 transition"
          >
            System design →
          </Link>
          <Link
            href="/metrics"
            className="rounded-md border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 px-3 py-1.5 transition"
          >
            Live metrics →
          </Link>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
      </div>
      <div>{children}</div>
    </section>
  );
}

function LayerCard({
  title,
  metric,
  body,
}: {
  title: string;
  metric: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400 tabular-nums">
          {metric}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function Decision({
  n,
  title,
  body,
  file,
}: {
  n: number;
  title: string;
  body: React.ReactNode;
  file: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2 mb-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <span className="text-[10px] rounded bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 tabular-nums">
          {n.toString().padStart(2, "0")}
        </span>
        {title}
      </h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
      <p className="text-[10px] text-muted-foreground/70 font-mono">{file}</p>
    </div>
  );
}

function StackRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="contents">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
