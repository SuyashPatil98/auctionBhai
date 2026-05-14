/**
 * Diagnostic: list every auth.user + matching public.profiles row.
 * If you signed up but don't see a profile here, the trigger didn't
 * fire (or you signed up before it existed).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const rows = await sql`
      select
        u.id::text as user_id,
        u.email,
        u.created_at as user_created,
        u.raw_user_meta_data::text as metadata,
        p.handle,
        p.display_name,
        p.team_name,
        p.team_emoji
      from auth.users u
      left join public.profiles p on p.id = u.id
      order by u.created_at asc;
    `;

    console.log(`\n${rows.length} auth user(s):\n`);
    for (const r of rows) {
      console.log(`  ${r.email}`);
      console.log(`    id:           ${r.user_id}`);
      console.log(`    created:      ${r.user_created}`);
      console.log(`    has profile:  ${r.handle ? "yes" : "NO ⚠"}`);
      if (r.handle) {
        console.log(`    display:      ${r.display_name}`);
        console.log(`    team:         ${r.team_name ?? "(none)"} ${r.team_emoji ?? ""}`);
      } else {
        console.log(`    metadata:     ${r.metadata}`);
      }
      console.log();
    }

    const members = await sql`
      select p.display_name, lm.nomination_order
      from public.league_members lm
      join public.profiles p on p.id = lm.profile_id
      order by lm.nomination_order;
    `;
    console.log(`League members (${members.length}):`);
    for (const m of members) {
      console.log(`  #${m.nomination_order}  ${m.display_name}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
