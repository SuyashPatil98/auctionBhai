import Link from "next/link";
import { db } from "@/lib/db";
import { alias } from "drizzle-orm/pg-core";
import { countries, fixtures } from "@/lib/db/schema";
import { asc, eq } from "drizzle-orm";
import { Kickoff } from "@/components/Kickoff";
import { getCurrentProfileTimezone } from "@/lib/util/current-profile";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Fixtures · FiFantasy",
};

const STAGE_LABEL: Record<string, string> = {
  group: "Group stage",
  r32: "Round of 32",
  r16: "Round of 16",
  qf: "Quarter-finals",
  sf: "Semi-finals",
  third: "Third-place play-off",
  final: "Final",
};

const STATUS_PILL: Record<string, string> = {
  scheduled: "bg-muted text-muted-foreground",
  live: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  ht: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  ft: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  postponed: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
  cancelled: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-400",
};

export default async function FixturesPage() {
  const home = alias(countries, "home");
  const away = alias(countries, "away");
  const tz = await getCurrentProfileTimezone();

  const rows = await db
    .select({
      id: fixtures.id,
      kickoffAt: fixtures.kickoffAt,
      stage: fixtures.stage,
      matchday: fixtures.matchday,
      status: fixtures.status,
      homeScore: fixtures.homeScore,
      awayScore: fixtures.awayScore,
      venue: fixtures.venue,
      homeName: home.name,
      homeCode: home.code,
      homeFlag: home.flagUrl,
      awayName: away.name,
      awayCode: away.code,
      awayFlag: away.flagUrl,
    })
    .from(fixtures)
    .innerJoin(home, eq(fixtures.homeCountryId, home.id))
    .innerJoin(away, eq(fixtures.awayCountryId, away.id))
    .orderBy(asc(fixtures.kickoffAt));

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fixtures</h1>
        </div>
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No fixtures yet. Run an ingest from{" "}
          <Link href="/admin/ingest" className="underline">
            /admin/ingest
          </Link>
          .
        </div>
      </div>
    );
  }

  // Group by matchday for the header section, but keep stage label too.
  const byMatchday = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!byMatchday.has(r.matchday)) byMatchday.set(r.matchday, []);
    byMatchday.get(r.matchday)!.push(r);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fixtures</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} matches across {byMatchday.size} matchdays
        </p>
      </div>

      <div className="space-y-8">
        {[...byMatchday.entries()]
          .sort(([a], [b]) => a - b)
          .map(([matchday, matches]) => {
            const stage = matches[0]?.stage ?? "group";
            const label = STAGE_LABEL[stage] ?? stage;
            return (
              <section key={matchday} className="space-y-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Matchday {matchday} · {label}
                </h2>
                <ul className="space-y-2">
                  {matches.map((m) => (
                    <FixtureRow key={m.id} {...m} tz={tz} />
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </div>
  );
}

function FixtureRow(props: {
  id: string;
  kickoffAt: Date;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  venue: string | null;
  homeName: string;
  homeFlag: string | null;
  awayName: string;
  awayFlag: string | null;
  tz: string | null;
}) {
  const finished = props.status === "ft";
  const live = props.status === "live" || props.status === "ht";
  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-[7.5rem] text-xs text-muted-foreground tabular-nums">
          <Kickoff at={props.kickoffAt.toISOString()} tz={props.tz} />
        </div>
        <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
          <div className="text-right truncate flex items-center justify-end gap-1.5">
            <span className="truncate">{props.homeName}</span>
            {props.homeFlag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.homeFlag}
                alt=""
                className="w-4 h-4 flex-shrink-0"
              />
            )}
          </div>
          <div className="text-center tabular-nums font-medium min-w-[3rem]">
            {finished || live ? (
              <span>
                {props.homeScore ?? 0} – {props.awayScore ?? 0}
              </span>
            ) : (
              <span className="text-muted-foreground">vs</span>
            )}
          </div>
          <div className="text-left truncate flex items-center gap-1.5">
            {props.awayFlag && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={props.awayFlag}
                alt=""
                className="w-4 h-4 flex-shrink-0"
              />
            )}
            <span className="truncate">{props.awayName}</span>
          </div>
        </div>
        <StatusPill status={props.status} />
      </div>
      {props.venue && (
        <p className="mt-1 text-xs text-muted-foreground pl-[7.5rem]">
          {props.venue}
        </p>
      )}
    </li>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status === "ft" ? "FT" : status.toUpperCase();
  return (
    <span
      className={`text-[10px] font-medium uppercase tracking-wider rounded px-1.5 py-0.5 ${
        STATUS_PILL[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {label}
    </span>
  );
}
