import Link from "next/link";
import { db } from "@/lib/db";
import {
  countries,
  fixtures,
  ingestionRuns,
  personalRatings,
  playerFactorPercentiles,
  playerPrices,
  playerRatings,
  ratingProfiles,
  realPlayers,
  tournaments,
  transfermarktPlayers,
  wcPedigree,
  playerClubStats,
} from "@/lib/db/schema";
import { count, desc, max } from "drizzle-orm";
import {
  refreshBracket,
  refreshDerivedAll,
  refreshPercentiles,
  refreshPrices,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = { title: "Admin · FiFantasy" };

export default async function AdminPage() {
  const [
    [tournamentCount],
    [countryCount],
    [playerCount],
    [fixtureCount],
    [tmCount],
    [fbrefCount],
    [wcCount],
    [ratingCount],
    [priceCount],
    [pctCount],
    [profileCount],
    [pRatingCount],
    [lastRatingAt],
    [lastPriceAt],
    [lastPctAt],
    [lastBracketAt],
    recentRuns,
  ] = await Promise.all([
    db.select({ n: count() }).from(tournaments),
    db.select({ n: count() }).from(countries),
    db.select({ n: count() }).from(realPlayers),
    db.select({ n: count() }).from(fixtures),
    db.select({ n: count() }).from(transfermarktPlayers),
    db.select({ n: count() }).from(playerClubStats),
    db.select({ n: count() }).from(wcPedigree),
    db.select({ n: count() }).from(playerRatings),
    db.select({ n: count() }).from(playerPrices),
    db.select({ n: count() }).from(playerFactorPercentiles),
    db.select({ n: count() }).from(ratingProfiles),
    db.select({ n: count() }).from(personalRatings),
    db.select({ t: max(playerRatings.asOf) }).from(playerRatings),
    db.select({ t: max(playerPrices.computedAt) }).from(playerPrices),
    db.select({ t: max(playerFactorPercentiles.updatedAt) }).from(playerFactorPercentiles),
    db.select({ t: max(countries.expectedMatchesUpdatedAt) }).from(countries),
    db
      .select()
      .from(ingestionRuns)
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(15),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted-foreground">
          Status of every data source and one-click recompute for fast ops.
          Heavy ops (full ingest, TM import, AI refresh) run via CLI — see
          the bottom of the page.
        </p>
      </div>

      {/* ===================== Reference data status ===================== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Reference data
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          <Stat label="Tournaments" value={tournamentCount.n} />
          <Stat label="Countries" value={countryCount.n} />
          <Stat label="Players" value={playerCount.n} />
          <Stat label="Fixtures" value={fixtureCount.n} />
          <Stat label="Transfermarkt rows" value={tmCount.n} />
          <Stat label="FBref club stats" value={fbrefCount.n} />
          <Stat label="WC pedigree" value={wcCount.n} />
        </div>
      </section>

      {/* ===================== Derived data ============================== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Derived data
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <Stat label="Ratings (rows)" value={ratingCount.n} sub={fmtAgo(lastRatingAt.t)} />
          <Stat label="Prices" value={priceCount.n} sub={fmtAgo(lastPriceAt.t)} />
          <Stat label="Factor percentiles" value={pctCount.n} sub={fmtAgo(lastPctAt.t)} />
          <Stat label="Country E[matches]" value={countryCount.n} sub={fmtAgo(lastBracketAt.t)} />
        </div>
      </section>

      {/* ===================== Personal scouting ========================= */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Personal scouting
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
          <Stat label="Manager profiles" value={profileCount.n} />
          <Stat label="Personal ratings" value={pRatingCount.n} />
        </div>
      </section>

      {/* ===================== Recompute buttons ========================= */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Recompute
        </h2>
        <p className="text-xs text-muted-foreground">
          Run these after any reference-data ingest. Each is fast (≤10s) so
          they fit inside Vercel&apos;s serverless timeout. The combined run
          handles dependency order automatically.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionButton
            action={refreshBracket}
            label="Bracket sim"
            hint="10k Monte Carlo · ~1s"
          />
          <ActionButton
            action={refreshPrices}
            label="Prices"
            hint="Reads ratings + sim · ~3s"
          />
          <ActionButton
            action={refreshPercentiles}
            label="Percentiles"
            hint="Phase 4 factor pipeline · ~5s"
          />
          <ActionButton
            action={refreshDerivedAll}
            label="Refresh all derived"
            hint="bracket → prices → percentiles"
            primary
          />
        </div>
      </section>

      {/* ===================== Ingest links ============================== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Ingest
        </h2>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm">
            <Link
              href="/admin/ingest"
              className="font-medium underline hover:text-primary"
            >
              football-data.org ingest →
            </Link>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pull tournament + countries + squads + fixtures. Use after new
            qualifier results or squad announcements.
          </p>
        </div>
      </section>

      {/* ===================== CLI-only ops ============================== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          CLI-only ops
        </h2>
        <p className="text-xs text-muted-foreground">
          These exceed Vercel&apos;s serverless timeout or need local files.
          Run from your dev machine.
        </p>
        <div className="rounded-lg border border-border bg-card divide-y divide-border">
          <CliRow
            cmd="pnpm import:tm"
            desc="Transfermarkt CSV ingest — ~50MB, ~3–5 min. After this, run compute:ratings."
          />
          <CliRow
            cmd="pnpm import:fbref"
            desc="FBref season stats — requires lib/data/fbref_25_26.csv locally. Then recompute."
          />
          <CliRow
            cmd="pnpm import:wc"
            desc="World Cup pedigree — uses lib/data/wc_pedigree.json. Edit JSON to add players."
          />
          <CliRow
            cmd="pnpm compute:ratings"
            desc="Full 4-layer rating engine. ~30s for cached run; --with-ai is ~25 min ($0.10)."
          />
          <CliRow
            cmd="pnpm seed:elos"
            desc="Reset country Elos to defaults — only after manual edits."
          />
          <CliRow
            cmd="pnpm seed:league"
            desc="Idempotent: ensures league + draft exist + adds new profiles as members."
          />
        </div>
      </section>

      {/* ===================== Recent runs =============================== */}
      <section className="space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Recent runs
        </h2>
        {recentRuns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-left px-3 py-2">Source</th>
                  <th className="text-left px-3 py-2">Kind</th>
                  <th className="text-right px-3 py-2">Rows</th>
                  <th className="text-left px-3 py-2">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                      {r.startedAt.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{r.source}</td>
                    <td className="px-3 py-2 text-muted-foreground">{r.kind}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.rowsChanged ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-destructive" title={r.error}>
                          error
                        </span>
                      ) : r.finishedAt ? (
                        <span className="text-emerald-600">
                          ok ({((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000).toFixed(1)}s)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">running…</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function fmtAgo(t: Date | null): string {
  if (!t) return "never";
  const ms = Date.now() - t.getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: number;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function ActionButton({
  action,
  label,
  hint,
  primary,
}: {
  action: () => Promise<void>;
  label: string;
  hint: string;
  primary?: boolean;
}) {
  return (
    <form action={action} className="contents">
      <button
        type="submit"
        className={
          "rounded-lg border p-4 text-left transition " +
          (primary
            ? "border-primary bg-primary text-primary-foreground hover:opacity-90"
            : "border-border bg-card hover:bg-muted")
        }
      >
        <p className="text-sm font-medium">{label}</p>
        <p
          className={
            "mt-1 text-xs " +
            (primary ? "text-primary-foreground/70" : "text-muted-foreground")
          }
        >
          {hint}
        </p>
      </button>
    </form>
  );
}

function CliRow({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <code className="rounded bg-muted px-2 py-1 text-xs font-mono whitespace-nowrap">
        {cmd}
      </code>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
  );
}
