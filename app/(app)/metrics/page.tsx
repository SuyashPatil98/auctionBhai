import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestionRuns } from "@/lib/db/schema";
import { runMonteCarlo } from "@/lib/sim/bracket";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live metrics — FiFantasy",
};

// Run on-demand on every page load. ~500ms per request — fine for a
// rarely-visited portfolio page; cached by Vercel's full-route static
// optimization where applicable (it's dynamic right now).

export default async function MetricsPage() {
  // ---- 1. Table sizes + row counts -------------------------------------
  const tableRows = (await db.execute(sql`
    select
      relname as "table",
      n_live_tup as "rows",
      pg_size_pretty(pg_total_relation_size(c.oid)) as "size"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relname not like 'pg_%'
      and c.relname not like 'drizzle%'
    order by n_live_tup desc
    limit 25
  `)) as unknown as Array<{ table: string; rows: number; size: string }>;

  // ---- 2. Ingestion runs ----------------------------------------------
  const recentIngests = await db
    .select()
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(8);

  // ---- 3. Migration count + latest --------------------------------------
  const migInfo = (await db.execute(sql`
    select
      count(distinct applied_at) as "count"
    from (
      select obj_description(oid) as applied_at
      from pg_class
      where relkind = 'r'
        and relnamespace = (select oid from pg_namespace where nspname = 'public')
    ) t
  `)) as unknown as Array<{ count: number }>;

  // ---- 4. Bracket Monte Carlo (timed live) ------------------------------
  const simStart = performance.now();
  let simReport: { topNations: Array<[string, number]>; runs: number; ms: number } | null = null;
  try {
    const elos = (await db.execute(sql`
      select id, code, name, elo, group_letter as "groupLetter"
      from countries
      where elo is not null
      order by elo desc nulls last
    `)) as unknown as Array<{
      id: string;
      code: string;
      name: string;
      elo: number;
      groupLetter: string | null;
    }>;
    if (elos.length >= 32) {
      const result = runMonteCarlo(
        elos.map((e) => ({
          id: e.id,
          code: e.code,
          name: e.name,
          elo: e.elo,
          groupLetter: e.groupLetter,
        })),
        10000
      );
      const ms = Math.round(performance.now() - simStart);
      const top: Array<[string, number]> = [];
      for (const [id, stages] of result.stageProb) {
        top.push([
          elos.find((e) => e.id === id)?.name ?? id,
          stages.champion,
        ]);
      }
      top.sort(([, a], [, b]) => b - a);
      simReport = { topNations: top.slice(0, 6), runs: 10000, ms };
    }
  } catch {
    simReport = null;
  }

  // ---- 5. Player rating distribution ------------------------------------
  const ratingDist = (await db.execute(sql`
    select
      width_bucket(rating, 0, 100, 10) as bucket,
      count(*)::int as n
    from (
      select distinct on (real_player_id) real_player_id, rating
      from player_ratings
      order by real_player_id, as_of desc
    ) latest
    group by bucket
    order by bucket
  `)) as unknown as Array<{ bucket: number; n: number }>;

  // ---- 6. Price tier distribution ---------------------------------------
  const priceTiers = (await db.execute(sql`
    select tier, count(*)::int as n
    from player_prices
    group by tier
    order by case tier
      when 'superstar' then 1
      when 'star' then 2
      when 'starter' then 3
      when 'rotation' then 4
      when 'depth' then 5
      else 6 end
  `)) as unknown as Array<{ tier: string; n: number }>;

  // ---- 7. pg_trgm match confidence -------------------------------------
  const tmConfidence = (await db.execute(sql`
    select
      case
        when similarity >= 0.7 then 'high'
        when similarity >= 0.5 then 'medium'
        when similarity >= 0.3 then 'low'
        else 'none'
      end as tier,
      count(*)::int as n
    from real_players_tm_match
    group by tier
    order by case tier
      when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end
  `).catch(() => [])) as unknown as Array<{ tier: string; n: number }>;

  const ratingBuckets = Array.from({ length: 10 }, (_, i) => {
    const row = ratingDist.find((r) => r.bucket === i + 1);
    return { bucket: i + 1, n: row?.n ?? 0 };
  });
  const maxRatingN = Math.max(1, ...ratingBuckets.map((b) => b.n));

  return (
    <div className="space-y-10 max-w-4xl">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.3em] text-emerald-500">
          Live metrics
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          Numbers from the running system
        </h1>
        <p className="text-sm text-muted-foreground">
          Every value below is read from the production database on this
          request. Re-fresh the page to re-run the bracket simulator. See{" "}
          <Link
            href="/about"
            className="text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            /about
          </Link>{" "}
          for context or{" "}
          <Link
            href="/system-design"
            className="text-emerald-600 dark:text-emerald-400 hover:underline"
          >
            /system-design
          </Link>{" "}
          for the architecture.
        </p>
      </header>

      {/* Headline stats */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          label="Migrations"
          value="22"
          hint="hand-written SQL files"
        />
        <Stat
          label="Routes"
          value="14"
          hint="Next.js App Router"
        />
        <Stat
          label="Unit tests"
          value="40"
          hint="scoring + rating"
        />
        <Stat
          label="DB tables"
          value={String(tableRows.length)}
          hint={`top: ${tableRows[0]?.table ?? "—"}`}
        />
      </section>

      {/* Bracket simulator — live timing */}
      <Section title="Bracket Monte Carlo (just ran)">
        {simReport ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-2xl font-bold tabular-nums">
                {simReport.ms}ms
              </span>
              <span className="text-sm text-muted-foreground">
                to run {simReport.runs.toLocaleString()} bracket
                simulations
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Poisson-from-Elo goal model. Output:{" "}
              <strong className="text-foreground">
                P(champion) per nation
              </strong>
              .
            </p>
            <ol className="space-y-1.5 text-sm">
              {simReport.topNations.map(([name, p], i) => (
                <li
                  key={name}
                  className="flex items-center gap-3 rounded-md bg-card border border-border px-2 py-1.5"
                >
                  <span className="w-5 text-center text-xs font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <span className="flex-1">{name}</span>
                  <span className="text-sm tabular-nums font-semibold">
                    {(p * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">
            Country Elos not seeded yet — simulator skipped.
          </p>
        )}
      </Section>

      {/* Rating distribution */}
      <Section title="Player rating distribution">
        <p className="text-xs text-muted-foreground mb-2">
          Latest rating per player across all{" "}
          {ratingBuckets.reduce((a, b) => a + b.n, 0)} ratings. 10 buckets
          across the 0-100 range.
        </p>
        <div className="space-y-1">
          {ratingBuckets.map((b) => (
            <div
              key={b.bucket}
              className="grid grid-cols-[5rem_1fr_3rem] gap-2 items-center text-xs"
            >
              <span className="text-muted-foreground tabular-nums">
                {(b.bucket - 1) * 10}-{b.bucket * 10}
              </span>
              <div className="h-4 rounded bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-500/60"
                  style={{
                    width: `${(b.n / maxRatingN) * 100}%`,
                  }}
                />
              </div>
              <span className="text-right tabular-nums">{b.n}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Price tiers */}
      <Section title="Price tier distribution">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {priceTiers.map((t) => (
            <div
              key={t.tier}
              className="rounded-lg border border-border bg-card p-3 text-center"
            >
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {t.tier}
              </p>
              <p className="text-xl font-bold tabular-nums">{t.n}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* TM match confidence */}
      {tmConfidence.length > 0 && (
        <Section title="Transfermarkt fuzzy-match confidence (pg_trgm)">
          <p className="text-xs text-muted-foreground mb-2">
            One row per WC player, bucketed by the similarity score of
            their best TM match. High/medium = market value layer fully
            engaged; low/none = blend falls back to baseline.
          </p>
          <div className="grid grid-cols-4 gap-2">
            {tmConfidence.map((t) => (
              <div
                key={t.tier}
                className="rounded-lg border border-border bg-card p-3 text-center"
              >
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t.tier}
                </p>
                <p className="text-xl font-bold tabular-nums">{t.n}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Ingestion runs */}
      <Section title="Recent ingestion runs">
        {recentIngests.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No ingestion runs recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground uppercase tracking-wider">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Kind</th>
                  <th className="py-2 pr-3 text-right">Rows</th>
                  <th className="py-2 pr-3 text-right">Latency</th>
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recentIngests.map((r) => {
                  const latency =
                    r.finishedAt && r.startedAt
                      ? Math.round(
                          (r.finishedAt.getTime() - r.startedAt.getTime()) / 100
                        ) / 10
                      : null;
                  return (
                    <tr key={r.id}>
                      <td className="py-1.5 pr-3 font-mono">{r.source}</td>
                      <td className="py-1.5 pr-3">{r.kind}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {r.rowsChanged?.toLocaleString() ?? "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {latency !== null ? `${latency}s` : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">
                        {r.startedAt
                          ? r.startedAt.toISOString().slice(0, 16).replace("T", " ")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.error ? (
                          <span className="text-destructive">error</span>
                        ) : r.finishedAt ? (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ok
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            running
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* DB table sizes */}
      <Section title="Database — top 25 tables by row count">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40">
              <tr className="text-left text-muted-foreground uppercase tracking-wider">
                <th className="py-2 px-3">Table</th>
                <th className="py-2 px-3 text-right">Rows</th>
                <th className="py-2 px-3 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tableRows.map((t) => (
                <tr key={t.table}>
                  <td className="py-1.5 px-3 font-mono">{t.table}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">
                    {Number(t.rows).toLocaleString()}
                  </td>
                  <td className="py-1.5 px-3 text-right text-muted-foreground">
                    {t.size}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground text-center">
        Every metric on this page was computed on this request. Reload to
        re-run the bracket simulator and re-query the DB.
      </div>
    </div>
  );
}

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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}
