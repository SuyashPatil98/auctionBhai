/**
 * Applies a hand-written SQL file via the postgres driver, bypassing
 * drizzle-kit's TUI confirmation prompt. Use for:
 *   - cross-schema migrations (auth schema triggers, extensions)
 *   - one-off table additions during dev
 *
 * Usage: pnpm exec tsx scripts/apply-sql.ts <path/to/file.sql>
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { readFileSync } from "node:fs";
import postgres from "postgres";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: tsx scripts/apply-sql.ts <file.sql>");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const sql = readFileSync(path, "utf-8");
  console.log(`Applying ${path}...`);

  const client = postgres(url, { prepare: false, max: 1 });
  try {
    await client.unsafe(sql);
    console.log("  ok");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
