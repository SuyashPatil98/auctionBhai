/**
 * Set a profile's role to commissioner (or back to member).
 *
 * Commissioner can edit fixture stats, run admin panels, and otherwise
 * act on behalf of the league. Recommended: one commissioner per league.
 *
 * Usage:
 *   pnpm set:commissioner <email>           — promote
 *   pnpm set:commissioner <email> --revoke  — demote back to member
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"));
  if (!email) {
    console.error("usage: pnpm set:commissioner <email> [--revoke]");
    process.exit(2);
  }

  const { eq, sql } = await import("drizzle-orm");
  const { db } = await import("../lib/db");
  const { profiles } = await import("../lib/db/schema");

  // Look up the auth user by email via SQL — profiles table doesn't have email
  const rows = (await db.execute(
    sql`select id, email from auth.users where lower(email) = lower(${email}) limit 1`
  )) as unknown as Array<{ id: string; email: string }>;
  const u = rows[0];
  if (!u) {
    console.error(`no auth user found for ${email}`);
    process.exit(1);
  }

  const newRole = revoke ? "member" : "commissioner";
  await db
    .update(profiles)
    .set({ role: newRole })
    .where(eq(profiles.id, u.id));

  console.log(`✓ ${u.email} → role = ${newRole}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
