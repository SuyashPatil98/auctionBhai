"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auctionBids,
  auctionLots,
  drafts,
  leagueMembers,
  managerBudgets,
  proxyBids,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  maxBidNow,
  minNextBid,
  newClosesAt,
  nextIncrement,
  nextNominator,
  validateBid,
} from "@/lib/auction/state";
import { resolveProxiesOnLot } from "@/lib/auction/proxy";
import { finalizeExpiredLots } from "@/lib/auction/finalize";

// ============================================================================
// Auth helpers
// ============================================================================

async function requireAuthedProfile(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

// ============================================================================
// Draft loaders (shared by tick + actions)
// ============================================================================

async function loadDraft(draftId: string) {
  const [d] = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  return d ?? null;
}

async function loadMembers(leagueId: string) {
  return db
    .select()
    .from(leagueMembers)
    .where(eq(leagueMembers.leagueId, leagueId));
}

async function loadBudgets(draftId: string) {
  return db
    .select()
    .from(managerBudgets)
    .where(eq(managerBudgets.draftId, draftId));
}

async function ensureBudgetRows(
  draftId: string,
  profileIds: string[]
): Promise<void> {
  if (profileIds.length === 0) return;
  const existing = await db
    .select({ profileId: managerBudgets.profileId })
    .from(managerBudgets)
    .where(eq(managerBudgets.draftId, draftId));
  const have = new Set(existing.map((r) => r.profileId));
  const missing = profileIds.filter((id) => !have.has(id));
  if (missing.length > 0) {
    await db.insert(managerBudgets).values(
      missing.map((profileId) => ({
        draftId,
        profileId,
        spent: 0,
        committed: 0,
        slotsFilled: 0,
      }))
    );
  }
}

// ============================================================================
// startDraft — commissioner kicks things off
// ============================================================================

export async function startDraft(draftId: string) {
  const userId = await requireAuthedProfile();
  const d = await loadDraft(draftId);
  if (!d) throw new Error("draft not found");
  if (d.status !== "scheduled") {
    throw new Error(`draft is ${d.status}, cannot start`);
  }

  const members = await loadMembers(d.leagueId);
  if (members.length < 2) {
    throw new Error("need at least 2 members to start");
  }
  await ensureBudgetRows(
    d.id,
    members.map((m) => m.profileId)
  );

  const sorted = [...members].sort(
    (a, b) => a.nominationOrder - b.nominationOrder
  );
  await db
    .update(drafts)
    .set({
      status: "live",
      startedAt: new Date(),
      currentNominatorProfileId: sorted[0].profileId,
    })
    .where(eq(drafts.id, d.id));

  void userId;
  revalidatePath("/draft");
}

// ============================================================================
// nominate — the current nominator picks a player to put up for bid
// ============================================================================

export async function nominate(formData: FormData) {
  const profileId = await requireAuthedProfile();
  const draftId = String(formData.get("draft_id") ?? "");
  const realPlayerId = String(formData.get("real_player_id") ?? "");
  const openingBid = Number(formData.get("opening_bid") ?? 0);

  if (!draftId || !realPlayerId) throw new Error("missing fields");

  const d = await loadDraft(draftId);
  if (!d) throw new Error("draft not found");
  if (d.status !== "live") throw new Error(`draft is ${d.status}`);
  if (d.currentNominatorProfileId !== profileId) {
    throw new Error("it's not your turn to nominate");
  }
  if (d.currentLotId !== null) {
    throw new Error("a lot is already in flight; wait for it to resolve");
  }

  // Validate the nominator can afford the opening bid + has the slot.
  const player = (
    await db
      .select()
      .from(realPlayers)
      .where(eq(realPlayers.id, realPlayerId))
      .limit(1)
  )[0];
  if (!player) throw new Error("player not found");

  // Player not already on a roster.
  const owned = (
    await db
      .select({ id: rosters.realPlayerId })
      .from(rosters)
      .where(
        and(
          eq(rosters.leagueId, d.leagueId),
          eq(rosters.realPlayerId, realPlayerId),
          sql`${rosters.droppedAt} is null`
        )
      )
      .limit(1)
  )[0];
  if (owned) throw new Error("player already rostered");

  // Nominator budget check.
  const budgets = await loadBudgets(d.id);
  const myBudget = budgets.find((b) => b.profileId === profileId);
  const myRosterPosCount = await rosterCountByPosition(
    d.leagueId,
    profileId,
    player.position
  );
  const reqs = d.rosterRequirements as Record<string, number>;
  if ((myRosterPosCount ?? 0) >= (reqs[player.position] ?? 99)) {
    throw new Error(`your ${player.position} slot is full`);
  }

  const opening = Math.max(d.minBid, Math.floor(openingBid) || d.minBid);
  const myMax = maxBidNow({
    budget: d.budgetPerManager,
    spent: myBudget?.spent ?? 0,
    committedToOtherOpenLots: 0, // no concurrent lots in v1
    rosterSize: d.rosterSize,
    slotsFilled: myBudget?.slotsFilled ?? 0,
    minBid: d.minBid,
  });
  if (opening > myMax) {
    throw new Error(`opening bid ${opening} exceeds your max ${myMax}`);
  }

  // Create lot + register opening bid (nominator commits to the opening).
  const closesAt = new Date(Date.now() + d.bidSeconds * 1000);
  const [lot] = await db
    .insert(auctionLots)
    .values({
      draftId: d.id,
      lotNumber: d.nextLotNumber,
      nominatedBy: profileId,
      realPlayerId,
      openingBid: opening,
      currentBid: opening,
      currentBidderId: profileId,
      status: "open",
      closesAt,
    })
    .returning({ id: auctionLots.id });

  await db.insert(auctionBids).values({
    lotId: lot.id,
    profileId,
    amount: opening,
    accepted: true,
  });

  await db
    .update(drafts)
    .set({ currentLotId: lot.id, nextLotNumber: d.nextLotNumber + 1 })
    .where(eq(drafts.id, d.id));

  revalidatePath("/draft");
}

async function rosterCountByPosition(
  leagueId: string,
  profileId: string,
  position: string
): Promise<number> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, leagueId),
        eq(rosters.profileId, profileId),
        sql`${rosters.droppedAt} is null`,
        eq(realPlayers.position, position as "GK" | "DEF" | "MID" | "FWD")
      )
    );
  return n;
}

// ============================================================================
// placeBid
// ============================================================================

export async function placeBid(formData: FormData) {
  const profileId = await requireAuthedProfile();
  const lotId = String(formData.get("lot_id") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  if (!lotId || !Number.isFinite(amount)) throw new Error("missing fields");

  // Single transaction to serialize against other bids.
  // Postgres-js doesn't expose `BEGIN` directly in Drizzle; using
  // `db.transaction` instead.
  const result = await db.transaction(async (tx) => {
    // Lock the lot row.
    const [lot] = await tx.execute(sql`
      select id, draft_id, real_player_id, opening_bid, current_bid,
        current_bidder_id, status, closes_at
      from auction_lots
      where id = ${lotId}
      for update
    `) as unknown as Array<{
      id: string;
      draft_id: string;
      real_player_id: string;
      opening_bid: number;
      current_bid: number;
      current_bidder_id: string | null;
      status: string;
      closes_at: string | null;
    }>;
    if (!lot) return { ok: false as const, reason: "lot not found" };

    const d = (
      await tx.select().from(drafts).where(eq(drafts.id, lot.draft_id)).limit(1)
    )[0];
    if (!d) return { ok: false as const, reason: "draft not found" };

    const player = (
      await tx
        .select()
        .from(realPlayers)
        .where(eq(realPlayers.id, lot.real_player_id))
        .limit(1)
    )[0];
    if (!player) return { ok: false as const, reason: "player not found" };

    // Bidder's roster + budget
    const myBudget = (
      await tx
        .select()
        .from(managerBudgets)
        .where(
          and(
            eq(managerBudgets.draftId, d.id),
            eq(managerBudgets.profileId, profileId)
          )
        )
        .limit(1)
    )[0];

    const myPositionCount = await tx
      .select({ n: count() })
      .from(rosters)
      .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
      .where(
        and(
          eq(rosters.leagueId, d.leagueId),
          eq(rosters.profileId, profileId),
          sql`${rosters.droppedAt} is null`,
          eq(realPlayers.position, player.position)
        )
      );

    const reqs = d.rosterRequirements as Record<string, number>;
    const max = maxBidNow({
      budget: d.budgetPerManager,
      spent: myBudget?.spent ?? 0,
      committedToOtherOpenLots: 0,
      rosterSize: d.rosterSize,
      slotsFilled: myBudget?.slotsFilled ?? 0,
      minBid: d.minBid,
    });

    const v = validateBid({
      bidAmount: amount,
      currentBid: lot.current_bid,
      currentBidderId: lot.current_bidder_id,
      bidderProfileId: profileId,
      rosterReqsForPosition: reqs[player.position] ?? 99,
      bidderSlotsForPosition: myPositionCount[0]?.n ?? 0,
      lotStatus: lot.status,
      draftStatus: d.status,
      rules: d.incrementRules as Array<{ threshold: number; inc: number }>,
      maxBidForBidder: max,
    });
    if (!v.ok) {
      await tx.insert(auctionBids).values({
        lotId: lot.id,
        profileId,
        amount,
        accepted: false,
        rejectionReason: v.reason,
      });
      return { ok: false as const, reason: v.reason };
    }

    // Accepted. Update lot, log bid, then resolve proxies.
    const { newCloses, isAntisnipe } = newClosesAt({
      currentCloses: lot.closes_at ? new Date(lot.closes_at) : null,
      now: new Date(),
      bidSeconds: d.bidSeconds,
      antisnipeTriggerSeconds: d.antisnipeTriggerSeconds,
      antisnipeExtendSeconds: d.antisnipeExtendSeconds,
    });

    await tx
      .update(auctionLots)
      .set({
        currentBid: amount,
        currentBidderId: profileId,
        closesAt: newCloses,
        status: isAntisnipe ? "closing" : "open",
      })
      .where(eq(auctionLots.id, lot.id));

    await tx.insert(auctionBids).values({
      lotId: lot.id,
      profileId,
      amount,
      accepted: true,
    });

    // Resolve any proxies that want to keep bidding (within tx).
    await resolveProxiesOnLot(tx, lot.id);

    return { ok: true as const };
  });

  if (!result.ok) {
    // Surface rejection via search param so the form can show it.
    redirect(`/draft?bidError=${encodeURIComponent(result.reason)}`);
  }
  revalidatePath("/draft");
}

// ============================================================================
// resolveExpired — finalize any open lots past closes_at
// ============================================================================

export async function resolveExpired(draftId: string) {
  const { changed } = await finalizeExpiredLots(draftId);
  if (changed) revalidatePath("/draft");
}

// ============================================================================
// setProxy — manager sets a max-bid for a lot
// ============================================================================

export async function setProxy(formData: FormData) {
  const profileId = await requireAuthedProfile();
  const lotId = String(formData.get("lot_id") ?? "");
  const maxAmount = Number(formData.get("max_amount") ?? 0);
  if (!lotId || !Number.isFinite(maxAmount) || maxAmount <= 0) {
    throw new Error("missing fields");
  }

  await db.transaction(async (tx) => {
    // Lock the lot.
    const [lot] = (await tx.execute(sql`
      select id, draft_id, current_bid, status from auction_lots
      where id = ${lotId} for update
    `)) as unknown as Array<{
      id: string;
      draft_id: string;
      current_bid: number;
      status: string;
    }>;
    if (!lot) throw new Error("lot not found");
    if (lot.status !== "open" && lot.status !== "closing") {
      throw new Error(`lot is ${lot.status}`);
    }

    // Upsert proxy.
    await tx
      .insert(proxyBids)
      .values({
        lotId: lot.id,
        profileId,
        maxAmount,
      })
      .onConflictDoUpdate({
        target: [proxyBids.lotId, proxyBids.profileId],
        set: {
          maxAmount: sql`excluded.max_amount`,
          updatedAt: sql`now()`,
        },
      });

    // Run resolution — proxy might fire immediately.
    await resolveProxiesOnLot(tx, lot.id);
  });

  revalidatePath("/draft");
}

// silence unused-import warnings
void minNextBid;
void nextIncrement;
void inArray;
