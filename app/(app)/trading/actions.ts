"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auditLog,
  drafts,
  fixtures,
  freeAgentBids,
  freeAgentResolutions,
  leagues,
  managerBudgets,
  managerLineups,
  playerPrices,
  profiles,
  realPlayers,
  rosters,
  trades,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { requireLeagueMember } from "@/lib/util/require-league-member";
import {
  assertTradingAllowed,
  computeWindowState,
  windowKeyFor,
  type WindowState,
} from "@/lib/trading/window";

async function requireProfileId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

async function loadWindowState(): Promise<WindowState> {
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

// ----------------------------------------------------------------------------
// Free-agent sealed-bid auction (5.10)
// ----------------------------------------------------------------------------

/**
 * Place (or update) a blind bid on an unowned player for this window.
 * Bids are blind — only the bidder sees their own amount until resolution.
 *
 * Refusals:
 *   - Outside trading window
 *   - Player is already owned by you (or anyone)
 *   - amount < 1 or amount > your remaining budget
 */
export async function placeBlindBid(
  realPlayerId: string,
  amount: number
): Promise<{ windowKey: string; amount: number }> {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);
  const state = await loadWindowState();
  assertTradingAllowed(state);

  if (!realPlayerId) throw new Error("realPlayerId required");
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000) {
    throw new Error("bid amount must be a positive integer up to 10000");
  }

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");

  // Refuse if anyone owns this player right now
  const [owned] = await db
    .select({ id: rosters.realPlayerId })
    .from(rosters)
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.realPlayerId, realPlayerId),
        isNull(rosters.droppedAt)
      )
    )
    .limit(1);
  if (owned) {
    throw new Error("this player is already owned — can't bid on them");
  }

  // Budget check
  const [draft] = await db
    .select({
      id: drafts.id,
      budgetPerManager: drafts.budgetPerManager,
    })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!draft) throw new Error("no draft");
  const [budget] = await db
    .select()
    .from(managerBudgets)
    .where(
      and(
        eq(managerBudgets.draftId, draft.id),
        eq(managerBudgets.profileId, profileId)
      )
    )
    .limit(1);
  const remaining = draft.budgetPerManager - (budget?.spent ?? 0);
  if (amount > remaining) {
    throw new Error(
      `bid ${amount} exceeds your remaining budget (${remaining} cr)`
    );
  }

  const windowKey = windowKeyFor(state.opensAt);

  await db
    .insert(freeAgentBids)
    .values({
      windowKey,
      realPlayerId,
      profileId,
      amount,
    })
    .onConflictDoUpdate({
      target: [
        freeAgentBids.windowKey,
        freeAgentBids.realPlayerId,
        freeAgentBids.profileId,
      ],
      set: {
        amount,
        placedAt: new Date(), // re-bid resets timestamp (tie-break disadvantage)
        withdrawnAt: null,
      },
    });

  revalidatePath("/trading");
  return { windowKey, amount };
}

export async function withdrawBid(realPlayerId: string) {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);
  const state = await loadWindowState();
  assertTradingAllowed(state);

  const windowKey = windowKeyFor(state.opensAt);
  await db
    .update(freeAgentBids)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(freeAgentBids.windowKey, windowKey),
        eq(freeAgentBids.realPlayerId, realPlayerId),
        eq(freeAgentBids.profileId, profileId),
        isNull(freeAgentBids.withdrawnAt)
      )
    );

  revalidatePath("/trading");
}

/**
 * Resolve every unresolved (window, player) lot with active bids.
 *
 * For each lot:
 *   - Sort bids by (amount desc, placed_at asc)
 *   - Walk bidders in order; first one who can afford the amount wins.
 *   - Award: create roster row (acquired_via='free_agent'), increment
 *     winner.spent + slotsFilled.
 *   - If nobody can afford, log a no-winner resolution.
 *
 * Idempotent — already-resolved (windowKey, realPlayerId) pairs are
 * skipped.
 *
 * Can be called by:
 *   - Commissioner button (force-resolve current window any time)
 *   - Auto on window close (no scheduler yet — manual trigger)
 */
export type ResolutionReport = {
  resolved: number;
  awarded: number;
  windowKey: string;
};

export async function resolveFreeAgentWindow(
  targetWindowKey?: string
): Promise<ResolutionReport> {
  const profileId = await requireProfileId();
  await requireLeagueMember(profileId);

  // Default = the most recent window with any active bids
  let windowKey = targetWindowKey;
  if (!windowKey) {
    const [latest] = (await db.execute(sql`
      select window_key as "windowKey"
      from free_agent_bids
      where withdrawn_at is null
      order by window_key desc
      limit 1
    `)) as unknown as Array<{ windowKey: string }>;
    if (!latest) return { resolved: 0, awarded: 0, windowKey: "" };
    windowKey = latest.windowKey;
  }

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");
  const [draft] = await db
    .select({ id: drafts.id, budgetPerManager: drafts.budgetPerManager })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!draft) throw new Error("no draft");

  // All (player, bids) for this window not yet resolved
  const bidsByPlayer = (await db.execute(sql`
    select
      fab.real_player_id as "realPlayerId",
      fab.profile_id      as "profileId",
      fab.amount          as "amount",
      fab.placed_at       as "placedAt"
    from free_agent_bids fab
    where fab.window_key = ${windowKey}
      and fab.withdrawn_at is null
      and not exists (
        select 1 from free_agent_resolutions far
         where far.window_key = fab.window_key
           and far.real_player_id = fab.real_player_id
      )
    order by fab.real_player_id, fab.amount desc, fab.placed_at asc
  `)) as unknown as Array<{
    realPlayerId: string;
    profileId: string;
    amount: number;
    placedAt: Date;
  }>;

  // Group by player
  const byPlayer = new Map<string, typeof bidsByPlayer>();
  for (const b of bidsByPlayer) {
    if (!byPlayer.has(b.realPlayerId)) byPlayer.set(b.realPlayerId, []);
    byPlayer.get(b.realPlayerId)!.push(b);
  }

  let resolved = 0;
  let awarded = 0;

  for (const [realPlayerId, bids] of byPlayer) {
    // Skip if player got owned via some other path mid-resolution
    const [owned] = await db
      .select({ id: rosters.realPlayerId })
      .from(rosters)
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.realPlayerId, realPlayerId),
          isNull(rosters.droppedAt)
        )
      )
      .limit(1);
    if (owned) {
      await db.insert(freeAgentResolutions).values({
        windowKey,
        realPlayerId,
        winnerProfileId: null,
        winningAmount: null,
        biddersCount: bids.length,
      });
      resolved++;
      continue;
    }

    let winner: { profileId: string; amount: number } | null = null;
    for (const bid of bids) {
      const [b] = await db
        .select()
        .from(managerBudgets)
        .where(
          and(
            eq(managerBudgets.draftId, draft.id),
            eq(managerBudgets.profileId, bid.profileId)
          )
        )
        .limit(1);
      const remaining = draft.budgetPerManager - (b?.spent ?? 0);
      if (bid.amount <= remaining) {
        winner = { profileId: bid.profileId, amount: bid.amount };
        break;
      }
    }

    if (winner) {
      // Award
      await db.insert(rosters).values({
        leagueId: league.id,
        profileId: winner.profileId,
        realPlayerId,
        acquiredVia: "free_agent",
        acquiredAmount: winner.amount,
      });
      await db
        .update(managerBudgets)
        .set({
          spent: sql`${managerBudgets.spent} + ${winner.amount}`,
          slotsFilled: sql`${managerBudgets.slotsFilled} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(managerBudgets.draftId, draft.id),
            eq(managerBudgets.profileId, winner.profileId)
          )
        );
      awarded++;
    }

    await db.insert(freeAgentResolutions).values({
      windowKey,
      realPlayerId,
      winnerProfileId: winner?.profileId ?? null,
      winningAmount: winner?.amount ?? null,
      biddersCount: bids.length,
    });
    resolved++;
  }

  await db.insert(auditLog).values({
    actorProfileId: profileId,
    action: "trading.fa_resolve",
    entity: "free_agent_resolutions",
    entityId: null,
    before: null,
    after: { windowKey, resolved, awarded },
  });

  revalidatePath("/trading");
  revalidatePath("/team");
  revalidatePath("/dashboard");

  return { resolved, awarded, windowKey };
}

// ----------------------------------------------------------------------------
// Trades Lite (5.11)
// ----------------------------------------------------------------------------

const MAX_ACCEPTED_TRADES_PER_WINDOW = 2;

async function rosterOwner(
  leagueId: string,
  realPlayerId: string,
  profileId: string
): Promise<{ acquiredAmount: number; position: string } | null> {
  const [r] = await db
    .select({
      acquiredAmount: rosters.acquiredAmount,
      position: realPlayers.position,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, leagueId),
        eq(rosters.profileId, profileId),
        eq(rosters.realPlayerId, realPlayerId),
        isNull(rosters.droppedAt)
      )
    )
    .limit(1);
  if (!r) return null;
  return { acquiredAmount: r.acquiredAmount ?? 0, position: r.position };
}

async function acceptedTradesThisWindow(
  windowKey: string,
  profileId: string
): Promise<number> {
  const rows = (await db.execute(sql`
    select count(*)::int as n
    from trades
    where window_key = ${windowKey}
      and status = 'accepted'
      and (proposer_id = ${profileId} or recipient_id = ${profileId})
  `)) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

export type ProposeTradeInput = {
  recipientId: string;
  myPlayerId: string;
  theirPlayerId: string;
  creditFromProposer: number;
  message?: string;
};

export async function proposeTrade(input: ProposeTradeInput) {
  const proposerId = await requireProfileId();
  await requireLeagueMember(proposerId);
  const state = await loadWindowState();
  assertTradingAllowed(state);

  if (!input.recipientId || input.recipientId === proposerId) {
    throw new Error("pick a different manager to trade with");
  }
  if (!input.myPlayerId || !input.theirPlayerId) {
    throw new Error("both player ids required");
  }
  if (input.myPlayerId === input.theirPlayerId) {
    throw new Error("players must be different");
  }
  if (
    !Number.isInteger(input.creditFromProposer) ||
    input.creditFromProposer < -5000 ||
    input.creditFromProposer > 5000
  ) {
    throw new Error("credit transfer must be an integer in [-5000, 5000]");
  }

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");

  // Both players must currently be owned by their respective parties
  const mine = await rosterOwner(league.id, input.myPlayerId, proposerId);
  if (!mine) {
    throw new Error("the player you're offering isn't on your active roster");
  }
  const theirs = await rosterOwner(
    league.id,
    input.theirPlayerId,
    input.recipientId
  );
  if (!theirs) {
    throw new Error("the player you're asking for isn't on the recipient's roster");
  }

  // Position-for-position only
  if (mine.position !== theirs.position) {
    throw new Error(
      `position mismatch — you offered a ${mine.position} for a ${theirs.position}. Trades must be position-for-position.`
    );
  }

  // Trade cap (proposer)
  const windowKey = windowKeyFor(state.opensAt);
  const proposerAccepted = await acceptedTradesThisWindow(
    windowKey,
    proposerId
  );
  if (proposerAccepted >= MAX_ACCEPTED_TRADES_PER_WINDOW) {
    throw new Error(
      `you've already had ${proposerAccepted} accepted trades this window (max ${MAX_ACCEPTED_TRADES_PER_WINDOW}).`
    );
  }

  // Budget feasibility check at proposal time. Acceptance re-checks.
  const [draft] = await db
    .select({ id: drafts.id, budgetPerManager: drafts.budgetPerManager })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!draft) throw new Error("no draft");
  const budgets = await db
    .select()
    .from(managerBudgets)
    .where(
      and(
        eq(managerBudgets.draftId, draft.id),
        inArray(managerBudgets.profileId, [proposerId, input.recipientId])
      )
    );
  const proposerBudget =
    budgets.find((b) => b.profileId === proposerId)?.spent ?? 0;
  const recipientBudget =
    budgets.find((b) => b.profileId === input.recipientId)?.spent ?? 0;
  const proposerDelta =
    -mine.acquiredAmount + theirs.acquiredAmount + input.creditFromProposer;
  const recipientDelta =
    -theirs.acquiredAmount + mine.acquiredAmount - input.creditFromProposer;
  if (proposerBudget + proposerDelta > draft.budgetPerManager) {
    throw new Error(
      `this trade would push your spent over the cap (need ${proposerBudget + proposerDelta}, cap ${draft.budgetPerManager}).`
    );
  }
  if (recipientBudget + recipientDelta > draft.budgetPerManager) {
    throw new Error(
      `recipient can't afford this trade — their spent would hit ${recipientBudget + recipientDelta} (cap ${draft.budgetPerManager}).`
    );
  }

  // Persist
  await db.insert(trades).values({
    windowKey,
    proposerId,
    recipientId: input.recipientId,
    proposerPlayerId: input.myPlayerId,
    recipientPlayerId: input.theirPlayerId,
    creditFromProposer: input.creditFromProposer,
    message: input.message?.trim() || null,
  });

  await db.insert(auditLog).values({
    actorProfileId: proposerId,
    action: "trading.propose",
    entity: "trades",
    entityId: null,
    before: null,
    after: { ...input, windowKey },
  });

  revalidatePath("/trading");
}

export async function withdrawTrade(tradeId: string) {
  const me = await requireProfileId();
  await requireLeagueMember(me);
  if (!tradeId) throw new Error("tradeId required");

  const [t] = await db
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!t) throw new Error("trade not found");
  if (t.proposerId !== me) {
    throw new Error("only the proposer can withdraw a trade");
  }
  if (t.status !== "pending") {
    throw new Error(`trade is ${t.status} — nothing to withdraw`);
  }

  await db
    .update(trades)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(eq(trades.id, tradeId));

  revalidatePath("/trading");
}

export async function rejectTrade(tradeId: string, reason?: string) {
  const me = await requireProfileId();
  await requireLeagueMember(me);
  if (!tradeId) throw new Error("tradeId required");

  const [t] = await db
    .select()
    .from(trades)
    .where(eq(trades.id, tradeId))
    .limit(1);
  if (!t) throw new Error("trade not found");
  if (t.recipientId !== me) {
    throw new Error("only the recipient can reject");
  }
  if (t.status !== "pending") {
    throw new Error(`trade is ${t.status} — nothing to reject`);
  }

  await db
    .update(trades)
    .set({
      status: "rejected",
      decidedAt: new Date(),
      decisionMessage: reason?.trim() || null,
    })
    .where(eq(trades.id, tradeId));

  revalidatePath("/trading");
}

export async function acceptTrade(tradeId: string) {
  const me = await requireProfileId();
  await requireLeagueMember(me);
  const state = await loadWindowState();
  assertTradingAllowed(state);
  if (!tradeId) throw new Error("tradeId required");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) throw new Error("no league");

  await db.transaction(async (tx) => {
    const [t] = await tx
      .select()
      .from(trades)
      .where(eq(trades.id, tradeId))
      .limit(1);
    if (!t) throw new Error("trade not found");
    if (t.recipientId !== me) {
      throw new Error("only the recipient can accept");
    }
    if (t.status !== "pending") {
      throw new Error(`trade is ${t.status}`);
    }
    if (t.windowKey !== windowKeyFor(state.opensAt)) {
      throw new Error("this trade is from a previous window");
    }

    // Cap check at acceptance time
    for (const profile of [t.proposerId, t.recipientId]) {
      const n = await acceptedTradesThisWindow(t.windowKey, profile);
      if (n >= MAX_ACCEPTED_TRADES_PER_WINDOW) {
        throw new Error(
          `${profile === me ? "you have" : "proposer has"} already hit ${MAX_ACCEPTED_TRADES_PER_WINDOW} accepted trades this window`
        );
      }
    }

    // Both players must still be owned by their respective parties
    const [mine] = await tx
      .select({
        acquiredAmount: rosters.acquiredAmount,
        position: realPlayers.position,
      })
      .from(rosters)
      .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, t.proposerId),
          eq(rosters.realPlayerId, t.proposerPlayerId),
          isNull(rosters.droppedAt)
        )
      )
      .limit(1);
    if (!mine) {
      throw new Error("proposer no longer owns their player (sold or traded)");
    }
    const [theirs] = await tx
      .select({
        acquiredAmount: rosters.acquiredAmount,
        position: realPlayers.position,
      })
      .from(rosters)
      .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, t.recipientId),
          eq(rosters.realPlayerId, t.recipientPlayerId),
          isNull(rosters.droppedAt)
        )
      )
      .limit(1);
    if (!theirs) {
      throw new Error("you no longer own your player (sold or traded)");
    }
    if (mine.position !== theirs.position) {
      throw new Error("positions no longer match (shouldn't happen)");
    }

    // Drop both roster rows
    await tx
      .update(rosters)
      .set({ droppedAt: new Date() })
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, t.proposerId),
          eq(rosters.realPlayerId, t.proposerPlayerId),
          isNull(rosters.droppedAt)
        )
      );
    await tx
      .update(rosters)
      .set({ droppedAt: new Date() })
      .where(
        and(
          eq(rosters.leagueId, league.id),
          eq(rosters.profileId, t.recipientId),
          eq(rosters.realPlayerId, t.recipientPlayerId),
          isNull(rosters.droppedAt)
        )
      );

    // Insert both new roster rows (acquired_via='trade')
    const mineAcq = mine.acquiredAmount ?? 0;
    const theirsAcq = theirs.acquiredAmount ?? 0;
    await tx.insert(rosters).values({
      leagueId: league.id,
      profileId: t.proposerId,
      realPlayerId: t.recipientPlayerId,
      acquiredVia: "trade",
      acquiredAmount: theirsAcq,
    });
    await tx.insert(rosters).values({
      leagueId: league.id,
      profileId: t.recipientId,
      realPlayerId: t.proposerPlayerId,
      acquiredVia: "trade",
      acquiredAmount: mineAcq,
    });

    // Budget deltas — spent changes by ( new_player_cost - old_player_cost + credit_paid )
    const [draft] = await tx
      .select({ id: drafts.id, budgetPerManager: drafts.budgetPerManager })
      .from(drafts)
      .where(eq(drafts.leagueId, league.id))
      .limit(1);
    if (!draft) throw new Error("no draft");

    const proposerDelta = -mineAcq + theirsAcq + t.creditFromProposer;
    const recipientDelta = -theirsAcq + mineAcq - t.creditFromProposer;

    for (const [pid, delta] of [
      [t.proposerId, proposerDelta] as const,
      [t.recipientId, recipientDelta] as const,
    ]) {
      const [b] = await tx
        .select()
        .from(managerBudgets)
        .where(
          and(
            eq(managerBudgets.draftId, draft.id),
            eq(managerBudgets.profileId, pid)
          )
        )
        .limit(1);
      const prev = b?.spent ?? 0;
      const next = prev + delta;
      if (next > draft.budgetPerManager) {
        throw new Error(
          `accepting would push spent over cap for ${pid === me ? "you" : "the proposer"} (would be ${next}, cap ${draft.budgetPerManager})`
        );
      }
      if (next < 0) {
        throw new Error(
          `accepting would make spent negative for ${pid === me ? "you" : "the proposer"} (would be ${next})`
        );
      }
      await tx
        .update(managerBudgets)
        .set({ spent: next, updatedAt: new Date() })
        .where(
          and(
            eq(managerBudgets.draftId, draft.id),
            eq(managerBudgets.profileId, pid)
          )
        );
    }

    // Scrub traded-away players from each party's non-locked lineups
    for (const [pid, awayPlayerId] of [
      [t.proposerId, t.proposerPlayerId] as const,
      [t.recipientId, t.recipientPlayerId] as const,
    ]) {
      const lns = await tx
        .select()
        .from(managerLineups)
        .where(
          and(
            eq(managerLineups.profileId, pid),
            isNull(managerLineups.lockedAt)
          )
        );
      for (const ln of lns) {
        const newStarters = ln.starterIds.filter((id) => id !== awayPlayerId);
        const newBench = ln.benchIds.map((id) =>
          id === awayPlayerId ? "" : id
        );
        const newCaptain =
          ln.captainId === awayPlayerId
            ? newStarters[0] ?? ""
            : ln.captainId;
        const newVice =
          ln.viceId === awayPlayerId ? newStarters[1] ?? "" : ln.viceId;
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
    }

    // Mark trade accepted
    await tx
      .update(trades)
      .set({ status: "accepted", decidedAt: new Date() })
      .where(eq(trades.id, tradeId));

    await tx.insert(auditLog).values({
      actorProfileId: me,
      action: "trading.accept",
      entity: "trades",
      entityId: tradeId,
      before: { proposerDelta, recipientDelta },
      after: { mineAcq, theirsAcq, credit: t.creditFromProposer },
    });
  });

  revalidatePath("/trading");
  revalidatePath("/team");
  revalidatePath("/dashboard");
}
