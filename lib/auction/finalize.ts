import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auctionLots, drafts, leagueMembers, managerBudgets } from "@/lib/db/schema";
import { nextNominator } from "@/lib/auction/state";

/**
 * Pure DB transaction: finalize any open/closing lots past closes_at, advance
 * the nominator, mark the draft complete if everyone is full.
 *
 * Returns whether anything changed (so callers in mutation contexts know if
 * they should revalidatePath; page renders just re-read state and don't need
 * a revalidation hop).
 *
 * Safe to call from server components — does not invoke revalidatePath itself.
 */
export async function finalizeExpiredLots(draftId: string): Promise<{ changed: boolean }> {
  return await db.transaction(async (tx) => {
    const expired = (await tx.execute(sql`
      select id, draft_id, current_bidder_id, current_bid
      from auction_lots
      where draft_id = ${draftId}
        and status in ('open','closing')
        and closes_at is not null
        and closes_at < now()
      for update
    `)) as unknown as Array<{
      id: string;
      draft_id: string;
      current_bidder_id: string | null;
      current_bid: number;
    }>;

    if (expired.length === 0) return { changed: false };

    for (const lot of expired) {
      if (lot.current_bidder_id) {
        await tx
          .update(auctionLots)
          .set({ status: "sold", soldAt: new Date() })
          .where(eq(auctionLots.id, lot.id));
      } else {
        await tx
          .update(auctionLots)
          .set({ status: "passed" })
          .where(eq(auctionLots.id, lot.id));
      }
    }

    const [d] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, draftId))
      .limit(1);
    if (!d) return { changed: true };

    const members = await tx
      .select()
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, d.leagueId));

    const budgets = await tx
      .select()
      .from(managerBudgets)
      .where(eq(managerBudgets.draftId, d.id));
    const slotsFilledByProfile = new Map(
      budgets.map((b) => [b.profileId, b.slotsFilled])
    );

    const next = nextNominator({
      members: members.map((m) => ({
        profileId: m.profileId,
        nominationOrder: m.nominationOrder,
      })),
      slotsFilledByProfile,
      rosterSize: d.rosterSize,
      previousNominatorId: d.currentNominatorProfileId,
    });

    if (next === null) {
      await tx
        .update(drafts)
        .set({ status: "complete", completedAt: new Date(), currentLotId: null })
        .where(eq(drafts.id, d.id));
    } else {
      await tx
        .update(drafts)
        .set({
          currentNominatorProfileId: next,
          currentLotId: null,
        })
        .where(eq(drafts.id, d.id));
    }

    return { changed: true };
  });
}
