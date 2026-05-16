import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

/**
 * Fetch the signed-in user's pinned timezone (IANA), or null if they
 * haven't pinned one (in which case Kickoff falls back to the browser's
 * detected timezone). Returns null for unauthenticated visitors rather
 * than throwing — callers SSR'ing public-ish pages don't need to branch.
 */
export async function getCurrentProfileTimezone(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [row] = await db
    .select({ timezone: profiles.timezone })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  return row?.timezone ?? null;
}
