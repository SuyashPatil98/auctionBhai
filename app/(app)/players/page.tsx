import Link from "next/link";
import { db } from "@/lib/db";
import { countries, realPlayers } from "@/lib/db/schema";
import { and, asc, eq, ilike, or } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Players · FiFantasy",
};

type SearchParams = Promise<{
  q?: string;
  position?: string;
  country?: string;
}>;

const POSITIONS = ["GK", "DEF", "MID", "FWD"] as const;
type Position = (typeof POSITIONS)[number];

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, position, country } = await searchParams;
  const posFilter = POSITIONS.includes(position as Position)
    ? (position as Position)
    : null;

  const filters = [];
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    filters.push(
      or(ilike(realPlayers.fullName, like), ilike(realPlayers.displayName, like))
    );
  }
  if (posFilter) filters.push(eq(realPlayers.position, posFilter));
  if (country) filters.push(eq(countries.code, country.toUpperCase()));

  const rows = await db
    .select({
      id: realPlayers.id,
      fullName: realPlayers.fullName,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      shirtNumber: realPlayers.shirtNumber,
      countryCode: countries.code,
      countryName: countries.name,
      flagUrl: countries.flagUrl,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(realPlayers.countryId, countries.id))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(countries.name), asc(realPlayers.displayName))
    .limit(500);

  const countryList = await db
    .select({ code: countries.code, name: countries.name })
    .from(countries)
    .orderBy(asc(countries.name));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Players</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "player" : "players"}
            {rows.length >= 500 ? " (showing first 500)" : ""}
          </p>
        </div>
      </div>

      <form className="flex flex-wrap items-end gap-2 text-sm">
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Search</span>
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Name…"
            className="rounded-md border border-input bg-background px-3 py-1.5 w-56"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Position</span>
          <select
            name="position"
            defaultValue={posFilter ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5"
          >
            <option value="">All</option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Country</span>
          <select
            name="country"
            defaultValue={country ?? ""}
            className="rounded-md border border-input bg-background px-3 py-1.5"
          >
            <option value="">All</option>
            {countryList.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 transition"
        >
          Apply
        </button>
        <Link
          href="/players"
          className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          Reset
        </Link>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No players match. If the table is empty, run an ingest from{" "}
          <Link href="/admin/ingest" className="underline">
            /admin/ingest
          </Link>
          .
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-left px-3 py-2">Country</th>
                <th className="text-left px-3 py-2">Pos</th>
                <th className="text-right px-3 py-2">#</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-3 py-2 font-medium">{p.displayName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {p.flagUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.flagUrl}
                        alt=""
                        className="inline-block w-4 h-4 mr-1 align-text-bottom"
                      />
                    )}
                    {p.countryName}
                  </td>
                  <td className="px-3 py-2">
                    <PositionBadge position={p.position} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {p.shirtNumber ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PositionBadge({ position }: { position: string }) {
  const color: Record<string, string> = {
    GK: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    DEF: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
    MID: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    FWD: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
        color[position] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {position}
    </span>
  );
}
