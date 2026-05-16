/**
 * Phase 5.7 — scoring sweep orchestrator.
 *
 * Loads the inputs needed to score one matchday, hands them to the pure
 * scoreMatchday() function in lib/scoring/matchday.ts, then upserts the
 * results into matchday_scores. Idempotent — re-running on the same MD
 * produces the same totals + breakdown.
 *
 * NOT a pure function (touches the DB) but the math part is, so all the
 * 30 unit tests in scripts/test-scoring.ts still pin the algorithm.
 */

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  managerLineups,
  matchdayScores,
  playerMatchStats,
  realPlayers,
} from "@/lib/db/schema";
import {
  scoreMatchday,
  type ManagerLineupInput,
  type MatchdayResult,
  type PlayerScoringInput,
  type PlayerFixtureStats,
  type LineupSlot,
} from "./matchday";
import { isFormationKey } from "@/lib/lineup/formations";
import type { Position, Stage } from "./points";

export type SweepReport = {
  matchday: number;
  managersScored: number;
  result: MatchdayResult | null;
  reason?: string;
};

/**
 * Score a single matchday: read inputs from the DB, run the engine, upsert
 * one matchday_scores row per manager. Safe to re-run.
 */
export async function sweepMatchday(matchday: number): Promise<SweepReport> {
  // 1. Lineups for this matchday
  const lineupRows = await db
    .select()
    .from(managerLineups)
    .where(eq(managerLineups.matchday, matchday));

  if (lineupRows.length === 0) {
    return {
      matchday,
      managersScored: 0,
      result: null,
      reason: "no manager_lineups for this matchday",
    };
  }

  // 2. Fixtures for this matchday — stage map
  const fxRows = await db
    .select({
      id: fixtures.id,
      stage: fixtures.stage,
    })
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));
  const stageByFixture = new Map<string, Stage>();
  for (const f of fxRows) {
    stageByFixture.set(f.id, f.stage as Stage);
  }

  // 3. All players referenced in any lineup
  const allPlayerIds = new Set<string>();
  for (const l of lineupRows) {
    for (const id of l.starterIds) allPlayerIds.add(id);
    for (const id of l.benchIds) if (id) allPlayerIds.add(id);
  }
  if (allPlayerIds.size === 0) {
    return {
      matchday,
      managersScored: 0,
      result: null,
      reason: "lineups present but no players in any starter/bench list",
    };
  }

  // 4. Positions for those players
  const positionRows = await db
    .select({ id: realPlayers.id, position: realPlayers.position })
    .from(realPlayers)
    .where(inArray(realPlayers.id, [...allPlayerIds]));
  const positionById = new Map<string, Position>(
    positionRows.map((r) => [r.id, r.position as Position])
  );

  // 5. player_match_stats for those players, but only for THIS matchday's
  //    fixtures (otherwise we'd pull stats from other matchdays too).
  const fixtureIds = fxRows.map((f) => f.id);
  const statRows =
    fixtureIds.length > 0
      ? await db
          .select()
          .from(playerMatchStats)
          .where(
            and(
              inArray(playerMatchStats.fixtureId, fixtureIds),
              inArray(playerMatchStats.realPlayerId, [...allPlayerIds])
            )
          )
      : [];

  // 6. Index stats by player → list of (fixture, stage, stats)
  const playerStatsMap = new Map<string, PlayerScoringInput>();
  for (const id of allPlayerIds) {
    const position = positionById.get(id);
    if (!position) continue; // player not in real_players — skip silently
    playerStatsMap.set(id, {
      realPlayerId: id,
      position,
      fixtures: [],
    });
  }
  for (const s of statRows) {
    const stage = stageByFixture.get(s.fixtureId);
    if (!stage) continue;
    const player = playerStatsMap.get(s.realPlayerId);
    if (!player) continue;
    const entry: PlayerFixtureStats = {
      fixtureId: s.fixtureId,
      stage,
      stats: {
        minutes: s.minutes,
        goals: s.goals,
        assists: s.assists,
        cleanSheet: s.cleanSheet,
        goalsConceded: s.goalsConceded,
        pensMissed: s.pensMissed,
        yellows: s.yellows,
        reds: s.reds,
        ownGoals: s.ownGoals,
        penSaves: s.penSaves,
        motmVoteWinner: s.motmVoteWinner,
      },
    };
    player.fixtures.push(entry);
  }

  // 7. Build the lineup input for each manager
  const managerInputs: ManagerLineupInput[] = lineupRows.map((l) => {
    if (!isFormationKey(l.formation)) {
      // Defensive: skip lineups with unknown formations.
      throw new Error(
        `lineup ${l.id} has unknown formation '${l.formation}'`
      );
    }
    const toSlot = (playerId: string): LineupSlot | null => {
      const pos = positionById.get(playerId);
      if (!pos) return null;
      return { realPlayerId: playerId, position: pos };
    };
    return {
      profileId: l.profileId,
      formation: l.formation,
      starters: l.starterIds
        .map(toSlot)
        .filter((s): s is LineupSlot => s !== null),
      bench: l.benchIds
        .filter((id) => !!id)
        .map(toSlot)
        .filter((s): s is LineupSlot => s !== null),
      captainId: l.captainId,
      viceId: l.viceId,
    };
  });

  // 8. Score!
  const result = scoreMatchday({
    matchday,
    lineups: managerInputs,
    playerStats: playerStatsMap,
  });

  // 9. Upsert matchday_scores rows
  const now = new Date();
  for (const mgr of result.managers) {
    await db
      .insert(matchdayScores)
      .values({
        profileId: mgr.profileId,
        matchday,
        points: String(mgr.total),
        breakdown: serializeBreakdown(mgr),
        captainPlayed: mgr.captainPlayed,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: [matchdayScores.profileId, matchdayScores.matchday],
        set: {
          points: String(mgr.total),
          breakdown: serializeBreakdown(mgr),
          captainPlayed: mgr.captainPlayed,
          computedAt: now,
        },
      });
  }

  return {
    matchday,
    managersScored: result.managers.length,
    result,
  };
}

/**
 * Serialize a manager's slots into a stable jsonb shape that the leaderboard
 * UI can render directly. We strip out the heavy breakdown lines and keep
 * just the totals; the UI can fetch per-player detail on demand if needed.
 */
function serializeBreakdown(
  mgr: MatchdayResult["managers"][number]
): Record<string, unknown> {
  return {
    captainPlayed: mgr.captainPlayed,
    total: mgr.total,
    slots: mgr.slots.map((s) => ({
      realPlayerId: s.realPlayerId,
      slotPosition: s.slotPosition,
      fromBench: s.fromBench,
      role: s.role,
      total: s.total,
      fixtureScores: s.fixtureScores.map((fs) => ({
        fixtureId: fs.fixtureId,
        stage: fs.stage,
        base: fs.score.base,
        captainMultiplier: fs.score.captainMultiplier,
        stageMultiplier: fs.score.stageMultiplier,
        total: fs.score.total,
        breakdown: fs.score.breakdown,
      })),
    })),
  };
}

/**
 * Sweep all matchdays that have at least one finalized fixture. Useful as
 * a single "sync everything" action. Returns one report per matchday.
 */
export async function sweepAllActiveMatchdays(): Promise<SweepReport[]> {
  const mdRows = (await db.execute(sql`
    select distinct matchday
    from fixtures
    where stats_finalized_at is not null
    order by matchday asc
  `)) as unknown as Array<{ matchday: number }>;

  const reports: SweepReport[] = [];
  for (const row of mdRows) {
    reports.push(await sweepMatchday(row.matchday));
  }
  return reports;
}
