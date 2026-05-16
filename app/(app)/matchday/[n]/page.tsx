import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  leagueMembers,
  leagues,
  matchdayScores,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfileTimezone } from "@/lib/util/current-profile";
import { computeLockTime } from "@/lib/lineup/lock";
import MatchdayLeaderboard, {
  type LeaderboardManager,
  type SlotBreakdown,
} from "./MatchdayLeaderboard";

export const dynamic = "force-dynamic";

export const metadata = { title: "Matchday · FiFantasy" };

type SlotSerialized = {
  realPlayerId: string;
  slotPosition: "GK" | "DEF" | "MID" | "FWD";
  fromBench: boolean;
  role: "captain" | "vice_promoted" | "none";
  total: number;
  fixtureScores: Array<{
    fixtureId: string;
    stage: string;
    base: number;
    captainMultiplier: number;
    stageMultiplier: number;
    total: number;
    breakdown: Array<{ label: string; points: number }>;
  }>;
};

export default async function MatchdayPage({
  params,
}: {
  params: Promise<{ n: string }>;
}) {
  const { n: mdParam } = await params;
  const matchday = parseInt(mdParam, 10);
  if (!Number.isInteger(matchday) || matchday < 0 || matchday > 99) {
    redirect("/dashboard");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const tz = await getCurrentProfileTimezone();

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    return (
      <div className="space-y-3 max-w-xl">
        <h1 className="text-2xl font-semibold">Matchday {matchday}</h1>
        <p className="text-sm text-muted-foreground">No league configured.</p>
      </div>
    );
  }

  // Members in nomination order — for the leaderboard rows
  const members = await db
    .select({
      profileId: leagueMembers.profileId,
      displayName: profiles.displayName,
      teamName: profiles.teamName,
      teamEmoji: profiles.teamEmoji,
    })
    .from(leagueMembers)
    .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
    .where(eq(leagueMembers.leagueId, league.id))
    .orderBy(asc(leagueMembers.nominationOrder));

  // Scores for this matchday (if any computed)
  const scoreRows = await db
    .select()
    .from(matchdayScores)
    .where(eq(matchdayScores.matchday, matchday));
  const scoreByProfile = new Map(scoreRows.map((s) => [s.profileId, s]));

  // Real-player display info for the breakdown — gather all referenced ids
  const referencedIds = new Set<string>();
  for (const row of scoreRows) {
    const b = row.breakdown as { slots?: SlotSerialized[] };
    for (const s of b.slots ?? []) {
      referencedIds.add(s.realPlayerId);
    }
  }
  const playerRows =
    referencedIds.size > 0
      ? await db
          .select({
            id: realPlayers.id,
            displayName: realPlayers.displayName,
            position: realPlayers.position,
            photoUrl: realPlayers.photoUrl,
          })
          .from(realPlayers)
          .where(sql`${realPlayers.id} = ANY(${[...referencedIds]})`)
      : [];
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  // Fixtures for the matchday — for lock time + countdown
  const mdFixtures = await db
    .select({
      kickoffAt: fixtures.kickoffAt,
      status: fixtures.status,
      statsFinalizedAt: fixtures.statsFinalizedAt,
    })
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));
  const lockTime = computeLockTime(mdFixtures);
  const finalizedCount = mdFixtures.filter((f) => f.statsFinalizedAt).length;

  // Build leaderboard rows + sort by points desc
  const leaderboard: LeaderboardManager[] = members.map((m) => {
    const score = scoreByProfile.get(m.profileId);
    const slots: SlotBreakdown[] = score
      ? ((score.breakdown as { slots?: SlotSerialized[] }).slots ?? []).map(
          (s) => {
            const p = playerById.get(s.realPlayerId);
            return {
              realPlayerId: s.realPlayerId,
              displayName: p?.displayName ?? "—",
              position: (p?.position ?? s.slotPosition) as
                | "GK"
                | "DEF"
                | "MID"
                | "FWD",
              photoUrl: p?.photoUrl ?? null,
              slotPosition: s.slotPosition,
              fromBench: s.fromBench,
              role: s.role,
              total: s.total,
              fixtureBreakdowns: s.fixtureScores,
            };
          }
        )
      : [];
    return {
      profileId: m.profileId,
      displayName: m.displayName,
      teamName: m.teamName,
      teamEmoji: m.teamEmoji,
      total: score ? Number(score.points) : 0,
      captainPlayed: score?.captainPlayed ?? null,
      computedAt: score?.computedAt?.toISOString() ?? null,
      slots,
    };
  });

  leaderboard.sort((a, b) => b.total - a.total);

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Link href="/dashboard" className="hover:text-foreground transition">
            ← Dashboard
          </Link>
          <span>·</span>
          <span>
            Matchday {matchday} · {finalizedCount}/{mdFixtures.length}{" "}
            fixture{mdFixtures.length === 1 ? "" : "s"} finalized
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Matchday {matchday} standings
        </h1>
        <p className="text-sm text-muted-foreground">
          Updates in real time as steward stats land + MOTM resolves.
          Captain ×2, Vice ×1.5 if captain plays 0&apos;.
        </p>
      </div>

      <MatchdayLeaderboard
        matchday={matchday}
        leaderboard={leaderboard}
        myProfileId={user.id}
        lockTime={lockTime?.toISOString() ?? null}
        tz={tz}
      />
    </div>
  );
}
