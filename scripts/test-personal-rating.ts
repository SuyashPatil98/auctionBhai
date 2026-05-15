/**
 * Pure-function tests for lib/personal-rating/compute.ts.
 *
 * Locks in the worked example from the design discussion (Declan Rice) and
 * a handful of edge cases. Run via `pnpm test:rating`. Exits non-zero on
 * any failure.
 *
 * This is intentionally test-framework-free — the formula is small enough
 * that node:assert against expected scalars is plenty, and it avoids
 * pulling vitest/jest into the project just for this.
 */

import assert from "node:assert/strict";
import {
  computePersonalRating,
  EPSILON,
  type FactorPercentile,
  type FactorWeight,
} from "../lib/personal-rating/compute";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error("    " + (e as Error).message);
    failed++;
  }
}

console.log("Personal rating compute tests\n");

// ---------------------------------------------------------------------------
// The Rice example — the canonical worked-out case from the design doc.
// CM manager profile, Rice's percentiles in CM bucket, expected score 73.
// ---------------------------------------------------------------------------

test("Rice CM example produces 73", () => {
  const weights: FactorWeight[] = [
    { factor_id: "wc_appearances", importance: "important" },
    { factor_id: "international_caps", importance: "important" },
    { factor_id: "wc_goals", importance: "important" },
    { factor_id: "season_goals", importance: "standard" },
    { factor_id: "market_value_eur", importance: "standard" },
    { factor_id: "age", importance: "standard" },
  ];

  const percentiles: FactorPercentile[] = [
    { factor_id: "wc_appearances", percentile: 0.78, has_data: true },
    { factor_id: "international_caps", percentile: 0.82, has_data: true },
    { factor_id: "wc_goals", percentile: 0.55, has_data: true },
    { factor_id: "season_goals", percentile: 0.40, has_data: true },
    { factor_id: "market_value_eur", percentile: 0.92, has_data: true },
    { factor_id: "age", percentile: 0.50, has_data: true },
  ];

  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.score, 73, `got ${result.score}, expected 73`);
  assert.equal(result.coverage, 6);
  assert.equal(result.total, 6);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("EPSILON is 0.20", () => {
  assert.equal(EPSILON, 0.20);
});

// ---------------------------------------------------------------------------
// Sanity bounds
// ---------------------------------------------------------------------------

test("all 95th percentile → ~96", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "market_value_eur", importance: "important" },
    { factor_id: "empirical_rating", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = weights.map((w) => ({
    factor_id: w.factor_id,
    percentile: 0.95,
    has_data: true,
  }));
  const result = computePersonalRating(weights, percentiles);
  assert.equal(
    result.score,
    96,
    `top-tier across the board should score 96, got ${result.score}`
  );
});

test("all median (50th) → 60", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "market_value_eur", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = weights.map((w) => ({
    factor_id: w.factor_id,
    percentile: 0.5,
    has_data: true,
  }));
  // p' = 0.20 + 0.80 * 0.50 = 0.60. exp(ln(0.60)) = 0.60. score = 60.
  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.score, 60);
});

test("all 0th percentile → 20 (soft floor)", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "market_value_eur", importance: "important" },
  ];
  const percentiles: FactorPercentile[] = weights.map((w) => ({
    factor_id: w.factor_id,
    percentile: 0,
    has_data: true,
  }));
  // p' = 0.20. exp(ln(0.20)) = 0.20. score = 20.
  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.score, 20, `soft floor → 20, got ${result.score}`);
});

// ---------------------------------------------------------------------------
// Importance weighting
// ---------------------------------------------------------------------------

test("important factor at 90th + standard at 50th: important pulls score up", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "market_value_eur", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = [
    { factor_id: "season_goals", percentile: 0.9, has_data: true },
    { factor_id: "market_value_eur", percentile: 0.5, has_data: true },
  ];
  const result = computePersonalRating(weights, percentiles);
  // p1' = 0.92, p2' = 0.60. weights 2, 1. log-sum = 2*ln(0.92)+ln(0.60) = -0.677. /3 = -0.226. exp = 0.799 → 80.
  assert.equal(result.score, 80);
});

test("standard factor at 90th + important at 50th: standard can't lift much", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "market_value_eur", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = [
    { factor_id: "season_goals", percentile: 0.5, has_data: true },
    { factor_id: "market_value_eur", percentile: 0.9, has_data: true },
  ];
  const result = computePersonalRating(weights, percentiles);
  // p1' = 0.60, p2' = 0.92. weights 2, 1. log-sum = 2*ln(0.60)+ln(0.92) = -1.105. /3 = -0.368. exp = 0.692 → 69.
  assert.equal(result.score, 69);
});

// ---------------------------------------------------------------------------
// Coverage / missing data
// ---------------------------------------------------------------------------

test("missing factor is silently dropped, coverage reflects it", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "clean_sheets", importance: "important" }, // no data
    { factor_id: "market_value_eur", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = [
    { factor_id: "season_goals", percentile: 0.9, has_data: true },
    { factor_id: "clean_sheets", percentile: 0.5, has_data: false }, // dropped
    { factor_id: "market_value_eur", percentile: 0.8, has_data: true },
  ];
  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.coverage, 2);
  assert.equal(result.total, 3);
  // Same as "important 0.9 + standard 0.8" without clean_sheets:
  // p1' = 0.92, p2' = 0.84. log-sum = 2*ln(0.92)+ln(0.84) = -0.341. /3 = -0.114. exp = 0.892 → 89.
  assert.equal(result.score, 89);
});

test("zero coverage → neutral 50, not 0", () => {
  const weights: FactorWeight[] = [
    { factor_id: "clean_sheets", importance: "important" },
  ];
  const percentiles: FactorPercentile[] = [
    { factor_id: "clean_sheets", percentile: 0.5, has_data: false },
  ];
  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.score, 50);
  assert.equal(result.coverage, 0);
});

// ---------------------------------------------------------------------------
// Breakdown
// ---------------------------------------------------------------------------

test("breakdown has one entry per weight, even for missing", () => {
  const weights: FactorWeight[] = [
    { factor_id: "season_goals", importance: "important" },
    { factor_id: "clean_sheets", importance: "standard" },
  ];
  const percentiles: FactorPercentile[] = [
    { factor_id: "season_goals", percentile: 0.7, has_data: true },
    { factor_id: "clean_sheets", percentile: 0.5, has_data: false },
  ];
  const result = computePersonalRating(weights, percentiles);
  assert.equal(result.breakdown.length, 2);
  assert.equal(result.breakdown[0].percentile, 0.7);
  assert.equal(result.breakdown[1].percentile, null);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
