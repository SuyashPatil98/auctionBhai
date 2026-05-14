/**
 * Computes pre-tournament baseline ratings for every real_player and writes
 * them to player_ratings.
 *
 * Pipeline:
 *   1. Layer 1 — deterministic skeleton (per-position age curve)
 *   2. Layer 2 — Transfermarkt market value (log-scale, z-scored within
 *      sub-position bucket so wingers don't compete against centre-backs)
 *   3. Optional Layer 3 — Gemini-researched score for un-matched or
 *      low-quality-match players (only kicks in when `--with-ai` is set)
 *   4. Blend layers by match quality
 *   5. Position-normalize the blended scores across the league
 *
 * Idempotent — re-running inserts a new player_ratings row per player with
 * a fresh `as_of` timestamp.
 *
 * Usage:
 *   pnpm compute:ratings
 *   pnpm compute:ratings --with-ai      # runs Layer 3 too (~$0.20)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

// Type-only imports are erased at runtime, safe to do before dotenv loads.
import type { Bucket } from "../lib/rating/buckets";

async function main() {
  const withAi = process.argv.includes("--with-ai");

  // Lazy imports so dotenv loads first.
  const { db } = await import("../lib/db");
  const { playerRatings } = await import("../lib/db/schema");
  const { findBestMatches } = await import("../lib/rating/match");
  const { computeLayer1 } = await import("../lib/rating/baseline");
  const {
    computeLayer2,
    computeBucketStats,
  } = await import("../lib/rating/market-value");
  const { bucketFromSubPosition } = await import("../lib/rating/buckets");
  const { blendLayers, positionNormalize } = await import("../lib/rating/blend");

  console.log("Matching real_players → transfermarkt_players...");
  const matches = await findBestMatches();
  console.log(`  ${matches.length} real_players queried`);

  const qualityCounts = matches.reduce(
    (acc, m) => {
      acc[m.matchQuality] = (acc[m.matchQuality] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log("  match-quality distribution:", qualityCounts);

  // 1. Compute per-bucket stats from matched players (high+medium quality).
  console.log("Computing per-bucket market-value statistics...");
  const valuesByBucket = new Map<Bucket, number[]>();
  for (const m of matches) {
    const bucket = bucketFromSubPosition(m.tmSubPosition, m.position);
    if (
      m.marketValueEur &&
      m.marketValueEur > 0 &&
      (m.matchQuality === "high" || m.matchQuality === "medium")
    ) {
      if (!valuesByBucket.has(bucket)) valuesByBucket.set(bucket, []);
      valuesByBucket.get(bucket)!.push(m.marketValueEur);
    }
  }
  const bucketStats = computeBucketStats(valuesByBucket);
  console.log("  bucket   n     mean(log)  stdDev");
  for (const [bucket, s] of [...bucketStats.entries()].sort()) {
    console.log(
      `  ${String(bucket).padEnd(8)} ${String(s.n).padStart(4)}  ${s.mean.toFixed(2).padStart(8)}  ${s.stdDev.toFixed(2)}`
    );
  }

  // 2. Optional Layer 3 — Gemini research.
  //    Candidates: every none/low TM match (gap-filling) + top N per position
  //    by their Layer 2 score (sanity-checking the elite tier).
  type Layer3 = { score: number; confidence: string; reasoning: string };
  const layer3Map = new Map<string, Layer3>();
  if (withAi) {
    console.log("\nRunning Gemini Layer 3...");
    const { researchPlayersWithGemini } = await import("../lib/rating/layer3");

    // Step a: compute preliminary L2 score for ranking purposes.
    const prelim = matches.map((m) => {
      const bucket = bucketFromSubPosition(m.tmSubPosition, m.position);
      const l2 = computeLayer2(
        { bucket, marketValueEur: m.marketValueEur },
        bucketStats
      );
      return { match: m, l2Score: l2.score };
    });

    // Step b: top 30 per position by L2 score (where present).
    const TOP_N_PER_POS = 30;
    const topPerPosition = new Set<string>();
    for (const pos of ["GK", "DEF", "MID", "FWD"] as const) {
      prelim
        .filter((p) => p.match.position === pos && p.l2Score !== null)
        .sort((a, b) => (b.l2Score ?? 0) - (a.l2Score ?? 0))
        .slice(0, TOP_N_PER_POS)
        .forEach((p) => topPerPosition.add(p.match.realPlayerId));
    }

    // Step c: all none / low matches.
    const gapFillers = new Set(
      matches
        .filter((m) => m.matchQuality === "none" || m.matchQuality === "low")
        .map((m) => m.realPlayerId)
    );

    // Step d: union.
    const candidateIds = new Set([...topPerPosition, ...gapFillers]);
    const candidates = matches.filter((m) => candidateIds.has(m.realPlayerId));
    console.log(
      `  ${candidates.length} candidates (${topPerPosition.size} top-tier sanity-check + ${gapFillers.size} gap-fill, union)`
    );

    const results = await researchPlayersWithGemini(candidates);
    for (const r of results) layer3Map.set(r.realPlayerId, r.layer3);
    console.log(`  ${layer3Map.size} layer-3 scores produced`);
  }

  // 3. Compute Layer 1 + Layer 2 + Layer 3 + blend per player.
  console.log("\nComputing per-player ratings...");
  type RowOut = {
    realPlayerId: string;
    realPlayerName: string;
    position: "GK" | "DEF" | "MID" | "FWD";
    preNormScore: number;
    inputs: Record<string, unknown>;
  };
  const rowsForNorm: RowOut[] = matches.map((m) => {
    const bucket = bucketFromSubPosition(m.tmSubPosition, m.position);
    const l1 = computeLayer1({ position: m.position, dob: m.dob });
    const l2 = computeLayer2(
      { bucket, marketValueEur: m.marketValueEur },
      bucketStats
    );
    const l3 = layer3Map.get(m.realPlayerId) ?? null;

    // Blend: when Layer 3 is present and confident, replace some of the
    // L2 weight with L3. Otherwise just use L1 + L2.
    const baseBlend = blendLayers({
      layer1: l1,
      layer2: l2,
      matchQuality: m.matchQuality,
    });

    let preNorm = baseBlend.score;
    let blendInfo: Record<string, unknown> = {
      l1Weight: baseBlend.weights.layer1,
      l2Weight: baseBlend.weights.layer2,
      preNorm,
    };

    if (l3 && (l3.confidence === "high" || l3.confidence === "medium")) {
      const l3Weight = l3.confidence === "high" ? 0.5 : 0.3;
      preNorm = (1 - l3Weight) * baseBlend.score + l3Weight * l3.score;
      blendInfo = {
        l1Weight: (1 - l3Weight) * baseBlend.weights.layer1,
        l2Weight: (1 - l3Weight) * baseBlend.weights.layer2,
        l3Weight,
        preNorm,
      };
    }

    return {
      realPlayerId: m.realPlayerId,
      realPlayerName: m.realPlayerName,
      position: m.position,
      preNormScore: preNorm,
      inputs: {
        bucket,
        layer1: l1,
        layer2: l2,
        layer3: l3,
        match: {
          tmPlayerId: m.tmPlayerId,
          tmName: m.tmName,
          tmSubPosition: m.tmSubPosition,
          quality: m.matchQuality,
          nameSimilarity: m.nameSimilarity,
        },
        blend: blendInfo,
      },
    };
  });

  // 4. Position-normalize across the league (within DbPosition for the
  // headline 0-100 spread, since that's what users see).
  const normalized = positionNormalize(rowsForNorm);

  // 5. Write to player_ratings (one new row per player; source=baseline).
  console.log("Writing player_ratings...");
  const asOf = new Date();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < normalized.length; i += CHUNK) {
    const slice = normalized.slice(i, i + CHUNK).map((r) => ({
      realPlayerId: r.realPlayerId,
      asOf,
      rating: String(r.score),
      formRating: String(r.score),
      source: "baseline" as const,
      inputs: { ...r.inputs, final: { afterPositionNormalization: r.score } },
    }));
    await db.insert(playerRatings).values(slice);
    written += slice.length;
    process.stdout.write(`\r  wrote ${written}/${normalized.length}`);
  }
  process.stdout.write("\n");

  // 6. Print top-10 per position for sanity.
  const top = (pos: string) =>
    normalized
      .filter((r) => r.position === pos)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  console.log("\nTop 10 per position:");
  for (const pos of ["GK", "DEF", "MID", "FWD"]) {
    console.log(`\n  ${pos}:`);
    for (const r of top(pos)) {
      console.log(`    ${r.score.toFixed(1).padStart(5)}  ${r.realPlayerName}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
