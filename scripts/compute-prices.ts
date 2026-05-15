/**
 * CLI wrapper for the price recompute op.
 * Library: lib/ops/compute-prices.ts (also used by /admin actions).
 *
 * Usage: pnpm compute:prices
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runComputePrices } from "../lib/ops/compute-prices";

async function main() {
  console.log("Computing prices...");
  const r = await runComputePrices();
  console.log(
    `  ${r.eligible}/${r.playersConsidered} eligible · ${r.rowsWritten} written · ${(r.durationMs / 1000).toFixed(2)}s`
  );
  console.log("\nTop 15 by price:");
  for (let i = 0; i < r.topByPrice.length; i++) {
    const p = r.topByPrice[i];
    console.log(
      `  ${String(i + 1).padStart(3)}  ${String(p.price).padStart(4)}  ${p.tier.padEnd(10)}  ${p.rating.toFixed(1).padStart(5)}  ${p.displayName} (${p.countryName.slice(0, 16)})`
    );
  }
  console.log("\nTier counts:", r.tierCounts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
