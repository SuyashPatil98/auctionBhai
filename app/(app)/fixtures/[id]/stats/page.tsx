import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { alias } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  fixtureLineups,
  fixtureStewards,
  fixtures,
  playerMatchStats,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import StatsEditor, {
  type EligiblePlayer,
  type PlayerStatRow,
} from "./StatsEditor";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fixture stats · FiFantasy" };

export default async function FixtureStatsPage({
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

  // Permission: commissioner OR assigned steward.
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const isCommissioner = me?.role === "commissioner";

  const [stewardRow] = await db
    .select({ id: fixtureStewards.fixtureId })
    .from(fixtureStewards)
    .where(
      and(
        eq(fixtureStewards.fixtureId, fixtureId),
        eq(fixtureStewards.stewardProfileId, user.id)
      )
    )
    .limit(1);
  const isSteward = !!stewardRow;

  const canEdit = isCommissioner || isSteward;

  // Load fixture w/ country names + flags
  const home = alias(countries, "home");
  const away = alias(countries, "away");
  const [fx] = await db
    .select({
      id: fixtures.id,
      stage: fixtures.stage,
      matchday: fixtures.matchday,
      kickoffAt: fixtures.kickoffAt,
      status: fixtures.status,
      homeScore: fixtures.homeScore,
      awayScore: fixtures.awayScore,
      statsFinalizedAt: fixtures.statsFinalizedAt,
      homeCountryId: fixtures.homeCountryId,
      awayCountryId: fixtures.awayCountryId,
      homeName: home.name,
      homeFlag: home.flagUrl,
      awayName: away.name,
      awayFlag: away.flagUrl,
    })
    .from(fixtures)
    .innerJoin(home, eq(fixtures.homeCountryId, home.id))
    .innerJoin(away, eq(fixtures.awayCountryId, away.id))
    .where(eq(fixtures.id, fixtureId))
    .limit(1);
  if (!fx) notFound();

  // Existing stats + lineup rows for this fixture
  const statRows = await db
    .select({
      realPlayerId: playerMatchStats.realPlayerId,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      photoUrl: realPlayers.photoUrl,
      side: fixtureLineups.side,
      isStarter: fixtureLineups.isStarter,
      minutes: playerMatchStats.minutes,
      goals: playerMatchStats.goals,
      assists: playerMatchStats.assists,
      yellows: playerMatchStats.yellows,
      reds: playerMatchStats.reds,
      ownGoals: playerMatchStats.ownGoals,
      pensMissed: playerMatchStats.pensMissed,
      penSaves: playerMatchStats.penSaves,
      cleanSheet: playerMatchStats.cleanSheet,
    })
    .from(playerMatchStats)
    .innerJoin(realPlayers, eq(realPlayers.id, playerMatchStats.realPlayerId))
    .leftJoin(
      fixtureLineups,
      and(
        eq(fixtureLineups.fixtureId, playerMatchStats.fixtureId),
        eq(fixtureLineups.realPlayerId, playerMatchStats.realPlayerId)
      )
    )
    .where(eq(playerMatchStats.fixtureId, fixtureId));

  const initialStats: PlayerStatRow[] = statRows.map((r) => ({
    realPlayerId: r.realPlayerId,
    displayName: r.displayName,
    position: r.position,
    photoUrl: r.photoUrl,
    side: (r.side ?? "home") as "home" | "away",
    isStarter: r.isStarter ?? true,
    minutes: r.minutes,
    goals: r.goals,
    assists: r.assists,
    yellows: r.yellows,
    reds: r.reds,
    ownGoals: r.ownGoals,
    pensMissed: r.pensMissed,
    penSaves: r.penSaves,
    cleanSheet: r.cleanSheet,
  }));

  // Eligible players per side — countries of the fixture
  const homePlayers = await db
    .select({
      realPlayerId: realPlayers.id,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      photoUrl: realPlayers.photoUrl,
    })
    .from(realPlayers)
    .where(
      and(
        eq(realPlayers.countryId, fx.homeCountryId),
        eq(realPlayers.isActive, true)
      )
    )
    .orderBy(realPlayers.position, realPlayers.displayName);
  const awayPlayers = await db
    .select({
      realPlayerId: realPlayers.id,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      photoUrl: realPlayers.photoUrl,
    })
    .from(realPlayers)
    .where(
      and(
        eq(realPlayers.countryId, fx.awayCountryId),
        eq(realPlayers.isActive, true)
      )
    )
    .orderBy(realPlayers.position, realPlayers.displayName);

  const eligibleHome: EligiblePlayer[] = homePlayers as EligiblePlayer[];
  const eligibleAway: EligiblePlayer[] = awayPlayers as EligiblePlayer[];

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Link href="/fixtures" className="hover:text-foreground transition">
            ← Fixtures
          </Link>
          <span>·</span>
          <span>MD {fx.matchday} · {fx.stage}</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {fx.homeName} vs {fx.awayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Steward stat-entry form. Each player row writes to{" "}
          <code className="text-xs">player_match_stats</code> on save.
          Finalizing locks edits and opens MOTM voting.
        </p>
      </div>

      <StatsEditor
        fixtureId={fixtureId}
        homeName={fx.homeName}
        awayName={fx.awayName}
        homeFlag={fx.homeFlag}
        awayFlag={fx.awayFlag}
        initialHomeScore={fx.homeScore}
        initialAwayScore={fx.awayScore}
        finalizedAt={
          fx.statsFinalizedAt ? fx.statsFinalizedAt.toISOString() : null
        }
        canUnfinalize={isCommissioner}
        canEdit={canEdit}
        initialStats={initialStats}
        eligibleHome={eligibleHome}
        eligibleAway={eligibleAway}
      />
    </div>
  );
}
