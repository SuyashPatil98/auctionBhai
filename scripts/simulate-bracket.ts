/**
 * CLI wrapper for bracket Monte Carlo.
 * Library: lib/ops/simulate-bracket.ts (also used by /admin actions).
 *
 * Usage:
 *   pnpm sim:bracket
 *   pnpm sim:bracket --sims=50000
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runSimulateBracket } from "../lib/ops/simulate-bracket";

async function main() {
  const simsArg = process.argv.find((a) => a.startsWith("--sims="));
  const sims = simsArg ? Number.parseInt(simsArg.slice(7), 10) : 10_000;

  console.log(`Running ${sims.toLocaleString()} simulations...`);
  const r = await runSimulateBracket({ sims });
  console.log(`  done in ${(r.durationMs / 1000).toFixed(2)}s\n`);

  console.log("Top 10 by expected matches:");
  console.log("  code  exp   QF%   SF%   Final%  Champ%   Elo   Name");
  for (const t of r.top10) {
    console.log(
      `  ${t.code.padEnd(4)} ${t.expectedMatches.toFixed(2).padStart(4)}  ` +
        `${t.qfPct.toFixed(0).padStart(3)}%  ` +
        `${t.sfPct.toFixed(0).padStart(3)}%  ` +
        `${t.finalPct.toFixed(0).padStart(5)}%  ` +
        `${t.championPct.toFixed(1).padStart(5)}%   ` +
        `${t.elo.toFixed(0).padStart(4)}  ${t.name}`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
