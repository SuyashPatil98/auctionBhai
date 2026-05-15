/**
 * Imports a FBref Big-5-leagues season CSV (from the
 * hubertsidorowicz/football-players-stats-2025-2026 Kaggle dataset) into
 * player_club_stats, matching each row against our real_players via
 * pg_trgm name similarity + Born-year confirmation.
 *
 * Expected at: lib/data/fbref_25_26.csv (renamed from whatever Kaggle gave).
 *
 * Usage: pnpm import:fbref
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

const CSV_PATH = "lib/data/fbref_25_26.csv";
const SEASON = "2025-2026";
const SOURCE = "fbref";

function toIntOrNull(v: string | undefined | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toFloatOrNull(v: string | undefined | null): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function toFixed2OrNull(v: number | null): string | null {
  return v === null ? null : v.toFixed(2);
}

type FbRow = Record<string, string>;

async function main() {
  console.log(`Reading ${CSV_PATH}...`);
  const csv = readFileSync(CSV_PATH, "utf-8");
  const rows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as FbRow[];
  console.log(`  ${rows.length} rows parsed`);

  const { db } = await import("../lib/db");
  const { playerClubStats } = await import("../lib/db/schema");
  const { sql } = await import("drizzle-orm");

  // Trigram threshold for match acceptance.
  await db.execute(sql`set pg_trgm.similarity_threshold = 0.5`);

  type Candidate = {
    real_player_id: string;
    name: string;
    born: number | null;
    similarity: number | string;
  };

  // Match each FBref row to one real_player via trigram + Born year.
  // We do them in parallel batches to keep the wall time reasonable.
  const BATCH = 25;
  let matched = 0;
  let skipped = 0;
  const records: Array<{
    realPlayerId: string;
    matchConfidence: "high" | "medium" | "low";
    fbrefRow: FbRow;
  }> = [];

  console.log("Matching FBref rows to real_players...");
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const lookups = await Promise.all(
      batch.map(async (row) => {
        const name = row["Player"]?.trim();
        if (!name) return null;
        const born = toIntOrNull(row["Born"]);

        const res = (await db.execute(sql`
          select
            id::text       as real_player_id,
            full_name      as name,
            extract(year from dob)::int as born,
            similarity(lower(full_name), lower(${name})) as similarity
          from real_players
          where lower(full_name) % lower(${name})
          order by
            (case when extract(year from dob) = ${born} then 0 else 1 end),
            similarity(lower(full_name), lower(${name})) desc
          limit 1
        `)) as unknown as Candidate[];

        const best = res[0];
        if (!best || !best.real_player_id) return null;

        const sim = Number(best.similarity);
        const yearMatch = born !== null && best.born === born;

        let confidence: "high" | "medium" | "low";
        if (yearMatch && sim >= 0.7) confidence = "high";
        else if (sim >= 0.9) confidence = "high";
        else if (sim >= 0.7) confidence = "medium";
        else if (sim >= 0.5) confidence = "low";
        else return null;

        return { realPlayerId: best.real_player_id, confidence, row };
      })
    );

    for (const r of lookups) {
      if (!r) {
        skipped++;
        continue;
      }
      records.push({
        realPlayerId: r.realPlayerId,
        matchConfidence: r.confidence,
        fbrefRow: r.row,
      });
      matched++;
    }
    process.stdout.write(
      `\r  processed ${Math.min(i + BATCH, rows.length)}/${rows.length} · matched ${matched} · skipped ${skipped}`
    );
  }
  process.stdout.write("\n");

  // De-duplicate: if multiple FBref rows match the same real_player_id
  // (a transfer mid-season splits a player across two club rows), keep
  // the row with the most minutes — it's the bigger sample.
  const byPlayer = new Map<string, (typeof records)[number]>();
  for (const r of records) {
    const existing = byPlayer.get(r.realPlayerId);
    const newMin = toIntOrNull(r.fbrefRow["Min"]) ?? 0;
    const existingMin = existing
      ? toIntOrNull(existing.fbrefRow["Min"]) ?? 0
      : -1;
    if (!existing || newMin > existingMin) {
      byPlayer.set(r.realPlayerId, r);
    }
  }
  console.log(`  deduped to ${byPlayer.size} unique players`);

  // Wipe previous FBref rows for this season to keep idempotency simple.
  console.log("Clearing previous FBref rows for season...");
  await db.execute(sql`
    delete from player_club_stats
    where source = ${SOURCE} and season = ${SEASON}
  `);

  // Bulk insert.
  console.log("Inserting player_club_stats...");
  const toInsert = [...byPlayer.values()].map(
    ({ realPlayerId, matchConfidence, fbrefRow }) => {
      const minutes = toIntOrNull(fbrefRow["Min"]);
      const nineties = toFloatOrNull(fbrefRow["90s"]) ?? 0;
      const goals = toIntOrNull(fbrefRow["Gls"]);
      const assists = toIntOrNull(fbrefRow["Ast"]);
      const xg = toFloatOrNull(fbrefRow["xG"]);
      const xag = toFloatOrNull(fbrefRow["xAG"]);
      const npxg = toFloatOrNull(fbrefRow["npxG"]);

      const goalsPer90 =
        goals !== null && nineties > 0 ? goals / nineties : null;
      const assistsPer90 =
        assists !== null && nineties > 0 ? assists / nineties : null;
      const xgPer90 = xg !== null && nineties > 0 ? xg / nineties : null;
      const xagPer90 = xag !== null && nineties > 0 ? xag / nineties : null;

      // Pack the misc + GK + shooting + playing-time stats into raw so
      // the UI can read them by position without exploding our schema.
      const raw = {
        nation: fbrefRow["Nation"] ?? null,
        pos: fbrefRow["Pos"] ?? null,
        age: toFloatOrNull(fbrefRow["Age"]),
        born: toIntOrNull(fbrefRow["Born"]),
        shooting: {
          shots: toIntOrNull(fbrefRow["Sh"]),
          shotsOnTarget: toIntOrNull(fbrefRow["SoT"]),
          shotsOnTargetPct: toFloatOrNull(fbrefRow["SoT%"]),
          shotsPer90: toFloatOrNull(fbrefRow["Sh/90"]),
          shotsOnTargetPer90: toFloatOrNull(fbrefRow["SoT/90"]),
          goalsPerShot: toFloatOrNull(fbrefRow["G/Sh"]),
          goalsPerShotOnTarget: toFloatOrNull(fbrefRow["G/SoT"]),
        },
        keeper: {
          goalsAgainst: toIntOrNull(fbrefRow["GA"]),
          goalsAgainstPer90: toFloatOrNull(fbrefRow["GA90"]),
          shotsOnTargetAgainst: toIntOrNull(fbrefRow["SoTA"]),
          saves: toIntOrNull(fbrefRow["Saves"]),
          savePct: toFloatOrNull(fbrefRow["Save%"]),
          cleanSheets: toIntOrNull(fbrefRow["CS"]),
          cleanSheetPct: toFloatOrNull(fbrefRow["CS%"]),
          pensSaved: toIntOrNull(fbrefRow["PKsv"]),
          pensMissed: toIntOrNull(fbrefRow["PKm"]),
        },
        misc: {
          tacklesWon: toIntOrNull(fbrefRow["TklW"]),
          interceptions: toIntOrNull(fbrefRow["Int"]),
          crosses: toIntOrNull(fbrefRow["Crs"]),
          offsides: toIntOrNull(fbrefRow["Off"]),
          fouls: toIntOrNull(fbrefRow["Fls"]),
          fouled: toIntOrNull(fbrefRow["Fld"]),
          ownGoals: toIntOrNull(fbrefRow["OG"]),
        },
        playingTime: {
          minutesPerMatch: toFloatOrNull(fbrefRow["Mn/MP"]),
          minutesPct: toFloatOrNull(fbrefRow["Min%"]),
          complete: toIntOrNull(fbrefRow["Compl"]),
          subs: toIntOrNull(fbrefRow["Subs"]),
          pointsPerMatch: toFloatOrNull(fbrefRow["PPM"]),
        },
      };

      return {
        realPlayerId,
        source: SOURCE,
        season: SEASON,
        competition: fbrefRow["Comp"] ?? null,
        squad: fbrefRow["Squad"] ?? null,
        matchesPlayed: toIntOrNull(fbrefRow["MP"]),
        starts: toIntOrNull(fbrefRow["Starts"]),
        minutes,
        goals,
        assists,
        nonPenaltyGoals: toIntOrNull(fbrefRow["G-PK"]),
        penalties: toIntOrNull(fbrefRow["PK"]),
        penaltyAttempts: toIntOrNull(fbrefRow["PKatt"]),
        xg: toFixed2OrNull(xg),
        xag: toFixed2OrNull(xag),
        npxg: toFixed2OrNull(npxg),
        goalsPer90: toFixed2OrNull(goalsPer90),
        assistsPer90: toFixed2OrNull(assistsPer90),
        xgPer90: toFixed2OrNull(xgPer90),
        xagPer90: toFixed2OrNull(xagPer90),
        yellowCards: toIntOrNull(fbrefRow["CrdY"]),
        redCards: toIntOrNull(fbrefRow["CrdR"]),
        // Defensive
        tackles: toIntOrNull(fbrefRow["Tkl"]),
        tacklesWon: toIntOrNull(fbrefRow["TklW"]),
        interceptions: toIntOrNull(fbrefRow["Int"]),
        blocks: toIntOrNull(fbrefRow["Blocks"]),
        clearances: toIntOrNull(fbrefRow["Clr"]),
        errors: toIntOrNull(fbrefRow["Err"]),
        recoveries: toIntOrNull(fbrefRow["Recov"]),
        // Passing / creativity. Hubertsidorowicz uses a suffixed column
        // name for pass completion to disambiguate from other Cmp% fields.
        keyPasses: toIntOrNull(fbrefRow["KP"]),
        progressivePasses: toIntOrNull(fbrefRow["PrgP"]),
        progressiveCarries: toIntOrNull(fbrefRow["PrgC"]),
        passCompletionPct: toFixed2OrNull(
          toFloatOrNull(
            fbrefRow["Cmp%_stats_passing"] ?? fbrefRow["Cmp%"] ?? null
          )
        ),
        expectedAssists: toFixed2OrNull(toFloatOrNull(fbrefRow["xA"])),
        passesIntoBox: toIntOrNull(fbrefRow["PPA"]),
        // Possession
        touches: toIntOrNull(fbrefRow["Touches"]),
        carries: toIntOrNull(fbrefRow["Carries"]),
        progressiveRuns: toIntOrNull(fbrefRow["PrgR"]),
        miscontrols: toIntOrNull(fbrefRow["Mis"]),
        dispossessed: toIntOrNull(fbrefRow["Dis"]),
        // Goalkeeping
        goalsAgainst: toIntOrNull(fbrefRow["GA"]),
        saves: toIntOrNull(fbrefRow["Saves"]),
        savePct: toFixed2OrNull(toFloatOrNull(fbrefRow["Save%"])),
        cleanSheets: toIntOrNull(fbrefRow["CS"]),
        cleanSheetPct: toFixed2OrNull(toFloatOrNull(fbrefRow["CS%"])),
        penaltiesFaced: toIntOrNull(fbrefRow["PKA"]),
        penaltySaves: toIntOrNull(fbrefRow["PKsv"]),
        // Provenance
        matchConfidence,
        fbrefName: fbrefRow["Player"]?.trim() ?? null,
        raw,
      };
    }
  );

  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await db.insert(playerClubStats).values(toInsert.slice(i, i + CHUNK));
    inserted += Math.min(CHUNK, toInsert.length - i);
    process.stdout.write(`\r  inserted ${inserted}/${toInsert.length}`);
  }
  process.stdout.write("\n");

  const confidenceCounts = [...byPlayer.values()].reduce(
    (acc, r) => {
      acc[r.matchConfidence] = (acc[r.matchConfidence] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log("\nDone.");
  console.log(`  FBref rows read:      ${rows.length}`);
  console.log(`  Matched to real_player: ${matched}`);
  console.log(`  Unique players:       ${byPlayer.size}`);
  console.log(`  Skipped (no match):   ${skipped}`);
  console.log(`  Confidence:`, confidenceCounts);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
