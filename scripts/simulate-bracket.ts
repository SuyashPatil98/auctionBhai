/**
 * Runs the bracket Monte Carlo against our seeded country Elos and
 * writes expected_matches back to the countries table.
 *
 * Usage:
 *   pnpm sim:bracket                 # 10,000 sims (default)
 *   pnpm sim:bracket --sims=50000    # finer resolution, ~5× slower
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const simsArg = process.argv.find((a) => a.startsWith("--sims="));
  const sims = simsArg ? Number.parseInt(simsArg.slice(7), 10) : 10_000;
  if (!Number.isFinite(sims) || sims < 100) {
    console.error("--sims must be a positive integer ≥ 100");
    process.exit(2);
  }

  const { db } = await import("../lib/db");
  const { countries } = await import("../lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runMonteCarlo, DEFAULT_ELO } = await import("../lib/sim/bracket");

  console.log(`Loading countries...`);
  const all = await db
    .select({
      id: countries.id,
      code: countries.code,
      name: countries.name,
      elo: countries.elo,
      groupLetter: countries.groupLetter,
    })
    .from(countries);
  console.log(`  ${all.length} countries`);

  const teams = all.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    elo: c.elo !== null ? Number(c.elo) : DEFAULT_ELO,
    groupLetter: c.groupLetter,
  }));

  const withGroups = teams.filter((t) => t.groupLetter).length;
  console.log(
    `  ${withGroups} have a groupLetter assigned; ${teams.length - withGroups} will be drawn randomly per sim`
  );

  console.log(`\nRunning ${sims.toLocaleString()} simulations...`);
  const start = Date.now();
  const result = runMonteCarlo(teams, sims);
  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`  done in ${elapsed}s\n`);

  // Sanity print
  const ranked = teams
    .map((t) => ({
      ...t,
      expected: result.expectedMatches.get(t.id) ?? 0,
      stage: result.stageProb.get(t.id)!,
    }))
    .sort((a, b) => b.expected - a.expected);

  console.log("Top 10 by expected matches:");
  console.log(
    "  code  exp   QF%   SF%   Final%  Champ%   Elo   Name"
  );
  for (const r of ranked.slice(0, 10)) {
    console.log(
      `  ${r.code.padEnd(4)} ${r.expected.toFixed(2).padStart(4)}  ` +
        `${(r.stage.qf * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.stage.sf * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.stage.final * 100).toFixed(0).padStart(5)}%  ` +
        `${(r.stage.champion * 100).toFixed(1).padStart(5)}%   ` +
        `${r.elo.toFixed(0).padStart(4)}  ${r.name}`
    );
  }

  console.log("\nBottom 5 by expected matches:");
  for (const r of ranked.slice(-5)) {
    console.log(
      `  ${r.code.padEnd(4)} ${r.expected.toFixed(2).padStart(4)}  ${r.name}`
    );
  }

  // Persist.
  console.log("\nWriting expected_matches back to countries...");
  const now = new Date();
  for (const r of ranked) {
    await db
      .update(countries)
      .set({
        expectedMatches: r.expected.toFixed(2),
        expectedMatchesUpdatedAt: now,
      })
      .where(eq(countries.id, r.id));
  }
  console.log(`  done.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
