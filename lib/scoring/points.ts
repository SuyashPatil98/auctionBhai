/**
 * Phase 5 — per-player points engine.
 *
 * Pure function. No DB, no IO, no side effects. Inputs go in, points come out.
 * Idempotent and replayable, which is what makes the matchday scorer safe to
 * re-run.
 *
 * Rule sheet (locked 2026-05-16):
 *
 *   Appearance
 *     1–59 min                 +1 (all)
 *     60+ min                  +2 (all)
 *
 *   Attacking                  GK   DEF   MID   FWD
 *     Goal                    +10    +6    +5    +4
 *     Assist                   +3    +3    +3    +3
 *
 *   Defensive (need 60+ min)
 *     Clean sheet              +4    +4    +1     0
 *     Per 2 goals conceded     −1    −1     0     0
 *
 *   Negative (all positions)
 *     Yellow                   −1
 *     Red                      −3
 *     Own goal                 −2
 *     Penalty missed           −2
 *
 *   GK-specific
 *     Penalty saved            +5
 *
 *   Bonus
 *     MOTM (peer vote winner)  +3
 *     Captain                  base × 2
 *     Vice (auto-promoted)     base × 1.5     when captain plays 0 min
 *
 *   Stage multiplier (applied to final per-match total INCLUDING captain/vice)
 *     group ×1.0 · r16 ×1.4 · qf ×1.6 · sf ×1.8 · final ×2.0
 *     r32 ×1.2 (kept for symmetry — 48-team format starts at r32)
 *     third ×1.4 (third-place playoff — knockout but pre-final)
 *
 * Note on data: "per 3 saves" was dropped in design. The pen_saves field on
 * player_match_stats covers GK heroics without burdening stewards with save
 * counts that are hard to get accurately.
 */

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type Stage =
  | "group"
  | "r32"
  | "r16"
  | "qf"
  | "sf"
  | "third"
  | "final";

/** Captaincy state for this player on this match. */
export type CaptaincyRole = "captain" | "vice_promoted" | "none";

/**
 * What the stewards entered (or the API derived) for one player on one match.
 * Mirrors the columns on player_match_stats.
 */
export type PlayerMatchStats = {
  minutes: number;
  goals: number;
  assists: number;
  cleanSheet: boolean; // true iff played 60+ min AND zero conceded by their side
  goalsConceded: number;
  pensMissed: number;
  yellows: number;
  reds: number;
  ownGoals: number;
  penSaves: number;
  motmVoteWinner: boolean;
};

export type ScoreLine = {
  /** Short tag for breakdown display. */
  label: string;
  /** Signed integer (or decimal — but base events are integers). */
  points: number;
};

export type PlayerScore = {
  /** Sum of all base event points before captain/vice/stage multipliers. */
  base: number;
  /** 2 (captain), 1.5 (vice promoted), or 1. */
  captainMultiplier: number;
  /** Stage multiplier, e.g. 1.0 / 1.4 / 1.6 / 1.8 / 2.0. */
  stageMultiplier: number;
  /** base × captainMultiplier × stageMultiplier, rounded to one decimal. */
  total: number;
  /** Per-rule breakdown for UI rendering. Negative + zero rows omitted. */
  breakdown: ScoreLine[];
};

export const STAGE_MULTIPLIERS: Record<Stage, number> = {
  group: 1.0,
  r32: 1.2,
  r16: 1.4,
  qf: 1.6,
  third: 1.4,
  sf: 1.8,
  final: 2.0,
};

const GOAL_POINTS: Record<Position, number> = {
  GK: 10,
  DEF: 6,
  MID: 5,
  FWD: 4,
};

const CLEAN_SHEET_POINTS: Record<Position, number> = {
  GK: 4,
  DEF: 4,
  MID: 1,
  FWD: 0,
};

/** Positions that lose −1 per 2 goals conceded (must have played 60+ min). */
const CONCESSION_PENALTY_POSITIONS: Position[] = ["GK", "DEF"];

const PEN_SAVE_POINTS = 5;
const ASSIST_POINTS = 3;
const MOTM_BONUS = 3;
const YELLOW_PENALTY = -1;
const RED_PENALTY = -3;
const OWN_GOAL_PENALTY = -2;
const PEN_MISS_PENALTY = -2;

const CAPTAIN_MULTIPLIER = 2.0;
const VICE_PROMOTED_MULTIPLIER = 1.5;

/**
 * Compute one player's score for one fixture.
 *
 * A player who was on the team-sheet but played 0 minutes scores 0 (no
 * appearance point). The bench-substitution logic lives in matchday.ts —
 * this function trusts what it's given.
 */
export function pointsForPlayer(args: {
  position: Position;
  stage: Stage;
  stats: PlayerMatchStats;
  role: CaptaincyRole;
}): PlayerScore {
  const { position, stage, stats, role } = args;
  const lines: ScoreLine[] = [];

  // Appearance
  if (stats.minutes <= 0) {
    return {
      base: 0,
      captainMultiplier: captainMultiplierFor(role),
      stageMultiplier: STAGE_MULTIPLIERS[stage],
      total: 0,
      breakdown: [],
    };
  }
  if (stats.minutes >= 60) {
    lines.push({ label: "Played 60+ min", points: 2 });
  } else {
    lines.push({ label: "Played <60 min", points: 1 });
  }

  // Attacking
  if (stats.goals > 0) {
    const per = GOAL_POINTS[position];
    lines.push({
      label: `${stats.goals} goal${stats.goals === 1 ? "" : "s"}`,
      points: per * stats.goals,
    });
  }
  if (stats.assists > 0) {
    lines.push({
      label: `${stats.assists} assist${stats.assists === 1 ? "" : "s"}`,
      points: ASSIST_POINTS * stats.assists,
    });
  }

  // Defensive — only when played 60+ min
  if (stats.minutes >= 60) {
    if (stats.cleanSheet) {
      const csPts = CLEAN_SHEET_POINTS[position];
      if (csPts !== 0) {
        lines.push({ label: "Clean sheet", points: csPts });
      }
    }
    if (
      CONCESSION_PENALTY_POSITIONS.includes(position) &&
      stats.goalsConceded >= 2
    ) {
      const penalty = -Math.floor(stats.goalsConceded / 2);
      lines.push({
        label: `Conceded ${stats.goalsConceded}`,
        points: penalty,
      });
    }
  }

  // GK-specific
  if (position === "GK" && stats.penSaves > 0) {
    lines.push({
      label: `${stats.penSaves} pen save${stats.penSaves === 1 ? "" : "s"}`,
      points: PEN_SAVE_POINTS * stats.penSaves,
    });
  }

  // Negative events
  if (stats.yellows > 0) {
    lines.push({
      label: stats.yellows === 1 ? "Yellow card" : `${stats.yellows} yellows`,
      points: YELLOW_PENALTY * stats.yellows,
    });
  }
  if (stats.reds > 0) {
    lines.push({ label: "Red card", points: RED_PENALTY * stats.reds });
  }
  if (stats.ownGoals > 0) {
    lines.push({
      label: stats.ownGoals === 1 ? "Own goal" : `${stats.ownGoals} own goals`,
      points: OWN_GOAL_PENALTY * stats.ownGoals,
    });
  }
  if (stats.pensMissed > 0) {
    lines.push({
      label:
        stats.pensMissed === 1
          ? "Pen missed"
          : `${stats.pensMissed} pens missed`,
      points: PEN_MISS_PENALTY * stats.pensMissed,
    });
  }

  // MOTM bonus
  if (stats.motmVoteWinner) {
    lines.push({ label: "MOTM", points: MOTM_BONUS });
  }

  const base = lines.reduce((sum, l) => sum + l.points, 0);
  const captainMultiplier = captainMultiplierFor(role);
  const stageMultiplier = STAGE_MULTIPLIERS[stage];
  const total = roundOneDp(base * captainMultiplier * stageMultiplier);

  return { base, captainMultiplier, stageMultiplier, total, breakdown: lines };
}

function captainMultiplierFor(role: CaptaincyRole): number {
  switch (role) {
    case "captain":
      return CAPTAIN_MULTIPLIER;
    case "vice_promoted":
      return VICE_PROMOTED_MULTIPLIER;
    default:
      return 1.0;
  }
}

/** Round to one decimal place. Half-up. */
export function roundOneDp(n: number): number {
  return Math.round(n * 10) / 10;
}
