/**
 * Recomputes player_prices from latest ratings + bracket sim output.
 *
 * Library-callable. CLI wrapper lives in scripts/compute-prices.ts.
 *
 * Pipeline:
 *   1. Read latest player_ratings.rating per player (DISTINCT ON).
 *   2. Read countries.expected_matches (must be populated by sim:bracket).
 *   3. Run lib/price/engine.computePrices() → price + tier per eligible player.
 *   4. Upsert into player_prices.
 */

import { db } from "@/lib/db";
import {
  countries,
  playerPrices,
  realPlayers,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { computePrices } from "@/lib/price/engine";

export type ComputePricesResult = {
  playersConsidered: number;
  eligible: number;
  rowsWritten: number;
  tierCounts: Record<string, number>;
  topByPrice: Array<{
    displayName: string;
    countryName: string;
    price: number;
    tier: string;
    rating: number;
  }>;
  durationMs: number;
};

export async function runComputePrices(): Promise<ComputePricesResult> {
  const t0 = Date.now();

  type RatingRow = { real_player_id: string; rating: number | string };
  const latestRatings = (await db.execute(sql`
    select distinct on (real_player_id)
      real_player_id,
      rating::numeric as rating
    from player_ratings
    order by real_player_id, as_of desc
  `)) as unknown as RatingRow[];
  const ratingByPlayer = new Map<string, number>(
    latestRatings.map((r) => [r.real_player_id, Number(r.rating)])
  );

  const rows = await db
    .select({
      realPlayerId: realPlayers.id,
      countryId: realPlayers.countryId,
      position: realPlayers.position,
      displayName: realPlayers.displayName,
      isActive: realPlayers.isActive,
      countryExpectedMatches: countries.expectedMatches,
      countryName: countries.name,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(realPlayers.countryId, countries.id));

  const rowsWithRatings = rows.map((r) => ({
    ...r,
    rating: ratingByPlayer.get(r.realPlayerId) ?? null,
  }));

  const eligible = rowsWithRatings.filter(
    (r) =>
      r.isActive && r.rating !== null && r.countryExpectedMatches !== null
  );

  if (eligible.length === 0) {
    throw new Error(
      "no eligible players — run compute:ratings and sim:bracket first"
    );
  }

  const expByCountry = new Map<string, number>();
  for (const r of rowsWithRatings) {
    if (r.countryExpectedMatches !== null) {
      expByCountry.set(r.countryId, Number(r.countryExpectedMatches));
    }
  }

  const input = eligible.map((r) => ({
    realPlayerId: r.realPlayerId,
    countryId: r.countryId,
    position: r.position as "GK" | "DEF" | "MID" | "FWD",
    rating: Number(r.rating),
  }));

  const prices = computePrices(input, expByCountry);

  const byPlayer = new Map(prices.map((p) => [p.realPlayerId, p]));
  const named = eligible
    .map((r) => ({ ...r, ...byPlayer.get(r.realPlayerId)! }))
    .filter((n) => n.price !== undefined);
  named.sort((a, b) => b.price - a.price);

  const topByPrice = named.slice(0, 15).map((p) => ({
    displayName: p.displayName,
    countryName: p.countryName,
    price: p.price,
    tier: p.tier,
    rating: Number(p.rating),
  }));

  const tierCounts = prices.reduce(
    (acc, p) => {
      acc[p.tier] = (acc[p.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < prices.length; i += CHUNK) {
    const slice = prices.slice(i, i + CHUNK).map((p) => ({
      realPlayerId: p.realPlayerId,
      price: p.price,
      tier: p.tier,
      expectedPoints: String(p.expectedPoints),
      expectedMatches: p.expectedMatches.toFixed(2),
      computedAt: new Date(),
      inputs: {
        starterProb: p.starterProb,
        positionRankInCountry: p.positionRankInCountry,
      },
    }));
    await db
      .insert(playerPrices)
      .values(slice)
      .onConflictDoUpdate({
        target: playerPrices.realPlayerId,
        set: {
          price: sql`excluded.price`,
          tier: sql`excluded.tier`,
          expectedPoints: sql`excluded.expected_points`,
          expectedMatches: sql`excluded.expected_matches`,
          computedAt: sql`excluded.computed_at`,
          inputs: sql`excluded.inputs`,
        },
      });
    written += slice.length;
  }

  return {
    playersConsidered: rowsWithRatings.length,
    eligible: eligible.length,
    rowsWritten: written,
    tierCounts,
    topByPrice,
    durationMs: Date.now() - t0,
  };
}
