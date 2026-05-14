/**
 * Layer 2 of the rating engine: Transfermarkt market value.
 *
 * Strongly correlates with global expert consensus on player quality.
 * Used as the primary signal where a match is available.
 *
 * Math:
 *   - log10(market_value_eur) — market values span 6 orders of magnitude
 *   - z-score within sub-position bucket (so wingers aren't compared to
 *     defensive mids; both fall under "MID" coarsely but have very
 *     different market profiles)
 *   - map z to 0..100 with z=0 → 50, ±3σ → ±50
 */

import type { Bucket } from "./buckets";

export type PositionStats = {
  mean: number; // mean of log10(market_value_eur)
  stdDev: number;
  n: number;
};

export type Layer2Inputs = {
  bucket: Bucket;
  marketValueEur: number | null;
};

export type Layer2Result = {
  score: number | null;
  bucket: Bucket;
  marketValueEur: number | null;
  logValue: number | null;
  zScore: number | null;
};

/**
 * Compute per-bucket log-market-value statistics from a list of values.
 * Run once over all WC players who have a TM match; cache the result.
 */
export function computeBucketStats(
  byBucket: Map<Bucket, number[]>
): Map<Bucket, PositionStats> {
  const out = new Map<Bucket, PositionStats>();
  for (const [bucket, raw] of byBucket) {
    const values = raw.filter((v) => v != null && v > 0).map((v) => Math.log10(v));
    const n = values.length;
    if (n === 0) {
      out.set(bucket, { mean: 0, stdDev: 1, n: 0 });
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance =
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
    const stdDev = Math.sqrt(variance) || 1;
    out.set(bucket, { mean, stdDev, n });
  }
  return out;
}

export function computeLayer2(
  inputs: Layer2Inputs,
  stats: Map<Bucket, PositionStats>
): Layer2Result {
  if (!inputs.marketValueEur || inputs.marketValueEur <= 0) {
    return {
      score: null,
      bucket: inputs.bucket,
      marketValueEur: null,
      logValue: null,
      zScore: null,
    };
  }

  const logValue = Math.log10(inputs.marketValueEur);
  const s = stats.get(inputs.bucket);
  if (!s || s.n < 3) {
    // Bucket has too few players to be a reliable distribution.
    // Caller should fall back to a wider pool (coarse position).
    return {
      score: null,
      bucket: inputs.bucket,
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
    bucket: inputs.bucket,
    marketValueEur: inputs.marketValueEur,
    logValue,
    zScore: z,
  };
}
