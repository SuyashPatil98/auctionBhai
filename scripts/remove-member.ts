/**
 * Remove a league member by email.
 *
 * Useful when someone signed up but can't make the draft. Their auth
 * user + profile row are LEFT INTACT — only the league_members link is
 * removed. They can be added back later via `pnpm seed:league` once
 * they're ready.
 *
 * Refuses to run if the draft is past 'scheduled' (live / paused / complete)
 * because removing a member mid-draft would corrupt the budget + roster
 * state.
 *
 * Usage:
 *   pnpm tsx scripts/remove-member.ts <email>
 *   pnpm tsx scripts/remove-member.ts foo@example.com bar@example.com   (multiple)
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";

async function main() {
  const emails = process.argv.slice(2);
  if (emails.length === 0) {
    console.error("usage: pnpm tsx scripts/remove-member.ts <email> [email2 ...]");
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    // Refuse if draft already started.
    const [draft] = await sql<Array<{ status: string }>>`
      select status from drafts limit 1
    `;
    if (draft && draft.status !== "scheduled") {
      console.error(
        `draft is ${draft.status} — refusing. Reset it from /draft/admin first if you really need to.`
      );
      process.exit(1);
    }

    for (const email of emails) {
      const lookup = await sql<
        Array<{ id: string; display_name: string }>
      >`
        select p.id, p.display_name
        from profiles p
        join auth.users u on u.id = p.id
        where u.email = ${email}
        limit 1
      `;
      if (lookup.length === 0) {
        console.warn(`  ! no profile found for ${email}, skipping`);
        continue;
      }
      const profile = lookup[0];
      const result = await sql`
        delete from league_members where profile_id = ${profile.id}
      `;
      console.log(
        `  - removed ${profile.display_name} (${email}) from league_members  (${result.count} row${result.count === 1 ? "" : "s"})`
      );
    }

    // Print remaining members for sanity.
    const remaining = await sql<
      Array<{ display_name: string; email: string; nomination_order: number }>
    >`
      select p.display_name,
             u.email,
             lm.nomination_order
      from league_members lm
      join profiles p on p.id = lm.profile_id
      join auth.users u on u.id = p.id
      order by lm.nomination_order
    `;
    console.log(`\nRemaining league members (${remaining.length}):`);
    for (const m of remaining) {
      console.log(`  #${m.nomination_order}  ${m.display_name}  ${m.email}`);
    }

    console.log(
      "\nTo undo: have them sign back up, then `pnpm seed:league` adds them as a new member."
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
