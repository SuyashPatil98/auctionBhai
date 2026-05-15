/**
 * Hard-deletes every auth.user + cascades to profiles + league_members,
 * then resets the draft / clears all auction state.
 *
 * Idempotent. Safe to run before a dry-run or before the real draft to
 * give your friends a clean slate.
 *
 * Reference data (tournaments, countries, real_players, ratings, prices,
 * TM/FBref staging) is preserved.
 *
 * Usage:  pnpm purge:users
 *         (asks for explicit "YES" on stdin so you don't fat-finger it)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import readline from "node:readline/promises";

async function confirm(): Promise<boolean> {
  if (process.argv.includes("--yes")) return true;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question(
    'Type "YES" to delete every auth user + reset the draft: '
  );
  rl.close();
  return answer.trim() === "YES";
}

async function main() {
  if (!(await confirm())) {
    console.log("aborted.");
    process.exit(0);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dbUrl = process.env.DATABASE_URL;
  if (!url || !serviceKey || !dbUrl) {
    throw new Error("env vars missing");
  }

  // 1. Reset auction state FIRST. auction_lots.nominated_by and
  //    auction_bids.profile_id are `on delete restrict`, so they'd block the
  //    cascade from auth.users → profiles. Clear them before deleting users.
  const sql = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    await sql`truncate table auction_bids, proxy_bids, auction_lots restart identity cascade`;
    await sql`truncate table manager_budgets`;
    await sql`truncate table rosters`;
    await sql`
      update drafts set
        status = 'scheduled',
        current_lot_id = null,
        current_nominator_profile_id = null,
        started_at = null,
        completed_at = null,
        paused_at = null,
        next_lot_number = 1
    `;
    console.log("Draft + auction state reset.");
  } finally {
    await sql.end();
  }

  // 2. Delete auth users via admin API. profiles + league_members cascade.
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let deleted = 0;
  let pageToken: string | undefined;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: pageToken ? Number(pageToken) : 1,
      perPage: 100,
    });
    if (error) throw error;
    if (!data.users.length) break;
    for (const u of data.users) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
      if (delErr) {
        console.warn(`  ! failed to delete ${u.email}: ${delErr.message}`);
        continue;
      }
      console.log(`  - deleted ${u.email}`);
      deleted++;
    }
    if (data.users.length < 100) break;
    pageToken = String((data.nextPage as unknown as number) ?? "");
    if (!pageToken) break;
  }
  console.log(`\nAuth users deleted: ${deleted}`);

  // 3. Clean any orphan league_members (profiles cascaded, this is belt-and-suspenders).
  const sql2 = postgres(dbUrl, { prepare: false, max: 1 });
  try {
    await sql2`delete from league_members where profile_id not in (select id from profiles)`;
  } finally {
    await sql2.end();
  }

  console.log("\n✓ Clean slate. Tell your friends to sign up.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
