/**
 * CLI wrapper for the percentile recompute op.
 * Library: lib/ops/compute-percentiles.ts (also used by /admin actions).
 *
 * Usage: pnpm compute:percentiles
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runComputePercentiles } from "../lib/ops/compute-percentiles";

async function main() {
  console.log("Computing percentiles...");
  const r = await runComputePercentiles();
  console.log(
    `  ${r.playersProcessed} players × ${r.factorsComputed} factors → ${r.rowsWritten} rows in ${(r.durationMs / 1000).toFixed(2)}s`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
