/**
 * One-shot: create the shared "View as Guest" Supabase user.
 *
 * Anyone who clicks "View as Guest" on /login is signed in as this
 * account. The guest is intentionally NOT added to league_members, so
 * the existing requireLeagueMember() gate on every mutation server
 * action makes them read-only by construction.
 *
 * Idempotent — re-running this script re-applies the password if the
 * user already exists.
 *
 * Usage:
 *   pnpm seed:guest
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { eq } = await import("drizzle-orm");
  const { db } = await import("../lib/db");
  const { profiles, leagueMembers, leagues } = await import("../lib/db/schema");
  const { GUEST_EMAIL, GUEST_PASSWORD } = await import("../lib/util/guest-constants");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required"
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Look up or create the auth user
  const { data: list } = await supabase.auth.admin.listUsers();
  const existing = list?.users.find((u) => u.email === GUEST_EMAIL);
  let userId: string;

  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, {
      password: GUEST_PASSWORD,
      email_confirm: true,
    });
    userId = existing.id;
    console.log(`✓ Guest user already exists (${userId.slice(0, 8)}) — password reset`);
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: GUEST_EMAIL,
      password: GUEST_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: "Guest viewer" },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    userId = data.user.id;
    console.log(`✓ Created guest user (${userId.slice(0, 8)})`);
  }

  // Upsert profile row
  await db
    .insert(profiles)
    .values({
      id: userId,
      handle: "guest",
      displayName: "Guest viewer",
      teamName: null,
      teamEmoji: "👁",
      role: "member",
    })
    .onConflictDoUpdate({
      target: profiles.id,
      set: {
        handle: "guest",
        displayName: "Guest viewer",
        teamEmoji: "👁",
      },
    });
  console.log(`✓ Profile row in place`);

  // CRITICAL: ensure guest is NOT in league_members
  const [league] = await db.select().from(leagues).limit(1);
  if (league) {
    const removed = await db
      .delete(leagueMembers)
      .where(eq(leagueMembers.profileId, userId))
      .returning({ id: leagueMembers.profileId });
    if (removed.length > 0) {
      console.log(`✓ Removed guest from league_members (was a member by accident)`);
    } else {
      console.log(`✓ Guest is not in league_members — read-only by construction`);
    }
  }

  console.log("\nDone. The 'View as Guest' button on /login now works.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
