/**
 * Combines Layer 1 (deterministic) and Layer 2 (Transfermarkt market value)
 * into a single 0-100 score, then position-normalises across the league so
 * the range is well-distributed within each position bucket.
 */

import type { DbPosition } from "@/lib/ingest/mappers";
import type { Layer1Result } from "./baseline";
import type { Layer2Result } from "./market-value";

export type MatchQuality = "high" | "medium" | "low" | "none";

export type BlendInputs = {
  layer1: Layer1Result;
  layer2: Layer2Result;
  matchQuality: MatchQuality;
};

export type BlendResult = {
  score: number;
  weights: { layer1: number; layer2: number };
};

const WEIGHTS: Record<MatchQuality, { layer1: number; layer2: number }> = {
  // High-quality TM match (name + DOB): trust the market.
  high: { layer1: 0.25, layer2: 0.75 },
  // Trigram name match without DOB confirmation: hedge.
  medium: { layer1: 0.5, layer2: 0.5 },
  // Weak signal — rely on deterministic.
  low: { layer1: 0.8, layer2: 0.2 },
  // No match at all — Layer 1 only.
  none: { layer1: 1.0, layer2: 0.0 },
};

export function blendLayers(input: BlendInputs): BlendResult {
  const weights = WEIGHTS[input.matchQuality];
  if (input.layer2.score === null) {
    // No L2 signal regardless of declared quality.
    return {
      score: input.layer1.score,
      weights: { layer1: 1, layer2: 0 },
    };
  }

  const score =
    weights.layer1 * input.layer1.score +
    weights.layer2 * input.layer2.score;

  return { score, weights };
}

/**
 * After blending every player, optionally re-normalize within position so
 * the league spread looks like a healthy 0-100 distribution. Useful when
 * Layer 2 coverage is partial and we don't want everyone clustered at 50.
 *
 * Maps each player's score to a position-relative z-score, then back to
 * 0..100 with mean→50 and ±2.5σ→±50 (slightly tighter than Layer 2's
 * spread to avoid double-stretching the tails).
 */
export function positionNormalize<
  T extends { position: DbPosition; preNormScore: number }
>(rows: T[]): (T & { score: number })[] {
  const byPos = new Map<DbPosition, number[]>();
  for (const r of rows) {
    if (!byPos.has(r.position)) byPos.set(r.position, []);
    byPos.get(r.position)!.push(r.preNormScore);
  }

  const stats = new Map<DbPosition, { mean: number; std: number }>();
  for (const [pos, scores] of byPos) {
    const n = scores.length;
    const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const variance =
      scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
    const std = Math.sqrt(variance) || 1;
    stats.set(pos, { mean, std });
  }

  return rows.map((r) => {
    const s = stats.get(r.position)!;
    const z = (r.preNormScore - s.mean) / s.std;
    // ±3σ → ±42, leaves headroom at the top so we don't clip the truly
    // elite at the ceiling. Outliers beyond 3σ still clamp to [0, 100].
    const score = Math.max(0, Math.min(100, 50 + z * 14));
    return { ...r, score: Math.round(score * 100) / 100 };
  });
}
