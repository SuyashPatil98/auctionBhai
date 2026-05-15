/**
 * One-shot migration from the old Supabase project (Tokyo) to the new one
 * (Mumbai). Run this AFTER you've created the new project and run
 * `pnpm db:push` against it (to create the Drizzle-managed tables).
 *
 * Two-phase:
 *   1. Apply all hand-written SQL migrations (001..011) to the new DB —
 *      triggers, RLS, publications, extensions, replica identity bits that
 *      live outside Drizzle's schema management.
 *   2. Copy data table-by-table in FK-dependency order. Auth tables, history
 *      tables (ingestion_runs, audit_log), and per-profile data
 *      (profiles, league_members) are skipped — clean-slate signup.
 *
 * Usage (PowerShell):
 *   $env:OLD_DATABASE_URL = "postgresql://...tokyo..."
 *   $env:NEW_DATABASE_URL = "postgresql://...mumbai..."
 *   pnpm tsx scripts/migrate-to-new-db.ts
 *
 * Safe to re-run. Each table copy is wrapped in `on conflict do nothing` so
 * partial runs converge.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

// SQL migrations to apply in order. Idempotent (use `if not exists`).
const SQL_MIGRATIONS = [
  "001_profile_trigger.sql",
  "002_rating_extensions.sql",
  "003_transfermarkt_table.sql",
  "004_rating_tables.sql",
  "005_club_stats_and_gemini_cache.sql",
  "006_backfill_gemini_cache.sql",
  "007_country_sim_columns.sql",
  "008_auction_schema.sql",
  "009_enable_realtime.sql",
  "010_rosters_replica_identity.sql",
  "011_lot_passes_and_timers.sql",
];

// Tables to copy, in FK-safe order. Skip:
//   - profiles, league_members, auction_*  → clean slate; re-seeded after signup
//   - auth.users                           → different schema; signup is fresh
//   - ingestion_runs, audit_log, ai_*      → history; not load-bearing
//   - drafts                               → has FKs to profiles (current_nominator);
//                                            cleanly re-created by `pnpm seed:league`
const COPY_ORDER = [
  // Reference data
  "tournaments",
  "countries",
  "real_players",
  "fixtures",
  "transfermarkt_players",
  // Computed reference data
  "player_ratings",
  "player_prices",
  "player_club_stats",
  "gemini_research",
  // League shell — no FKs to profiles directly, safe to copy.
  "leagues",
];

async function applySqlMigrations(newSql: postgres.Sql) {
  console.log("\n=== Phase 1: SQL migrations ===");
  for (const file of SQL_MIGRATIONS) {
    const path = join(process.cwd(), "lib", "db", "sql", file);
    let body: string;
    try {
      body = readFileSync(path, "utf-8");
    } catch {
      console.log(`  skip ${file} (not found)`);
      continue;
    }
    process.stdout.write(`  applying ${file} ... `);
    try {
      await newSql.unsafe(body);
      console.log("ok");
    } catch (e: unknown) {
      const msg = (e as Error).message;
      console.log(`FAILED: ${msg}`);
      throw e;
    }
  }
}

async function tableExists(sql: postgres.Sql, table: string): Promise<boolean> {
  const rows = (await sql`
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = ${table}
  `) as unknown as Array<unknown>;
  return rows.length > 0;
}

async function copyTable(
  oldSql: postgres.Sql,
  newSql: postgres.Sql,
  table: string
) {
  if (!(await tableExists(oldSql, table))) {
    console.log(`  ${table}: not in old DB, skipping`);
    return;
  }
  if (!(await tableExists(newSql, table))) {
    console.log(
      `  ${table}: NOT IN NEW DB — did you run \`pnpm db:push\` first?`
    );
    throw new Error(`new DB missing table ${table}`);
  }

  // Get rows from old.
  const rows = (await oldSql.unsafe(
    `select * from public.${table}`
  )) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) {
    console.log(`  ${table}: 0 rows`);
    return;
  }

  // Bulk insert into new with `on conflict do nothing` so re-runs are safe.
  // postgres-js's helpers handle parameter binding correctly.
  const cols = Object.keys(rows[0]);
  const colList = cols.map((c) => `"${c}"`).join(", ");

  // Insert in chunks of 1000 to avoid hitting parameter limits.
  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const placeholders = chunk
      .map(
        (_, ri) =>
          "(" +
          cols.map((_, ci) => `$${ri * cols.length + ci + 1}`).join(", ") +
          ")"
      )
      .join(", ");
    const values = chunk.flatMap((r) =>
      cols.map((c) => r[c] as never)
    );
    await newSql.unsafe(
      `insert into public.${table} (${colList}) values ${placeholders} on conflict do nothing`,
      values
    );
    inserted += chunk.length;
    process.stdout.write(`\r  ${table}: ${inserted}/${rows.length}`);
  }
  console.log(`\r  ${table}: ${rows.length} rows copied                    `);
}

async function main() {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.NEW_DATABASE_URL;
  if (!oldUrl || !newUrl) {
    console.error(
      "Set OLD_DATABASE_URL and NEW_DATABASE_URL (PowerShell: $env:OLD_DATABASE_URL = '...')"
    );
    process.exit(2);
  }

  const oldSql = postgres(oldUrl, { prepare: false, max: 2 });
  const newSql = postgres(newUrl, { prepare: false, max: 2 });

  try {
    console.log("Source     :", oldUrl.replace(/:[^@]+@/, ":***@"));
    console.log("Destination:", newUrl.replace(/:[^@]+@/, ":***@"));

    await applySqlMigrations(newSql);

    console.log("\n=== Phase 2: data copy ===");
    for (const table of COPY_ORDER) {
      await copyTable(oldSql, newSql, table);
    }

    console.log("\n=== Done ===");
    console.log("Next steps:");
    console.log("  1. Update .env.local: NEXT_PUBLIC_SUPABASE_URL,");
    console.log("     NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,");
    console.log("     DATABASE_URL → all point at the NEW (Mumbai) project.");
    console.log("  2. Verify locally: pnpm dev → /api/health");
    console.log("  3. Update Vercel env vars + redeploy.");
    console.log("  4. Supabase NEW project → Auth → URL Configuration:");
    console.log("     Site URL + Redirect URLs = your Vercel domain.");
  } finally {
    await oldSql.end();
    await newSql.end();
  }
}

main().catch((err) => {
  console.error("\nMIGRATION FAILED:", err);
  process.exit(1);
});
