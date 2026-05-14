/**
 * Layer 2 of the rating engine: Transfermarkt market value.
 *
 * Strongly correlates with global expert consensus on player quality.
 * Used as the primary signal where a match is available.
 *
 * Math:
 *   - log10(market_value_eur) — market values span 6 orders of magnitude
 *   - z-score within position (so the GK pool isn't penalised against the
 *     FWD pool, where market values are systematically higher)
 *   - map z to 0..100 with z=0 → 50, ±3σ → ±50
 */

import type { DbPosition } from "@/lib/ingest/mappers";

export type PositionStats = {
  mean: number; // mean of log10(market_value_eur)
  stdDev: number;
  n: number;
};

export type Layer2Inputs = {
  position: DbPosition;
  marketValueEur: number | null;
};

export type Layer2Result = {
  score: number | null;
  marketValueEur: number | null;
  logValue: number | null;
  zScore: number | null;
};

/**
 * Compute per-position log-market-value statistics from a list of values.
 * Run once over all WC players who have a TM match; cache the result.
 */
export function computePositionStats(
  byPosition: Record<DbPosition, number[]>
): Record<DbPosition, PositionStats> {
  const out = {} as Record<DbPosition, PositionStats>;
  for (const pos of Object.keys(byPosition) as DbPosition[]) {
    const values = byPosition[pos]
      .filter((v) => v != null && v > 0)
      .map((v) => Math.log10(v));
    const n = values.length;
    if (n === 0) {
      out[pos] = { mean: 0, stdDev: 1, n: 0 };
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
    const stdDev = Math.sqrt(variance) || 1;
    out[pos] = { mean, stdDev, n };
  }
  return out;
}

export function computeLayer2(
  inputs: Layer2Inputs,
  stats: Record<DbPosition, PositionStats>
): Layer2Result {
  if (!inputs.marketValueEur || inputs.marketValueEur <= 0) {
    return {
      score: null,
      marketValueEur: null,
      logValue: null,
      zScore: null,
    };
  }

  const logValue = Math.log10(inputs.marketValueEur);
  const s = stats[inputs.position];
  if (!s || s.n === 0) {
    return {
      score: null,
      marketValueEur: inputs.marketValueEur,
      logValue,
      zScore: null,
    };
  }

  const z = (logValue - s.mean) / s.stdDev;
  // ±3σ → ±50 about mean=50, then clamp.
  const score = Math.max(0, Math.min(100, 50 + z * (50 / 3)));

  return {
    score,
    marketValueEur: inputs.marketValueEur,
    logValue,
    zScore: z,
  };
}
