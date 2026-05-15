/**
 * Imports historical WC pedigree (goals/assists/appearances/tournaments,
 * 1998-2022) from `lib/data/wc_pedigree.json` into the `wc_pedigree` table.
 *
 * Matches by country first (narrows the candidate set), then fuzzy on name
 * within that country. With country pre-filtering the match is unambiguous
 * — most countries have <30 players in our pool, so name similarity is
 * very precise.
 *
 * Usage: pnpm import:wc
 *
 * Re-runs are idempotent (upsert on real_player_id). Entries that don't
 * match a player are reported but don't fail the run — likely the player
 * isn't on the 2026 roster (yet) or has a name variant we should add.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";

const JSON_PATH = "lib/data/wc_pedigree.json";

// `countries.code` in our DB is mostly ISO 3166-1 alpha-3, but with a few
// idiosyncratic codes (ALG, CPV, ANT, HTI) inherited from football-data.org.
// These aliases catch the cases where my JSON used a different convention
// than what got ingested.
const CODE_ALIASES: Record<string, string> = {
  URU: "URY", // Uruguay
  SUI: "CHE", // Switzerland
  NED: "NLD", // Netherlands
  GER: "DEU", // Germany
  CRO: "HRV", // Croatia
};

function normalizeCountryCode(code: string): string {
  const up = code.toUpperCase();
  return CODE_ALIASES[up] ?? up;
}

type JsonEntry = {
  name: string;
  country: string;
  wc_goals: number;
  wc_assists: number;
  wc_appearances: number;
  wc_tournaments: number;
};

async function main() {
  const raw = readFileSync(JSON_PATH, "utf-8");
  const parsed = JSON.parse(raw) as {
    _meta?: unknown;
    players: JsonEntry[];
  };
  console.log(`Read ${parsed.players.length} pedigree entries from ${JSON_PATH}`);

  const { db } = await import("../lib/db");
  const { wcPedigree } = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");

  await db.execute(sql`set pg_trgm.similarity_threshold = 0.4`);

  type Candidate = {
    real_player_id: string;
    full_name: string;
    similarity: number | string;
    country_code: string;
  };

  let matched = 0;
  const unmatched: JsonEntry[] = [];
  const ambiguous: Array<{ entry: JsonEntry; candidates: Candidate[] }> = [];

  for (const entry of parsed.players) {
    const code = normalizeCountryCode(entry.country);

    const candidates = (await db.execute(sql`
      select
        rp.id::text       as real_player_id,
        rp.full_name      as full_name,
        c.code            as country_code,
        similarity(lower(rp.full_name), lower(${entry.name})) as similarity
      from real_players rp
      join countries c on c.id = rp.country_id
      where c.code = ${code}
      order by similarity desc
      limit 3
    `)) as unknown as Candidate[];

    if (candidates.length === 0) {
      // Country not found OR no players in that country squad.
      unmatched.push(entry);
      console.warn(`  ✗ no candidates for ${entry.name} (${entry.country} → ${code})`);
      continue;
    }

    const best = candidates[0];
    const sim = Number(best.similarity);
    if (sim < 0.4) {
      unmatched.push(entry);
      console.warn(
        `  ✗ low sim ${sim.toFixed(2)} for ${entry.name} → best ${best.full_name}`
      );
      continue;
    }

    // Ambiguous: 2nd candidate within 0.1 of best — flag for manual review
    // but still take the best (usually correct).
    const second = candidates[1];
    if (second && Number(second.similarity) >= sim - 0.1 && Number(second.similarity) >= 0.4) {
      ambiguous.push({ entry, candidates });
    }

    await db
      .insert(wcPedigree)
      .values({
        realPlayerId: best.real_player_id,
        wcGoals: entry.wc_goals,
        wcAssists: entry.wc_assists,
        wcAppearances: entry.wc_appearances,
        wcTournaments: entry.wc_tournaments,
        source: "manual",
      })
      .onConflictDoUpdate({
        target: wcPedigree.realPlayerId,
        set: {
          wcGoals: entry.wc_goals,
          wcAssists: entry.wc_assists,
          wcAppearances: entry.wc_appearances,
          wcTournaments: entry.wc_tournaments,
          source: "manual",
          updatedAt: sql`now()`,
        },
      });
    matched++;
  }

  console.log(`\n=== Done ===`);
  console.log(`  matched:    ${matched}`);
  console.log(`  unmatched:  ${unmatched.length}`);
  console.log(`  ambiguous:  ${ambiguous.length} (auto-picked best, review if needed)`);
  if (ambiguous.length) {
    console.log("\nAmbiguous (top 2 within 0.1 similarity):");
    for (const a of ambiguous) {
      const lines = a.candidates
        .slice(0, 2)
        .map((c) => `      ${c.full_name} (sim ${Number(c.similarity).toFixed(2)})`)
        .join("\n");
      console.log(`  ${a.entry.name} (${a.entry.country}):\n${lines}`);
    }
  }
  if (unmatched.length) {
    console.log("\nUnmatched — these need a JSON name fix or aren't in 2026 squad:");
    for (const u of unmatched) console.log(`  - ${u.name} (${u.country})`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
