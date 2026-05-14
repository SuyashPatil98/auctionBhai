import { db } from "@/lib/db";
import {
  countries,
  fixtures,
  ingestionRuns,
  realPlayers,
  tournaments,
} from "@/lib/db/schema";
import { count, desc } from "drizzle-orm";
import {
  runAllIngests,
  runCountriesAndSquadsIngest,
  runFixturesIngest,
  runTournamentIngest,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ingest · Admin · FiFantasy",
};

export default async function IngestAdminPage() {
  const [
    [tournamentCount],
    [countryCount],
    [playerCount],
    [fixtureCount],
    recentRuns,
  ] = await Promise.all([
    db.select({ n: count() }).from(tournaments),
    db.select({ n: count() }).from(countries),
    db.select({ n: count() }).from(realPlayers),
    db.select({ n: count() }).from(fixtures),
    db
      .select()
      .from(ingestionRuns)
      .orderBy(desc(ingestionRuns.startedAt))
      .limit(10),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Ingest</h1>
        <p className="text-sm text-muted-foreground">
          Pull from football-data.org into Postgres. Safe to re-run — every step
          is an upsert.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Tournaments" value={tournamentCount.n} />
        <Stat label="Countries" value={countryCount.n} />
        <Stat label="Players" value={playerCount.n} />
        <Stat label="Fixtures" value={fixtureCount.n} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Run
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <IngestButton
            action={runTournamentIngest}
            label="Tournament"
            hint="WC 2026 metadata"
          />
          <IngestButton
            action={runCountriesAndSquadsIngest}
            label="Countries + Squads"
            hint="48 nations + rosters"
          />
          <IngestButton
            action={runFixturesIngest}
            label="Fixtures"
            hint="104 matches"
          />
          <IngestButton
            action={runAllIngests}
            label="Run all"
            hint="In order"
            primary
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
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
                    <td className="px-3 py-2 whitespace-nowrap">
                      {r.startedAt.toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.source}</td>
                    <td className="px-3 py-2">{r.kind}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.rowsChanged ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {r.error ? (
                        <span className="text-destructive" title={r.error}>
                          error
                        </span>
                      ) : r.finishedAt ? (
                        <span className="text-emerald-600">ok</span>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function IngestButton({
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
