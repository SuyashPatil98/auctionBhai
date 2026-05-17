import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  drafts,
  fixtures,
  leagues,
  managerLineups,
  playerPrices,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfileTimezone } from "@/lib/util/current-profile";
import {
  DEFAULT_FORMATION,
  isFormationKey,
  type FormationKey,
} from "@/lib/lineup/formations";
import { computeLockTime, isLocked } from "@/lib/lineup/lock";
import { stampLineupLocks } from "../actions";
import LineupBuilder, { type RosterPlayerView } from "./LineupBuilder";
import type { Position } from "@/lib/scoring/points";
import { benchSizeForRoster, type LineupDraft } from "@/lib/lineup/validate";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lineup · FiFantasy" };

export default async function LineupPage({
  params,
}: {
  params: Promise<{ matchday: string }>;
}) {
  const { matchday: mdParam } = await params;
  const matchday = parseInt(mdParam, 10);
  if (!Number.isInteger(matchday) || matchday < 0 || matchday > 99) {
    redirect("/team");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Stamp locks (idempotent, no-op if not yet -6h)
  await stampLineupLocks(matchday).catch(() => {});

  const tz = await getCurrentProfileTimezone();
  const [league] = await db.select().from(leagues).limit(1);

  // Squad size + bench size come from the draft row (configurable)
  const [draft] = league
    ? await db
        .select({ rosterSize: drafts.rosterSize })
        .from(drafts)
        .where(eq(drafts.leagueId, league.id))
        .limit(1)
    : [];
  const benchSize = benchSizeForRoster(draft?.rosterSize ?? 16);

  // Roster (active players the user owns in the current league)
  const rosterRows = league
    ? await db
        .select({
          realPlayerId: rosters.realPlayerId,
          position: realPlayers.position,
          displayName: realPlayers.displayName,
          countryFlag: countries.flagUrl,
          countryName: countries.name,
          price: playerPrices.price,
          tier: playerPrices.tier,
          photoUrl: realPlayers.photoUrl,
        })
        .from(rosters)
        .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
        .innerJoin(countries, eq(countries.id, realPlayers.countryId))
        .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
        .where(
          and(
            eq(rosters.leagueId, league.id),
            eq(rosters.profileId, user.id),
            sql`${rosters.droppedAt} is null`
          )
        )
        .orderBy(asc(realPlayers.position), asc(realPlayers.fullName))
    : [];

  const roster: RosterPlayerView[] = rosterRows.map((r) => ({
    realPlayerId: r.realPlayerId,
    position: r.position as Position,
    displayName: r.displayName,
    countryFlag: r.countryFlag,
    countryName: r.countryName,
    price: r.price ?? null,
    tier: r.tier ?? null,
    photoUrl: r.photoUrl,
  }));

  // Existing lineup for this MD (if any)
  const [existing] = await db
    .select()
    .from(managerLineups)
    .where(
      and(
        eq(managerLineups.profileId, user.id),
        eq(managerLineups.matchday, matchday)
      )
    )
    .limit(1);

  // Prior matchday — for the "copy from last MD" affordance
  const [prior] = await db
    .select({ matchday: managerLineups.matchday })
    .from(managerLineups)
    .where(
      and(
        eq(managerLineups.profileId, user.id),
        sql`${managerLineups.matchday} < ${matchday}`
      )
    )
    .orderBy(sql`${managerLineups.matchday} desc`)
    .limit(1);

  // Fixtures + lock-time
  const mdFixtures = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));
  const lockTime = computeLockTime(mdFixtures);
  const locked = isLocked(lockTime);

  // Initial draft for the client component
  const initialDraft: LineupDraft = {
    formation:
      existing?.formation && isFormationKey(existing.formation)
        ? (existing.formation as FormationKey)
        : DEFAULT_FORMATION,
    starters: existing?.starterIds ?? [],
    bench: existing?.benchIds ?? Array.from({ length: benchSize }, () => ""),
    captainId: existing?.captainId ?? "",
    viceId: existing?.viceId ?? "",
  };

  // Empty state: no league or no roster
  if (!league || roster.length === 0) {
    return (
      <div className="space-y-4 max-w-xl">
        <h1 className="text-2xl font-semibold tracking-tight">
          Matchday {matchday} lineup
        </h1>
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            You don&apos;t have any players on your roster yet. The auction
            hasn&apos;t happened, or you weren&apos;t added to the league.
          </p>
          <Link
            href="/draft"
            className="text-sm text-emerald-600 hover:underline"
          >
            Go to draft →
          </Link>
        </div>
      </div>
    );
  }

  // Matchday selector data
  const matchdayBounds = await db
    .select({
      min: sql<number>`min(${fixtures.matchday})`,
      max: sql<number>`max(${fixtures.matchday})`,
    })
    .from(fixtures);
  const minMd = matchdayBounds[0]?.min ?? 1;
  const maxMd = matchdayBounds[0]?.max ?? 8;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">
            Matchday {matchday}
          </h1>
          <MatchdayNav current={matchday} min={minMd} max={maxMd} />
        </div>
        <p className="text-sm text-muted-foreground">
          Set your starting XI, bench order, captain (×2) and vice (×1.5 if
          captain plays 0&nbsp;min). Lineup locks 6h before the first kickoff
          of this matchday.
        </p>
      </div>

      <LineupBuilder
        matchday={matchday}
        initialDraft={initialDraft}
        roster={roster}
        lockTime={lockTime?.toISOString() ?? null}
        isLocked={locked}
        hasPriorLineup={!!prior}
        tz={tz}
        benchSize={benchSize}
      />
    </div>
  );
}

function MatchdayNav({
  current,
  min,
  max,
}: {
  current: number;
  min: number;
  max: number;
}) {
  const prev = current > min ? current - 1 : null;
  const next = current < max ? current + 1 : null;
  return (
    <nav className="flex items-center gap-2 text-sm">
      {prev !== null ? (
        <Link
          href={`/team/lineup/${prev}`}
          className="rounded-md border border-border bg-card px-2.5 py-1 hover:bg-muted transition"
        >
          ← MD {prev}
        </Link>
      ) : (
        <span className="rounded-md border border-border bg-card/50 px-2.5 py-1 opacity-40">
          ← MD —
        </span>
      )}
      {next !== null ? (
        <Link
          href={`/team/lineup/${next}`}
          className="rounded-md border border-border bg-card px-2.5 py-1 hover:bg-muted transition"
        >
          MD {next} →
        </Link>
      ) : (
        <span className="rounded-md border border-border bg-card/50 px-2.5 py-1 opacity-40">
          MD — →
        </span>
      )}
    </nav>
  );
}
