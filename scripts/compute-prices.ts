/**
 * Computes auction prices for every WC player and writes them to
 * player_prices.
 *
 * Reads:
 *   - real_players (position, country)
 *   - latest player_ratings.rating per player
 *   - countries.expected_matches (from bracket sim)
 *
 * Idempotent — re-running upserts on real_player_id.
 *
 * Usage: pnpm compute:prices
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { db } = await import("../lib/db");
  const {
    realPlayers,
    countries,
    playerRatings,
    playerPrices,
  } = await import("../lib/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { computePrices } = await import("../lib/price/engine");

  // Latest rating per player — DISTINCT ON gives us the freshest row per
  // player by as_of desc.
  type RatingRow = {
    real_player_id: string;
    rating: number | string;
  };
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
  console.log(
    `${rowsWithRatings.length} total players; ${eligible.length} eligible (have rating + country expected_matches)`
  );

  if (eligible.length === 0) {
    console.error(
      "No eligible players. Did you run `pnpm compute:ratings` and `pnpm sim:bracket`?"
    );
    process.exit(1);
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

  // Quick top-15 sanity print before write.
  const byPlayer = new Map(prices.map((p) => [p.realPlayerId, p]));
  const named = eligible.map((r) => ({
    ...r,
    ...byPlayer.get(r.realPlayerId)!,
  }));
  named.sort((a, b) => b.price - a.price);

  console.log("\nTop 15 by price:");
  console.log(
    "  rank  price  tier        pos   rtg   E[mp]  P(s)   player"
  );
  for (let i = 0; i < Math.min(15, named.length); i++) {
    const p = named[i];
    console.log(
      `  ${String(i + 1).padStart(4)}  ${String(p.price).padStart(5)}  ${
        p.tier.padEnd(10)
      }  ${p.position.padEnd(3)}  ${Number(p.rating).toFixed(1).padStart(5)}  ${p.expectedMatches.toFixed(2)}   ${(p.starterProb * 100).toFixed(0).padStart(3)}%   ${
        p.displayName
      } (${p.countryName.slice(0, 12)})`
    );
  }

  // Tier counts
  const tierCounts = prices.reduce(
    (acc, p) => {
      acc[p.tier] = (acc[p.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log("\nTier distribution:", tierCounts);

  // Write to player_prices.
  console.log("\nUpserting player_prices...");
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
    process.stdout.write(`\r  wrote ${written}/${prices.length}`);
  }
  process.stdout.write("\n");
  console.log("Done.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
