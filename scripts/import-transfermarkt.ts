/**
 * Imports the dcaribou/transfermarkt-datasets `players.csv.gz` snapshot
 * into the `transfermarkt_players` staging table.
 *
 * Source: https://github.com/dcaribou/transfermarkt-datasets
 * Hosted on Cloudflare R2 (no auth):
 *   https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz
 *
 * Re-runnable: upserts on tm_player_id. Expect ~37k rows in <60s.
 *
 * Usage: pnpm import:tm
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { gunzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";

const CSV_URL =
  "https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz";

type RawRow = {
  player_id: string;
  name: string;
  country_of_citizenship: string;
  date_of_birth: string;
  position: string;
  sub_position: string;
  current_club_name: string;
  current_club_domestic_competition_id: string;
  market_value_in_eur: string;
  highest_market_value_in_eur: string;
  international_caps: string;
  international_goals: string;
  image_url: string;
};

function toIntOrNull(v: string | undefined): number | null {
  if (!v || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toDateOrNull(v: string | undefined): string | null {
  if (!v || v === "") return null;
  // CSV has "1978-06-09 00:00:00" — keep just the date.
  const datePart = v.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return datePart;
}

function toTextOrNull(v: string | undefined): string | null {
  if (!v || v === "") return null;
  return v;
}

async function main() {
  console.log(`Downloading ${CSV_URL}...`);
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const gz = Buffer.from(await res.arrayBuffer());
  console.log(`  got ${(gz.byteLength / 1024 / 1024).toFixed(2)} MB compressed`);

  console.log("Decompressing...");
  const csv = gunzipSync(gz).toString("utf-8");
  console.log(`  ${(csv.length / 1024 / 1024).toFixed(2)} MB decompressed`);

  console.log("Parsing CSV...");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as RawRow[];
  console.log(`  ${rows.length} rows`);

  const mapped = rows
    .map((r) => {
      const id = toIntOrNull(r.player_id);
      if (id === null) return null;
      return {
        tmPlayerId: id,
        name: r.name,
        countryOfCitizenship: toTextOrNull(r.country_of_citizenship),
        dateOfBirth: toDateOrNull(r.date_of_birth),
        position: toTextOrNull(r.position),
        subPosition: toTextOrNull(r.sub_position),
        currentClubName: toTextOrNull(r.current_club_name),
        currentClubDomesticCompetitionId: toTextOrNull(
          r.current_club_domestic_competition_id
        ),
        marketValueEur: toIntOrNull(r.market_value_in_eur),
        highestMarketValueEur: toIntOrNull(r.highest_market_value_in_eur),
        internationalCaps: toIntOrNull(r.international_caps),
        internationalGoals: toIntOrNull(r.international_goals),
        imageUrl: toTextOrNull(r.image_url),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  console.log(`  ${mapped.length} valid rows to upsert`);

  // Bulk-upsert in chunks to avoid hitting parameter limits.
  const { db } = await import("../lib/db");
  const { transfermarktPlayers } = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");

  const CHUNK = 2000;
  let done = 0;
  for (let i = 0; i < mapped.length; i += CHUNK) {
    const slice = mapped.slice(i, i + CHUNK);
    await db
      .insert(transfermarktPlayers)
      .values(slice)
      .onConflictDoUpdate({
        target: transfermarktPlayers.tmPlayerId,
        set: {
          name: sql`excluded.name`,
          countryOfCitizenship: sql`excluded.country_of_citizenship`,
          dateOfBirth: sql`excluded.date_of_birth`,
          position: sql`excluded.position`,
          subPosition: sql`excluded.sub_position`,
          currentClubName: sql`excluded.current_club_name`,
          currentClubDomesticCompetitionId: sql`excluded.current_club_domestic_competition_id`,
          marketValueEur: sql`excluded.market_value_eur`,
          highestMarketValueEur: sql`excluded.highest_market_value_eur`,
          internationalCaps: sql`excluded.international_caps`,
          internationalGoals: sql`excluded.international_goals`,
          imageUrl: sql`excluded.image_url`,
          importedAt: sql`now()`,
        },
      });
    done += slice.length;
    process.stdout.write(`\r  upserted ${done}/${mapped.length}`);
  }
  process.stdout.write("\n");
  console.log(`Done — ${done} Transfermarkt player rows in staging.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
