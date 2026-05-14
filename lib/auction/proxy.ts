/**
 * Proxy bid resolution.
 *
 * Each manager can set a `max_amount` per lot. When new bids land, the
 * system places bids on behalf of proxy-holders up to their max, but only
 * the minimum required to stay top of the lot.
 *
 * Resolution algorithm (run inside a transaction after every accepted bid
 * or proxy update):
 *
 *   loop:
 *     load lot.current_bid, lot.current_bidder_id
 *     load all proxies on this lot where max > current_bid + min_increment
 *       and profile_id != current_bidder_id
 *     if none → break
 *     sort by max desc
 *     top_proxy = first
 *     second_max = second?.max_amount ?? 0
 *     # bid the smaller of (top's max) and (second-place's max + min_inc)
 *     #   but at least current_bid + min_inc
 *     target = max(
 *       current_bid + min_inc,
 *       min(top_proxy.max, second_max + min_inc)
 *     )
 *     if target > top_proxy.max → break (can't outbid)
 *     place proxy-generated bid for top_proxy at `target`
 *     (re-loop in case other proxies want to keep going)
 *
 * Convergence: each iteration strictly increases current_bid, so the loop
 * is bounded by max_amount of the highest proxy.
 */

import { and, eq, gt, ne, sql } from "drizzle-orm";
import {
  auctionBids,
  auctionLots,
  drafts,
  managerBudgets,
  proxyBids,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { count } from "drizzle-orm";
import { maxBidNow, nextIncrement, newClosesAt } from "./state";
import type { db as _Db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof _Db.transaction>[0]>[0];

const MAX_ITERATIONS = 100; // safety against pathological proxy ladders

/**
 * Run proxy resolution against the given lot. Caller already holds the lot
 * row FOR UPDATE within `tx`. Mutates auction_lots, inserts auction_bids.
 */
export async function resolveProxiesOnLot(
  tx: Tx,
  lotId: string
): Promise<{ proxyBidsPlaced: number }> {
  let placed = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Re-read the lot (state may have changed in last iteration).
    const lotRows = (await tx.execute(sql`
      select id, draft_id, real_player_id, current_bid,
        current_bidder_id, status, closes_at
      from auction_lots
      where id = ${lotId}
      for update
    `)) as unknown as Array<{
      id: string;
      draft_id: string;
      real_player_id: string;
      current_bid: number;
      current_bidder_id: string | null;
      status: string;
      closes_at: string | null;
    }>;
    const lot = lotRows[0];
    if (!lot) return { proxyBidsPlaced: placed };
    if (lot.status !== "open" && lot.status !== "closing") {
      return { proxyBidsPlaced: placed };
    }

    const [d] = await tx
      .select()
      .from(drafts)
      .where(eq(drafts.id, lot.draft_id))
      .limit(1);
    if (!d) return { proxyBidsPlaced: placed };
    if (d.status !== "live") return { proxyBidsPlaced: placed };

    const player = (
      await tx
        .select()
        .from(realPlayers)
        .where(eq(realPlayers.id, lot.real_player_id))
        .limit(1)
    )[0];
    if (!player) return { proxyBidsPlaced: placed };

    const rules = d.incrementRules as Array<{ threshold: number; inc: number }>;
    const minInc = nextIncrement(lot.current_bid, rules);
    const requiredNext = lot.current_bid + minInc;

    // Candidate proxies: must outrank current bidder + cover requiredNext.
    const candidates = await tx
      .select()
      .from(proxyBids)
      .where(
        and(
          eq(proxyBids.lotId, lotId),
          gt(proxyBids.maxAmount, lot.current_bid),
          lot.current_bidder_id
            ? ne(proxyBids.profileId, lot.current_bidder_id)
            : undefined
        )
      );

    const viable = candidates.filter((p) => p.maxAmount >= requiredNext);
    if (viable.length === 0) return { proxyBidsPlaced: placed };

    viable.sort((a, b) => b.maxAmount - a.maxAmount);
    const top = viable[0];
    const second = viable[1];

    // What we'd like the new high bid to be:
    //   - at least requiredNext
    //   - at most top.maxAmount
    //   - just above second.maxAmount (if there is one) to win efficiently
    let target = requiredNext;
    if (second) {
      target = Math.max(
        requiredNext,
        Math.min(
          top.maxAmount,
          second.maxAmount + nextIncrement(second.maxAmount, rules)
        )
      );
    }
    target = Math.min(target, top.maxAmount);
    if (target < requiredNext) return { proxyBidsPlaced: placed };

    // Re-validate budget + roster constraints for the proxy holder.
    const [holderBudget] = await tx
      .select()
      .from(managerBudgets)
      .where(
        and(
          eq(managerBudgets.draftId, d.id),
          eq(managerBudgets.profileId, top.profileId)
        )
      )
      .limit(1);

    const [posCount] = await tx
      .select({ n: count() })
      .from(rosters)
      .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
      .where(
        and(
          eq(rosters.leagueId, d.leagueId),
          eq(rosters.profileId, top.profileId),
          sql`${rosters.droppedAt} is null`,
          eq(realPlayers.position, player.position)
        )
      );

    const reqs = d.rosterRequirements as Record<string, number>;
    if ((posCount?.n ?? 0) >= (reqs[player.position] ?? 99)) {
      // Holder can't take any more of this position — skip this proxy.
      // Remove it from contention by deleting the proxy row.
      await tx
        .delete(proxyBids)
        .where(
          and(
            eq(proxyBids.lotId, lotId),
            eq(proxyBids.profileId, top.profileId)
          )
        );
      continue;
    }

    const holderMax = maxBidNow({
      budget: d.budgetPerManager,
      spent: holderBudget?.spent ?? 0,
      committedToOtherOpenLots: 0,
      rosterSize: d.rosterSize,
      slotsFilled: holderBudget?.slotsFilled ?? 0,
      minBid: d.minBid,
    });
    if (target > holderMax) {
      // Adjust target down to the holder's actual ceiling. If even that is
      // below requiredNext, this proxy is out.
      target = Math.min(target, holderMax);
      if (target < requiredNext) {
        await tx
          .delete(proxyBids)
          .where(
            and(
              eq(proxyBids.lotId, lotId),
              eq(proxyBids.profileId, top.profileId)
            )
          );
        continue;
      }
    }

    // Apply anti-snipe to closes_at.
    const { newCloses, isAntisnipe } = newClosesAt({
      currentCloses: lot.closes_at ? new Date(lot.closes_at) : null,
      now: new Date(),
      bidSeconds: d.bidSeconds,
      antisnipeTriggerSeconds: d.antisnipeTriggerSeconds,
      antisnipeExtendSeconds: d.antisnipeExtendSeconds,
    });

    // Place the proxy-generated bid.
    await tx
      .update(auctionLots)
      .set({
        currentBid: target,
        currentBidderId: top.profileId,
        closesAt: newCloses,
        status: isAntisnipe ? "closing" : "open",
      })
      .where(eq(auctionLots.id, lotId));

    await tx.insert(auctionBids).values({
      lotId,
      profileId: top.profileId,
      amount: target,
      isProxyGenerated: true,
      accepted: true,
    });

    placed++;
    // loop again — another proxy might want to keep going
  }

  return { proxyBidsPlaced: placed };
}
