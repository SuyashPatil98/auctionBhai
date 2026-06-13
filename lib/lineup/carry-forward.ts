/**
 * Automatic lineup carry-forward.
 *
 * Once matchday N has locked (6h before its first kickoff), any manager who
 * hasn't set a lineup for N inherits a copy of their most recent prior lineup
 * (matchday < N). Managers with no prior lineup are left unscored (they score
 * 0) — by design, per the league's "carry forward last lineup only" rule.
 *
 * Why this exists: `autoFillFromPriorMatchday` is only wired to a manual button
 * in the lineup builder, so without this nothing carried forward automatically
 * and managers who didn't touch their lineup scored 0 every matchday.
 *
 * Idempotent (onConflictDoNothing) and safe to call from the cron, the scoring
 * sweep, or anywhere server-side — no auth, no revalidatePath. Only fires after
 * lock so managers keep full control until then.
 */

import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fixtures,
  leagueMembers,
  leagues,
  managerLineups,
} from "@/lib/db/schema";
import { computeLockTime, isLocked } from "./lock";

export async function autoFillCarryForward(
  matchday: number
): Promise<{ filled: number }> {
  // Gate: only after this matchday has locked. Before lock, managers may still
  // set their own — we don't want to plant a stale copy underneath them.
  const mdFixtures = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.matchday, matchday));
  if (!isLocked(computeLockTime(mdFixtures))) return { filled: 0 };

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) return { filled: 0 };

  const members = await db
    .select({ profileId: leagueMembers.profileId })
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, league.id));

  const existing = await db
    .select({ profileId: managerLineups.profileId })
    .from(managerLineups)
    .where(eq(managerLineups.matchday, matchday));
  const have = new Set(existing.map((e) => e.profileId));

  let filled = 0;
  for (const m of members) {
    if (have.has(m.profileId)) continue;

    const [prior] = await db
      .select()
      .from(managerLineups)
      .where(
        and(
          eq(managerLineups.profileId, m.profileId),
          sql`${managerLineups.matchday} < ${matchday}`
        )
      )
      .orderBy(desc(managerLineups.matchday))
      .limit(1);
    if (!prior) continue; // nothing to carry — manager stays unscored

    const res = await db
      .insert(managerLineups)
      .values({
        profileId: m.profileId,
        matchday,
        formation: prior.formation,
        starterIds: prior.starterIds,
        benchIds: prior.benchIds,
        captainId: prior.captainId,
        viceId: prior.viceId,
        isAutoFilled: true,
        lockedAt: new Date(), // the matchday is already locked
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [managerLineups.profileId, managerLineups.matchday],
      })
      .returning({ id: managerLineups.id });
    if (res.length > 0) filled++;
  }

  return { filled };
}

/**
 * Carry forward every matchday that has already locked. Cheap + idempotent —
 * called by the cron so carried lineups appear at lock, before any stats land.
 */
export async function carryForwardLockedMatchdays(): Promise<{
  matchdaysFilled: number;
  filled: number;
}> {
  const mds = (await db.execute(
    sql`select distinct matchday from fixtures order by matchday`
  )) as unknown as Array<{ matchday: number }>;

  let filled = 0;
  let matchdaysFilled = 0;
  for (const { matchday } of mds) {
    const r = await autoFillCarryForward(matchday);
    filled += r.filled;
    if (r.filled > 0) matchdaysFilled++;
  }
  return { matchdaysFilled, filled };
}
