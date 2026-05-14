/**
 * Computes pre-tournament baseline ratings for every real_player and writes
 * them to player_ratings.
 *
 * Pipeline:
 *   1. Layer 1 — deterministic skeleton (position + age curve)
 *   2. Layer 2 — Transfermarkt market value (log-scale, position-normalized)
 *   3. Blend layers by match quality
 *   4. Position-normalize the blended scores across the league
 *
 * Idempotent — re-running overwrites. One row per (player, as_of) timestamp.
 *
 * Usage: pnpm compute:ratings
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  // Lazy imports so dotenv loads first.
  const { db } = await import("../lib/db");
  const { playerRatings } = await import("../lib/db/schema");
  const { findBestMatches } = await import("../lib/rating/match");
  const { computeLayer1 } = await import("../lib/rating/baseline");
  const {
    computeLayer2,
    computePositionStats,
  } = await import("../lib/rating/market-value");
  const { blendLayers, positionNormalize } = await import(
    "../lib/rating/blend"
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

  // 1. Compute position stats from matched players (high+medium quality).
  console.log("Computing per-position market-value statistics...");
  const valuesByPos: Record<
    "GK" | "DEF" | "MID" | "FWD",
    number[]
  > = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const m of matches) {
    if (
      m.marketValueEur &&
      m.marketValueEur > 0 &&
      (m.matchQuality === "high" || m.matchQuality === "medium")
    ) {
      valuesByPos[m.position].push(m.marketValueEur);
    }
  }
  const stats = computePositionStats(valuesByPos);
  for (const pos of ["GK", "DEF", "MID", "FWD"] as const) {
    console.log(
      `  ${pos}: n=${stats[pos].n}, mean(log)=${stats[pos].mean.toFixed(2)}, std=${stats[pos].stdDev.toFixed(2)}`
    );
  }

  // 2. Compute Layer 1 + Layer 2 + blend per player.
  console.log("Computing per-player ratings...");
  type RowOut = {
    realPlayerId: string;
    realPlayerName: string;
    position: "GK" | "DEF" | "MID" | "FWD";
    preNormScore: number;
    inputs: Record<string, unknown>;
  };
  const rowsForNorm: RowOut[] = matches.map((m) => {
    const l1 = computeLayer1({ position: m.position, dob: m.dob });
    const l2 = computeLayer2(
      { position: m.position, marketValueEur: m.marketValueEur },
      stats
    );
    const blend = blendLayers({
      layer1: l1,
      layer2: l2,
      matchQuality: m.matchQuality,
    });
    return {
      realPlayerId: m.realPlayerId,
      realPlayerName: m.realPlayerName,
      position: m.position,
      preNormScore: blend.score,
      inputs: {
        layer1: l1,
        layer2: l2,
        match: {
          tmPlayerId: m.tmPlayerId,
          tmName: m.tmName,
          quality: m.matchQuality,
          nameSimilarity: m.nameSimilarity,
        },
        blend: { weights: blend.weights, preNorm: blend.score },
      },
    };
  });

  // 3. Position-normalize across the league.
  const normalized = positionNormalize(rowsForNorm);

  // 4. Write to player_ratings (one row per player; source=baseline).
  console.log("Writing player_ratings...");
  const asOf = new Date();
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < normalized.length; i += CHUNK) {
    const slice = normalized.slice(i, i + CHUNK).map((r) => ({
      realPlayerId: r.realPlayerId,
      asOf,
      rating: String(r.score),
      formRating: String(r.score), // start equal to baseline
      source: "baseline" as const,
      inputs: { ...r.inputs, final: { afterPositionNormalization: r.score } },
    }));
    await db.insert(playerRatings).values(slice);
    written += slice.length;
    process.stdout.write(`\r  wrote ${written}/${normalized.length}`);
  }
  process.stdout.write("\n");

  // 5. Print top-10 per position for sanity.
  const top = (pos: string) =>
    normalized
      .filter((r) => r.position === pos)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  console.log("\nTop 10 per position:");
  for (const pos of ["GK", "DEF", "MID", "FWD"]) {
    console.log(`\n  ${pos}:`);
    for (const r of top(pos)) {
      console.log(
        `    ${r.score.toFixed(1).padStart(5)}  ${r.realPlayerName}`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
