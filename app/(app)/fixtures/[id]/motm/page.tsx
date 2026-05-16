import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  fixtureLineups,
  fixtures,
  leagueMembers,
  leagues,
  motmVotes,
  playerMatchStats,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import MotmPanel, { type Candidate, type Voter } from "./MotmPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "MOTM vote · FiFantasy" };

const VOTE_WINDOW_HOURS = 24;

export default async function MotmPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: fixtureId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fixture meta
  const home = alias(countries, "home");
  const away = alias(countries, "away");
  const [fx] = await db
    .select({
      id: fixtures.id,
      stage: fixtures.stage,
      matchday: fixtures.matchday,
      homeName: home.name,
      awayName: away.name,
      statsFinalizedAt: fixtures.statsFinalizedAt,
      motmResolvedAt: fixtures.motmResolvedAt,
    })
    .from(fixtures)
    .innerJoin(home, eq(fixtures.homeCountryId, home.id))
    .innerJoin(away, eq(fixtures.awayCountryId, away.id))
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) notFound();

  // Permissions: commissioner can force-close voting
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const isCommissioner = me?.role === "commissioner";

  // Candidates — anyone who played > 0 min
  const candidateRows = await db
    .select({
      realPlayerId: playerMatchStats.realPlayerId,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      photoUrl: realPlayers.photoUrl,
      countryFlag: countries.flagUrl,
      side: fixtureLineups.side,
      minutes: playerMatchStats.minutes,
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      isMotmWinner: playerMatchStats.motmVoteWinner,
    })
    .from(playerMatchStats)
    .innerJoin(realPlayers, eq(realPlayers.id, playerMatchStats.realPlayerId))
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .innerJoin(
      fixtureLineups,
      and(
        eq(fixtureLineups.fixtureId, playerMatchStats.fixtureId),
        eq(fixtureLineups.realPlayerId, playerMatchStats.realPlayerId)
      )
    )
    .where(
      and(
        eq(playerMatchStats.fixtureId, fixtureId),
        gt(playerMatchStats.minutes, 0)
      )
    )
    .orderBy(asc(fixtureLineups.side), asc(realPlayers.displayName));

  const candidates: Candidate[] = candidateRows.map((r) => ({
    realPlayerId: r.realPlayerId,
    displayName: r.displayName,
    side: r.side as "home" | "away",
    position: r.position,
    photoUrl: r.photoUrl,
    countryFlag: r.countryFlag,
    minutes: r.minutes,
    goals: r.goals,
    assists: r.assists,
    isMotmWinner: r.isMotmWinner,
  }));

  // Voters — league members + their current vote (if any)
  const [league] = await db.select().from(leagues).limit(1);
  const voterRows = league
    ? await db
        .select({
          profileId: leagueMembers.profileId,
          displayName: profiles.displayName,
          teamEmoji: profiles.teamEmoji,
          candidateRealPlayerId: motmVotes.candidateRealPlayerId,
        })
        .from(leagueMembers)
        .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
        .leftJoin(
          motmVotes,
          and(
            eq(motmVotes.voterProfileId, leagueMembers.profileId),
            eq(motmVotes.fixtureId, fixtureId)
          )
        )
        .where(eq(leagueMembers.leagueId, league.id))
        .orderBy(asc(leagueMembers.nominationOrder))
    : [];
  const voters: Voter[] = voterRows.map((v) => ({
    profileId: v.profileId,
    displayName: v.displayName,
    teamEmoji: v.teamEmoji,
    candidateRealPlayerId: v.candidateRealPlayerId,
  }));

  const myVote = voters.find((v) => v.profileId === user.id);
  const myVoteRealPlayerId = myVote?.candidateRealPlayerId ?? null;

  const windowCloseAt = fx.statsFinalizedAt
    ? new Date(
        fx.statsFinalizedAt.getTime() + VOTE_WINDOW_HOURS * 60 * 60 * 1000
      ).toISOString()
    : null;

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Link href="/fixtures" className="hover:text-foreground transition">
            ← Fixtures
          </Link>
          <span>·</span>
          <Link
            href={`/fixtures/${fixtureId}/stats`}
            className="hover:text-foreground transition"
          >
            Stats
          </Link>
          <span>·</span>
          <span>MD {fx.matchday} · {fx.stage}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          MOTM · {fx.homeName} vs {fx.awayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Peer vote for Man-of-the-Match. Self-vote allowed. Winner gets a
          +3 scoring bonus. Ties split the bonus (every tied player wins).
        </p>
      </div>

      <MotmPanel
        fixtureId={fixtureId}
        homeName={fx.homeName}
        awayName={fx.awayName}
        candidates={candidates}
        voters={voters}
        myProfileId={user.id}
        myVoteRealPlayerId={myVoteRealPlayerId}
        isResolved={!!fx.motmResolvedAt}
        resolvedAt={fx.motmResolvedAt?.toISOString() ?? null}
        isFinalized={!!fx.statsFinalizedAt}
        finalizedAt={fx.statsFinalizedAt?.toISOString() ?? null}
        windowCloseAt={windowCloseAt}
        canForceResolve={isCommissioner}
      />
    </div>
  );
}
