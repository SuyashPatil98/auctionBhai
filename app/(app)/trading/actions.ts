"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  drafts,
  fixtures,
  leagues,
  managerBudgets,
  managerLineups,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireLeagueMember } from "@/lib/util/require-league-member";
import {
  assertTradingAllowed,
  computeWindowState,
} from "@/lib/trading/window";

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

async function loadWindowState() {
  const [knockoutFx] = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.stage, "r32"))
    .orderBy(asc(fixtures.kickoffAt))
    .limit(1);
  return computeWindowState(
    Date.now(),
    knockoutFx?.kickoffAt ? knockoutFx.kickoffAt.getTime() : null
  );
}

// ----------------------------------------------------------------------------
// Sell a player to the market
// ----------------------------------------------------------------------------
//
// Effect:
//   1. Roster row droppedAt = now() — player goes back into the FA pool
//   2. Manager budget.spent decreases by refund (50% of acquiredAmount)
//   3. Manager budget.slotsFilled decreases by 1
//   4. Player removed from any future manager_lineups (current MD onward)
//   5. Audit log entry
//
// Refusals:
//   - Outside trading window
//   - Knockout cutoff passed
//   - You don't own this player (or it's already dropped)
//   - Sold player wasn't auction-acquired (free-agent picks fall through —
//     they refund the bid amount they cost, see acquiredAmount column)

export type SellResult = {
  realPlayerId: string;
  refund: number;
  newSpent: number;
  newSlotsFilled: number;
};

export async function sellPlayer(realPlayerId: string): Promise<SellResult> {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);
  assertTradingAllowed(await loadWindowState());

  if (!realPlayerId) throw new Error("realPlayerId required");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");

  // Atomic-ish: a serializable transaction so concurrent sells/buys on the
  // same row don't race.
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(rosters)
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, profileId),
          eq(rosters.realPlayerId, realPlayerId),
          isNull(rosters.droppedAt)
        )
      )
      .limit(1);
    if (!row) {
      throw new Error("you don't own this player (or it was already sold)");
    }

    const acquired = row.acquiredAmount ?? 0;
    const refund = Math.floor(acquired / 2);

    // Drop the roster row
    await tx
      .update(rosters)
      .set({ droppedAt: new Date() })
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, profileId),
          eq(rosters.realPlayerId, realPlayerId),
          isNull(rosters.droppedAt)
        )
      );

    // Decrement budget — find the draft row
    const [draft] = await tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(eq(drafts.leagueId, league.id))
      .limit(1);
    if (!draft) throw new Error("no draft");

    const [budget] = await tx
      .select()
      .from(managerBudgets)
      .where(
        and(
          eq(managerBudgets.draftId, draft.id),
          eq(managerBudgets.profileId, profileId)
        )
      )
      .limit(1);
    const newSpent = Math.max(0, (budget?.spent ?? 0) - refund);
    const newSlotsFilled = Math.max(0, (budget?.slotsFilled ?? 0) - 1);
    await tx
      .update(managerBudgets)
      .set({
        spent: newSpent,
        slotsFilled: newSlotsFilled,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(managerBudgets.draftId, draft.id),
          eq(managerBudgets.profileId, profileId)
        )
      );

    // Scrub from future manager_lineups (current matchday onward).
    // We don't know the "current MD" with certainty, so wipe every lineup
    // the manager has set that's not yet locked. lockedAt is stamped when
    // -6h passes, so non-locked = future-editable.
    const futureLineups = await tx
      .select()
      .from(managerLineups)
      .where(
        and(
          eq(managerLineups.profileId, profileId),
          isNull(managerLineups.lockedAt)
        )
      );
    for (const ln of futureLineups) {
      const newStarters = ln.starterIds.filter((id) => id !== realPlayerId);
      const newBench = ln.benchIds.map((id) =>
        id === realPlayerId ? "" : id
      );
      const newCaptain =
        ln.captainId === realPlayerId ? newStarters[0] ?? "" : ln.captainId;
      const newVice =
        ln.viceId === realPlayerId ? newStarters[1] ?? "" : ln.viceId;
      if (
        newStarters.length !== ln.starterIds.length ||
        newBench.some((id, i) => id !== ln.benchIds[i]) ||
        newCaptain !== ln.captainId ||
        newVice !== ln.viceId
      ) {
        await tx
          .update(managerLineups)
          .set({
            starterIds: newStarters,
            benchIds: newBench,
            captainId: newCaptain,
            viceId: newVice,
            updatedAt: new Date(),
          })
          .where(eq(managerLineups.id, ln.id));
      }
    }

    await tx.insert(auditLog).values({
      actorProfileId: profileId,
      action: "trading.sell",
      entity: "rosters",
      entityId: realPlayerId,
      before: { acquiredAmount: acquired, spent: budget?.spent ?? 0 },
      after: { refund, newSpent, newSlotsFilled },
    });

    return {
      realPlayerId,
      refund,
      newSpent,
      newSlotsFilled,
    };
  }).then(async (result) => {
    revalidatePath("/trading");
    revalidatePath("/team");
    revalidatePath("/dashboard");
    return result;
  });
}
