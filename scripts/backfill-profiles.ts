/**
 * Backfills public.profiles rows for auth.users who don't have one yet.
 * Uses email prefix as display_name / handle when no user_metadata is set.
 *
 * Idempotent — ON CONFLICT skips users who already have a profile.
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
    const before = await sql`select count(*)::int as n from public.profiles`;
    console.log(`Profiles before: ${before[0].n}`);

    await sql`
      insert into public.profiles (id, handle, display_name, team_name, team_emoji)
      select
        u.id,
        coalesce(nullif(u.raw_user_meta_data->>'handle', ''), split_part(u.email, '@', 1)),
        coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), split_part(u.email, '@', 1)),
        nullif(u.raw_user_meta_data->>'team_name', ''),
        nullif(u.raw_user_meta_data->>'team_emoji', '')
      from auth.users u
      left join public.profiles p on p.id = u.id
      where p.id is null
      on conflict (id) do nothing;
    `;

    const after = await sql`select count(*)::int as n from public.profiles`;
    console.log(`Profiles after:  ${after[0].n}`);
    console.log(`Backfilled: ${after[0].n - before[0].n}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
