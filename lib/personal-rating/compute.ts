/**
 * Pure formula for a manager's personal rating of a player.
 *
 * Weighted geometric mean of soft-floored percentiles:
 *
 *   1. Each factor's percentile p (in [0, 1] within position bucket) is
 *      mapped through a soft floor: p' = ε + (1 - ε)·p with ε = 0.20.
 *      Keeps any single factor from collapsing the score to zero while
 *      still penalising weakness in important factors.
 *
 *   2. Weighted geometric mean:
 *        rating = exp( Σ wᵢ · ln(p'ᵢ) / Σ wᵢ )
 *      where wᵢ = 2 for important factors, 1 for standard.
 *
 *   3. Scale to 0-100 and round.
 *
 *   4. Factors without data (has_data=false) are silently dropped. The
 *      returned `coverage` field surfaces this for the UI.
 *
 * No DB access here — caller supplies the percentile rows. Keep this file
 * free of side effects so the unit tests can hammer it without a database.
 *
 * Worked example baked into the tests: Declan Rice (CM) with the canonical
 * CM profile produces 73.
 */

import type { FactorId } from "./factors";

export const EPSILON = 0.20;
export const WEIGHT_IMPORTANT = 2;
export const WEIGHT_STANDARD = 1;

export type Importance = "important" | "standard";

export type FactorWeight = {
  factor_id: FactorId;
  importance: Importance;
};

/**
 * Per-player percentile, as stored in player_factor_percentiles.
 * `percentile` is in [0, 1]; `has_data: false` means we have no real value
 * for this player and should drop the factor from the rating.
 */
export type FactorPercentile = {
  factor_id: FactorId;
  percentile: number;
  has_data: boolean;
};

export type ComputeResult = {
  /** 0-100, rounded. */
  score: number;
  /** How many factors actually had data. */
  coverage: number;
  /** Total factors the manager selected. */
  total: number;
  /** Per-factor breakdown, useful for "why is this score X?" tooltips. */
  breakdown: Array<{
    factor_id: FactorId;
    importance: Importance;
    percentile: number | null;
    contribution: number; // 0-100 contribution to final score
  }>;
};

function weightFor(importance: Importance): number {
  return importance === "important" ? WEIGHT_IMPORTANT : WEIGHT_STANDARD;
}

/**
 * Compute the personal rating.
 *
 * @param weights      Factors the manager picked + their importance.
 * @param percentiles  Player's percentile per factor. Factors not in this
 *                     list are treated as `has_data: false` (skipped).
 */
export function computePersonalRating(
  weights: FactorWeight[],
  percentiles: FactorPercentile[]
): ComputeResult {
  const pctByFactor = new Map<FactorId, FactorPercentile>(
    percentiles.map((p) => [p.factor_id, p])
  );

  const breakdown: ComputeResult["breakdown"] = [];
  let weightedLogSum = 0;
  let totalWeight = 0;
  let coverage = 0;

  for (const w of weights) {
    const pct = pctByFactor.get(w.factor_id);
    if (!pct || !pct.has_data) {
      breakdown.push({
        factor_id: w.factor_id,
        importance: w.importance,
        percentile: null,
        contribution: 0,
      });
      continue;
    }
    const weight = weightFor(w.importance);
    const pPrime = EPSILON + (1 - EPSILON) * pct.percentile;
    weightedLogSum += weight * Math.log(pPrime);
    totalWeight += weight;
    coverage++;

    breakdown.push({
      factor_id: w.factor_id,
      importance: w.importance,
      percentile: pct.percentile,
      // "Contribution" surfaces the factor's solo influence on the final
      // score as a percentage point delta from neutral (50). p'=0.5 -> 0.
      // Useful for tooltips: "tackles_per_90 pulled this score up by +6".
      contribution: Math.round(100 * (pPrime - (EPSILON + (1 - EPSILON) * 0.5))),
    });
  }

  if (totalWeight === 0) {
    // Manager picked factors but none have data for this player. Return a
    // neutral 50 rather than 0 — we can't say anything informed.
    return {
      score: 50,
      coverage: 0,
      total: weights.length,
      breakdown,
    };
  }

  const rawRating = Math.exp(weightedLogSum / totalWeight); // 0..1
  const score = Math.round(100 * rawRating);

  return {
    score,
    coverage,
    total: weights.length,
    breakdown,
  };
}
