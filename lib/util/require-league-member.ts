import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leagueMembers, leagues } from "@/lib/db/schema";

/**
 * Defense-in-depth gate for write actions.
 *
 * The app's UI is open to any signed-in user (transparent / read-only),
 * but mutations require league membership. Without this, a stranger who
 * signs up at the public URL could edit fixture stats, cast MOTM votes,
 * or save lineups against someone else's roster.
 *
 * Throws if the user isn't in league_members for the active league.
 * Returns the league id on success (handy for downstream queries).
 */
export async function requireLeagueMember(profileId: string): Promise<string> {
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    throw new Error("no league configured yet");
  }
  const [member] = await db
    .select({ profileId: leagueMembers.profileId })
    .from(leagueMembers)
    .where(
      and(
        eq(leagueMembers.leagueId, league.id),
        eq(leagueMembers.profileId, profileId)
      )
    )
    .limit(1);
  if (!member) {
    throw new Error("not a league member");
  }
  return league.id;
}
