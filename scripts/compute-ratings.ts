/**
 * Computes pre-tournament baseline ratings for every real_player and writes
 * them to player_ratings.
 *
 * Pipeline:
 *   1. Layer 1 — deterministic skeleton (per-position age curve)
 *   2. Layer 2 — Transfermarkt market value (z-scored within sub-position
 *      bucket)
 *   3. Layer 3 — Gemini-researched score (CACHED — reads gemini_research
 *      table by default; pass --with-ai to refresh the cache)
 *   4. Blend layers 1-3 by match quality / L3 confidence
 *   5. Layer 4 — international pedigree adjustment (caps + goals/cap),
 *      added on top of the blend
 *   6. Position-normalize the final scores across the league
 *
 * Re-running is fast (~5s) unless --with-ai is set; the cache means we
 * don't re-spend API budget on every iteration.
 *
 * Usage:
 *   pnpm compute:ratings              # uses cached Gemini data
 *   pnpm compute:ratings --with-ai    # refreshes the Gemini cache (~$0.10)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

// Type-only imports are erased at runtime, safe to use before dotenv loads.
import type { Bucket } from "../lib/rating/buckets";
import type { Layer4Result } from "../lib/rating/pedigree";

const GEMINI_PROMPT_VERSION = "v1";

async function main() {
  const withAi = process.argv.includes("--with-ai");

  const { db } = await import("../lib/db");
  const { playerRatings, geminiResearch } = await import("../lib/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { findBestMatches } = await import("../lib/rating/match");
  const { computeLayer1, ageFromDob } = await import("../lib/rating/baseline");
  const {
    computeLayer2,
    computeBucketStats,
  } = await import("../lib/rating/market-value");
  const { bucketFromSubPosition } = await import("../lib/rating/buckets");
  const { blendLayers, positionNormalize } = await import(
    "../lib/rating/blend"
  );
  const { computeLayer4, computeGoalRateStats } = await import(
    "../lib/rating/pedigree"
  );

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

  // 1. Per-bucket market-value stats (matched players only).
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

  // 2. Per-position international goal-rate stats (for Layer 4).
  const goalRateStats = computeGoalRateStats(
    matches.map((m) => ({
      position: m.position,
      caps: m.internationalCaps,
      goals: m.internationalGoals,
    }))
  );

  // 3. Layer 3 — load from cache, optionally refresh from Gemini.
  type Layer3 = { score: number; confidence: string; reasoning: string };
  const layer3Map = new Map<string, Layer3>();

  console.log("\nLoading Gemini Layer 3 cache...");
  const cached = await db.select().from(geminiResearch);
  for (const row of cached) {
    if (row.promptVersion === GEMINI_PROMPT_VERSION) {
      layer3Map.set(row.realPlayerId, {
        score: Number(row.score),
        confidence: row.confidence,
        reasoning: row.reasoning ?? "",
      });
    }
  }
  console.log(`  ${layer3Map.size} cached layer-3 entries`);

  if (withAi) {
    const { researchPlayersWithGemini } = await import("../lib/rating/layer3");

    // Step a: prelim L2 score for ranking.
    const prelim = matches.map((m) => {
      const bucket = bucketFromSubPosition(m.tmSubPosition, m.position);
      const l2 = computeLayer2(
        { bucket, marketValueEur: m.marketValueEur },
        bucketStats
      );
      return { match: m, l2Score: l2.score };
    });

    // Step b: top 30 per position by L2 score.
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

    // Step d: union, minus already-cached.
    const candidateIds = new Set([...topPerPosition, ...gapFillers]);
    const candidates = matches.filter(
      (m) => candidateIds.has(m.realPlayerId) && !layer3Map.has(m.realPlayerId)
    );
    console.log(
      `Running Gemini Layer 3...\n  ${candidates.length} candidates (cache-miss); ${
        candidateIds.size - candidates.length
      } already cached`
    );

    const results = await researchPlayersWithGemini(candidates);
    for (const r of results) {
      layer3Map.set(r.realPlayerId, r.layer3);
    }
    console.log(`  ${results.length} new layer-3 scores produced`);

    // Persist new results to cache.
    if (results.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < results.length; i += CHUNK) {
        const slice = results.slice(i, i + CHUNK).map((r) => ({
          realPlayerId: r.realPlayerId,
          model: "gemini-2.5-flash-lite",
          promptVersion: GEMINI_PROMPT_VERSION,
          score: String(r.layer3.score),
          confidence: r.layer3.confidence,
          reasoning: r.layer3.reasoning,
        }));
        await db
          .insert(geminiResearch)
          .values(slice)
          .onConflictDoUpdate({
            target: geminiResearch.realPlayerId,
            set: {
              model: sql`excluded.model`,
              promptVersion: sql`excluded.prompt_version`,
              score: sql`excluded.score`,
              confidence: sql`excluded.confidence`,
              reasoning: sql`excluded.reasoning`,
              researchedAt: sql`now()`,
            },
          });
      }
      console.log(`  cached ${results.length} new entries`);
    }
  }

  // 4. Compute layers + blend per player.
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

    // Blend L1+L2 first (existing logic, weighted by TM match quality).
    const baseBlend = blendLayers({
      layer1: l1,
      layer2: l2,
      matchQuality: m.matchQuality,
    });

    let postL3 = baseBlend.score;
    let blendInfo: Record<string, unknown> = {
      l1Weight: baseBlend.weights.layer1,
      l2Weight: baseBlend.weights.layer2,
      postL1L2: baseBlend.score,
    };

    // Fold L3 in if confident.
    if (l3 && (l3.confidence === "high" || l3.confidence === "medium")) {
      const l3Weight = l3.confidence === "high" ? 0.5 : 0.3;
      postL3 = (1 - l3Weight) * baseBlend.score + l3Weight * l3.score;
      blendInfo = {
        ...blendInfo,
        l3Weight,
        postL3,
      };
    }

    // Layer 4: international pedigree additive adjustment.
    const age = ageFromDob(m.dob);
    const l4: Layer4Result = computeLayer4(
      {
        position: m.position,
        age,
        internationalCaps: m.internationalCaps,
        internationalGoals: m.internationalGoals,
      },
      goalRateStats
    );

    const preNorm = Math.max(0, Math.min(100, postL3 + l4.adjustment));

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
        layer4: l4,
        match: {
          tmPlayerId: m.tmPlayerId,
          tmName: m.tmName,
          tmSubPosition: m.tmSubPosition,
          quality: m.matchQuality,
          nameSimilarity: m.nameSimilarity,
        },
        blend: { ...blendInfo, pedigreeAdj: l4.adjustment, preNorm },
      },
    };
  });

  // 5. Position-normalize.
  const normalized = positionNormalize(rowsForNorm);

  // 6. Write player_ratings.
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

  // 7. Print top 10 per position for sanity.
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
