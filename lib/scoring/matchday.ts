/**
 * Phase 5 — matchday-level scoring orchestration.
 *
 * Pure function. Takes a snapshot of (manager lineups + player stats per
 * fixture + stage per fixture) and returns one row per manager + a detailed
 * breakdown. Idempotent: same inputs → same outputs. The DB write is just
 * an upsert of these rows into matchday_scores; rerun any time stats or
 * votes change.
 *
 * Bench substitution rules:
 *   - For each starter who played 0 minutes (DNP), find the first bench
 *     player at the same position (by benchOrder ascending) who played > 0
 *     minutes. They take the starter's slot, including captaincy if
 *     applicable.
 *   - Bench is consumed in order: each bench player can replace at most one
 *     starter.
 *
 * Captaincy:
 *   - If the captain played 60+ min → captain ×2 applies.
 *   - If the captain played 1–59 min → captain ×2 still applies (some points
 *     beats no points).
 *   - If the captain played 0 min → vice gets ×1.5 IF vice played > 0 min.
 *     If both didn't play, no captaincy bonus.
 *   - If captain is auto-subbed off the field via DNP rule, the bench
 *     replacement does NOT get the captain multiplier — vice does (if vice
 *     played).
 */

import {
  pointsForPlayer,
  roundOneDp,
  type CaptaincyRole,
  type PlayerMatchStats,
  type PlayerScore,
  type Position,
  type Stage,
} from "./points";

/** One player on the team-sheet — what the manager submitted. */
export type LineupSlot = {
  realPlayerId: string;
  position: Position;
};

export type ManagerLineupInput = {
  profileId: string;
  formation: string;
  /** Exactly 11. Order doesn't matter for scoring. */
  starters: LineupSlot[];
  /** Exactly 4. Earlier entries are preferred when auto-subbing. */
  bench: LineupSlot[];
  captainId: string;
  viceId: string;
};

/**
 * Stats for one player across the matchday window. WC group + knockout each
 * play at most 1 fixture per team per MD, but the shape supports multiple
 * fixtures for safety (sums points across them).
 */
export type PlayerFixtureStats = {
  fixtureId: string;
  stage: Stage;
  stats: PlayerMatchStats;
};

export type PlayerScoringInput = {
  realPlayerId: string;
  position: Position;
  /** Zero or more fixtures in this matchday window. */
  fixtures: PlayerFixtureStats[];
};

export type SlotResult = {
  /** Slot identity from the original lineup. */
  slotPosition: Position;
  /** Player who actually scored in this slot (may be a bench sub). */
  realPlayerId: string;
  /** True if this player was originally on the bench. */
  fromBench: boolean;
  /** Captain / vice_promoted / none — applied to this player's points. */
  role: CaptaincyRole;
  /** Per-fixture scores (usually length 1). */
  fixtureScores: Array<{ fixtureId: string; stage: Stage; score: PlayerScore }>;
  /** Sum of fixtureScores[].score.total — already rounded per-fixture. */
  total: number;
};

export type MatchdayManagerResult = {
  profileId: string;
  captainPlayed: boolean;
  /** 15 entries: 11 starter slots + 4 bench slots (in bench order). */
  slots: SlotResult[];
  /** Sum of the 11 active slot totals (excludes bench). */
  total: number;
};

export type MatchdayInput = {
  matchday: number;
  lineups: ManagerLineupInput[];
  /** Keyed by realPlayerId. Players not in this map are treated as DNP. */
  playerStats: Map<string, PlayerScoringInput>;
};

export type MatchdayResult = {
  matchday: number;
  managers: MatchdayManagerResult[];
};

export function scoreMatchday(input: MatchdayInput): MatchdayResult {
  const managers = input.lineups.map((lineup) =>
    scoreManager(lineup, input.playerStats)
  );
  return { matchday: input.matchday, managers };
}

function scoreManager(
  lineup: ManagerLineupInput,
  playerStats: Map<string, PlayerScoringInput>
): MatchdayManagerResult {
  // 1. Figure out which starters played at all this matchday.
  const playedMinutes = (playerId: string): number => {
    const p = playerStats.get(playerId);
    if (!p) return 0;
    return p.fixtures.reduce((sum, f) => sum + f.stats.minutes, 0);
  };

  const captainPlayed = playedMinutes(lineup.captainId) > 0;
  const vicePlayed = playedMinutes(lineup.viceId) > 0;

  // 2. Walk through bench in order, mark which we'll consume to replace DNPs.
  const benchUsed = new Set<string>();
  const benchSubFor = new Map<string, string>(); // starterId → benchId

  for (const starter of lineup.starters) {
    if (playedMinutes(starter.realPlayerId) > 0) continue;
    // Find first eligible bench at same position who played
    const sub = lineup.bench.find(
      (b) =>
        b.position === starter.position &&
        !benchUsed.has(b.realPlayerId) &&
        playedMinutes(b.realPlayerId) > 0
    );
    if (sub) {
      benchUsed.add(sub.realPlayerId);
      benchSubFor.set(starter.realPlayerId, sub.realPlayerId);
    }
  }

  // 3. Decide captaincy role for each effective player.
  //    Captain bonus follows the (original) captain. If the captain DNP'd,
  //    vice gets the bonus (only if vice played).
  const captainGetsBonus = captainPlayed;
  const vicePromoted = !captainPlayed && vicePlayed;

  const roleFor = (effectivePlayerId: string): CaptaincyRole => {
    if (captainGetsBonus && effectivePlayerId === lineup.captainId) {
      return "captain";
    }
    if (vicePromoted && effectivePlayerId === lineup.viceId) {
      return "vice_promoted";
    }
    return "none";
  };

  // 4. Score each starter slot (with possible bench sub).
  const slots: SlotResult[] = [];
  let activeTotal = 0;

  for (const starter of lineup.starters) {
    const benchSubId = benchSubFor.get(starter.realPlayerId);
    const effectivePlayerId = benchSubId ?? starter.realPlayerId;
    const fromBench = benchSubId !== undefined;
    const role = roleFor(effectivePlayerId);

    const score = scorePlayerFixtures(effectivePlayerId, role, playerStats);
    slots.push({
      slotPosition: starter.position,
      realPlayerId: effectivePlayerId,
      fromBench,
      role,
      fixtureScores: score.fixtureScores,
      total: score.total,
    });
    activeTotal += score.total;
  }

  // 5. Also score the unused bench (informational — never adds to total).
  for (const b of lineup.bench) {
    if (benchUsed.has(b.realPlayerId)) continue;
    const score = scorePlayerFixtures(b.realPlayerId, "none", playerStats);
    slots.push({
      slotPosition: b.position,
      realPlayerId: b.realPlayerId,
      fromBench: true,
      role: "none",
      fixtureScores: score.fixtureScores,
      total: score.total,
    });
  }

  return {
    profileId: lineup.profileId,
    captainPlayed,
    slots,
    total: roundOneDp(activeTotal),
  };
}

function scorePlayerFixtures(
  realPlayerId: string,
  role: CaptaincyRole,
  playerStats: Map<string, PlayerScoringInput>
): { fixtureScores: SlotResult["fixtureScores"]; total: number } {
  const player = playerStats.get(realPlayerId);
  if (!player || player.fixtures.length === 0) {
    return { fixtureScores: [], total: 0 };
  }
  const fixtureScores = player.fixtures.map((f) => ({
    fixtureId: f.fixtureId,
    stage: f.stage,
    score: pointsForPlayer({
      position: player.position,
      stage: f.stage,
      stats: f.stats,
      role,
    }),
  }));
  const total = roundOneDp(
    fixtureScores.reduce((sum, fs) => sum + fs.score.total, 0)
  );
  return { fixtureScores, total };
}
