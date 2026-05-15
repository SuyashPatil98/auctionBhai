"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auctionLots,
  auditLog,
  drafts,
  leagueMembers,
  managerBudgets,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { nextNominator } from "@/lib/auction/state";

async function requireAuthedProfile(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

async function logAdmin(
  actorProfileId: string,
  action: string,
  entity: string,
  entityId: string | null,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  metadata?: Record<string, unknown>
) {
  await db.insert(auditLog).values({
    actorProfileId,
    action,
    entity,
    entityId: entityId,
    before,
    after,
    metadata: metadata ?? null,
  });
}

// ============================================================================
// pauseDraft / resumeDraft
// ============================================================================

export async function pauseDraft(formData: FormData) {
  const actor = await requireAuthedProfile();
  const draftId = String(formData.get("draft_id") ?? "");
  if (!draftId) throw new Error("draft_id required");

  const [d] = await db.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
  if (!d) throw new Error("draft not found");
  if (d.status !== "live") throw new Error(`draft is ${d.status}, cannot pause`);

  const now = new Date();
  await db
    .update(drafts)
    .set({ status: "paused", pausedAt: now })
    .where(eq(drafts.id, draftId));

  await logAdmin(actor, "draft.pause", "drafts", draftId, { status: "live" }, { status: "paused", pausedAt: now });
  revalidatePath("/draft");
  revalidatePath("/draft/admin");
}

export async function resumeDraft(formData: FormData) {
  const actor = await requireAuthedProfile();
  const draftId = String(formData.get("draft_id") ?? "");
  if (!draftId) throw new Error("draft_id required");

  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (!d) throw new Error("draft not found");
    if (d.status !== "paused" || !d.pausedAt) {
      throw new Error("draft isn't paused");
    }
    const pausedMs = Date.now() - d.pausedAt.getTime();

    // Shift the current lot's closes_at forward by the pause duration.
    if (d.currentLotId) {
      const [lot] = await tx
        .select()
        .from(auctionLots)
        .where(eq(auctionLots.id, d.currentLotId))
        .limit(1);
      if (lot?.closesAt) {
        await tx
          .update(auctionLots)
          .set({
            closesAt: new Date(lot.closesAt.getTime() + pausedMs),
          })
          .where(eq(auctionLots.id, lot.id));
      }
    }

    await tx
      .update(drafts)
      .set({ status: "live", pausedAt: null })
      .where(eq(drafts.id, draftId));
  });

  await logAdmin(actor, "draft.resume", "drafts", draftId, { status: "paused" }, { status: "live" });
  revalidatePath("/draft");
  revalidatePath("/draft/admin");
}

// ============================================================================
// voidLot — cancel the current open lot, return player to pool
// ============================================================================

export async function voidLot(formData: FormData) {
  const actor = await requireAuthedProfile();
  const lotId = String(formData.get("lot_id") ?? "");
  const reason =
    String(formData.get("reason") ?? "").trim() || "commissioner voided";
  if (!lotId) throw new Error("lot_id required");

  await db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(auctionLots)
      .where(eq(auctionLots.id, lotId))
      .limit(1);
    if (!lot) throw new Error("lot not found");
    if (lot.status === "sold") {
      throw new Error(
        "lot is already sold — undoing requires manual SQL (or a reset)"
      );
    }
    await tx
      .update(auctionLots)
      .set({ status: "voided", voidReason: reason })
      .where(eq(auctionLots.id, lotId));
    // Clear current_lot_id so the nominator can pick again.
    await tx
      .update(drafts)
      .set({ currentLotId: null })
      .where(eq(drafts.id, lot.draftId));

    await tx.insert(auditLog).values({
      actorProfileId: actor,
      action: "lot.void",
      entity: "auction_lots",
      entityId: lot.id,
      before: { status: lot.status },
      after: { status: "voided", voidReason: reason },
    });
  });
  revalidatePath("/draft");
  revalidatePath("/draft/admin");
}

// ============================================================================
// manualAward — force-award the current lot to a specific manager
// ============================================================================

export async function manualAwardLot(formData: FormData) {
  const actor = await requireAuthedProfile();
  const lotId = String(formData.get("lot_id") ?? "");
  const winnerId = String(formData.get("winner_id") ?? "");
  const amount = Number(formData.get("amount") ?? 0);
  if (!lotId || !winnerId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("missing fields");
  }

  await db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(auctionLots)
      .where(eq(auctionLots.id, lotId))
      .limit(1);
    if (!lot) throw new Error("lot not found");
    if (lot.status === "sold" || lot.status === "voided") {
      throw new Error(`lot is ${lot.status}`);
    }

    const before = {
      status: lot.status,
      currentBid: lot.currentBid,
      currentBidderId: lot.currentBidderId,
    };

    // Flipping status='sold' fires the on_lot_sold trigger which creates
    // the roster row + bumps manager_budgets.
    await tx
      .update(auctionLots)
      .set({
        currentBidderId: winnerId,
        currentBid: amount,
        status: "sold",
        soldAt: new Date(),
      })
      .where(eq(auctionLots.id, lot.id));

    // Advance nominator + clear current_lot_id.
    const [d] = await tx.select().from(drafts).where(eq(drafts.id, lot.draftId)).limit(1);
    if (d) {
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
          .set({
            status: "complete",
            completedAt: new Date(),
            currentLotId: null,
          })
          .where(eq(drafts.id, d.id));
      } else {
        await tx
          .update(drafts)
          .set({ currentLotId: null, currentNominatorProfileId: next })
          .where(eq(drafts.id, d.id));
      }
    }

    await tx.insert(auditLog).values({
      actorProfileId: actor,
      action: "lot.manual_award",
      entity: "auction_lots",
      entityId: lot.id,
      before,
      after: { status: "sold", currentBid: amount, currentBidderId: winnerId },
    });
  });
  revalidatePath("/draft");
  revalidatePath("/draft/admin");
}

// ============================================================================
// resetDraft — nuke everything and start over
// ============================================================================

export async function resetDraft(formData: FormData) {
  const actor = await requireAuthedProfile();
  const draftId = String(formData.get("draft_id") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (confirm !== "RESET") {
    throw new Error("type RESET to confirm");
  }
  if (!draftId) throw new Error("draft_id required");

  await db.transaction(async (tx) => {
    const [d] = await tx.select().from(drafts).where(eq(drafts.id, draftId)).limit(1);
    if (!d) throw new Error("draft not found");

    // Delete rosters from this league acquired via auction.
    await tx
      .delete(rosters)
      .where(
        and(
          eq(rosters.leagueId, d.leagueId),
          eq(rosters.acquiredVia, "auction")
        )
      );
    // Reset budgets to zero.
    await tx
      .update(managerBudgets)
      .set({ spent: 0, committed: 0, slotsFilled: 0 })
      .where(eq(managerBudgets.draftId, draftId));
    // Delete lots (cascades to bids + proxies).
    await tx.delete(auctionLots).where(eq(auctionLots.draftId, draftId));

    // Reset draft fields.
    await tx
      .update(drafts)
      .set({
        status: "scheduled",
        currentLotId: null,
        currentNominatorProfileId: null,
        startedAt: null,
        completedAt: null,
        pausedAt: null,
        nextLotNumber: 1,
      })
      .where(eq(drafts.id, draftId));

    await tx.insert(auditLog).values({
      actorProfileId: actor,
      action: "draft.reset",
      entity: "drafts",
      entityId: draftId,
      before: null,
      after: { status: "scheduled" },
      metadata: { note: "destructive — all lots + budgets wiped" },
    });
  });
  revalidatePath("/draft");
  revalidatePath("/draft/admin");
}

// silence
void sql;
