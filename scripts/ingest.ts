/**
 * One-shot CLI runner for the football-data.org ingestion pipeline.
 *
 * Usage:
 *   pnpm ingest              # full pipeline: tournament, countries+squads, fixtures
 *   pnpm ingest tournament   # single step
 *   pnpm ingest countries
 *   pnpm ingest fixtures
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  // Dynamic import so dotenv has set process.env before lib/db/index.ts
  // reads DATABASE_URL at module load.
  const {
    ingestCountriesAndSquads,
    ingestFixtures,
    ingestTournament,
  } = await import("../lib/ingest/football-data");

  const steps = {
    tournament: () => ingestTournament(),
    countries: () => ingestCountriesAndSquads(),
    fixtures: () => ingestFixtures(),
  };

  const arg = process.argv[2];

  if (!arg) {
    console.log("→ tournament");
    const t = await ingestTournament();
    console.log(`  ok · ${t.rowsChanged} rows · ${t.notes ?? ""}`);

    console.log("→ countries+squads");
    const c = await ingestCountriesAndSquads();
    console.log(`  ok · ${c.rowsChanged} rows · ${c.notes ?? ""}`);

    console.log("→ fixtures");
    const f = await ingestFixtures();
    console.log(`  ok · ${f.rowsChanged} rows · ${f.notes ?? ""}`);

    return;
  }

  const step = steps[arg as keyof typeof steps];
  if (!step) {
    console.error(
      `Unknown step "${arg}". Valid: ${Object.keys(steps).join(", ")}`
    );
    process.exit(2);
  }

  console.log(`→ ${arg}`);
  const r = await step();
  console.log(`  ok · ${r.rowsChanged} rows · ${r.notes ?? ""}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
