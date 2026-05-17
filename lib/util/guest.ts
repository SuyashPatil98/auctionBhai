import "server-only";
import { createClient } from "@/lib/supabase/server";
import { GUEST_EMAIL, GUEST_PASSWORD } from "./guest-constants";

/**
 * Shared "view as guest" account.
 *
 * Anyone visiting auction-bhai.vercel.app can click "View as Guest" on
 * /login → server signs them in with these credentials → they're now
 * authenticated as the guest user.
 *
 * The guest user is intentionally NOT in league_members. Every
 * mutation server action gates on requireLeagueMember(), so the guest
 * can SEE everything (dashboard, draft, fixtures, leaderboard, trades)
 * but can't bid, save lineups, vote MOTM, trade, sell, edit profile.
 *
 * Constants live in ./guest-constants so they're importable from
 * non-Next.js scripts (the seeder).
 */

export { GUEST_EMAIL, GUEST_PASSWORD };

export async function isCurrentUserGuest(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email === GUEST_EMAIL;
}
