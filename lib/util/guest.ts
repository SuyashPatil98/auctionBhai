import "server-only";
import { createClient } from "@/lib/supabase/server";

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
 * Credentials are PUBLIC by design — they're not a secret. The seed
 * script creates the user with these exact values; the login action
 * signs in with them.
 */

export const GUEST_EMAIL = "guest@auction-bhai.demo";
export const GUEST_PASSWORD = "guest-view-only-9d3f81";

export async function isCurrentUserGuest(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email === GUEST_EMAIL;
}
