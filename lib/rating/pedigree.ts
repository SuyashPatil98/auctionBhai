/**
 * Layer 4 of the rating engine: International pedigree.
 *
 * Uses the international_caps and international_goals fields we already
 * pulled in from Transfermarkt. The signal: players who consistently
 * deliver for their country (high goals-per-cap) tend to over-perform
 * their club rating in tournaments.
 *
 * Two sub-signals:
 *   - cap_volume: how experienced internationally vs typical for their age
 *                 (log-normalized). Catches "established starter" vs
 *                 "occasional call-up".
 *   - goal_rate:  goals per cap, z-scored within position.
 *                 Catches "decisive in big moments".
 *
 * Output: small additive adjustment in [-5, +5]. Layer 4 nudges the
 * blended rating, doesn't overwrite it.
 *
 * Worked example (Mac Allister vs Rice, both MID):
 *   - Rice (60 caps, 5 goals, age 27)     → goals/cap 0.08 → MID-z ≈ -0.2 → adj ≈ 0
 *   - Mac Allister (50 caps, 10 goals, 28)→ goals/cap 0.20 → MID-z ≈ +1.3 → adj ≈ +3
 */

import type { DbPosition } from "@/lib/ingest/mappers";

export type Layer4Inputs = {
  position: DbPosition;
  age: number | null;
  internationalCaps: number | null;
  internationalGoals: number | null;
};

export type Layer4Result = {
  adjustment: number; // [-5, +5]
  capVolume: number | null; // 0 = no caps for age; 1 = typical; >1 over
  goalRate: number | null; // goals / caps
  goalRateZ: number | null;
  pedigreeScore: number; // 0-100, for display
};

export type GoalRateStats = Record<
  DbPosition,
  { mean: number; stdDev: number; n: number }
>;

/**
 * Rough "expected caps by now" for a typical international starter at this
 * age. Used to normalize cap_volume so a 22-year-old with 15 caps doesn't
 * get penalized against a 33-year-old with 80.
 */
function expectedCapsForAge(age: number, position: DbPosition): number {
  // FWD/MID start earlier (~19), GK/DEF later (~22). Linear ~3-4 caps/yr.
  const startAge = position === "GK" || position === "DEF" ? 22 : 19;
  const capsPerYear = position === "GK" || position === "DEF" ? 3 : 4;
  return Math.max(0, (age - startAge) * capsPerYear);
}

/**
 * Compute goal-rate stats per position from a set of players who have
 * caps > 0. Call once before computing Layer 4 per-player.
 */
export function computeGoalRateStats(
  rows: Array<{
    position: DbPosition;
    caps: number | null;
    goals: number | null;
  }>
): GoalRateStats {
  const byPos = {
    GK: [] as number[],
    DEF: [] as number[],
    MID: [] as number[],
    FWD: [] as number[],
  };
  for (const r of rows) {
    if (r.caps && r.caps >= 5 && r.goals !== null && r.goals >= 0) {
      // Minimum 5 caps to avoid noise from one-off scorers.
      byPos[r.position].push(r.goals / r.caps);
    }
  }
  const out = {} as GoalRateStats;
  for (const pos of ["GK", "DEF", "MID", "FWD"] as DbPosition[]) {
    const values = byPos[pos];
    const n = values.length;
    if (n === 0) {
      out[pos] = { mean: 0, stdDev: 1, n: 0 };
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
    out[pos] = { mean, stdDev: Math.sqrt(variance) || 0.01, n };
  }
  return out;
}

export function computeLayer4(
  inputs: Layer4Inputs,
  stats: GoalRateStats
): Layer4Result {
  const caps = inputs.internationalCaps ?? 0;
  const goals = inputs.internationalGoals ?? 0;
  const age = inputs.age;

  // Without age or with no caps, we can't say anything — flat adjustment.
  if (age === null || caps <= 0) {
    return {
      adjustment: 0,
      capVolume: null,
      goalRate: null,
      goalRateZ: null,
      pedigreeScore: 50,
    };
  }

  // Cap volume: how many caps vs what's typical for the age.
  const expected = expectedCapsForAge(age, inputs.position);
  const capVolume =
    expected <= 0 ? 0 : Math.log(caps + 1) / Math.log(expected + 1);

  // Goal rate, z-scored within position.
  const goalRate = goals / caps;
  const s = stats[inputs.position];
  const goalRateZ = s.n > 0 ? (goalRate - s.mean) / s.stdDev : 0;

  // Combine into a pedigree score (0-100) — for display in breakdown.
  // 50 = average international productivity for this position.
  const pedigreeScore = Math.max(
    0,
    Math.min(
      100,
      50 + 10 * (capVolume - 1) + 15 * goalRateZ
    )
  );

  // Additive adjustment, clamped [-5, +5].
  const adjustment = Math.max(-5, Math.min(5, pedigreeScore - 50));

  return {
    adjustment,
    capVolume,
    goalRate,
    goalRateZ,
    pedigreeScore,
  };
}
