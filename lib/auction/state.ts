/**
 * Auction state machine and transitions.
 *
 * All transitions are server-authoritative. Clients never decide the
 * winner of a lot or the next state — they only submit intents (bid,
 * nominate, setProxy), and we recompute everything from Postgres rows.
 *
 * Concurrency:
 *   - Every state-changing function takes a transaction context
 *   - We SELECT FOR UPDATE on the lot row before bid validation, so
 *     racing bids serialize naturally
 *
 * State flow:
 *   draft.scheduled → live (commissioner.start)
 *   live → nominating slot for next manager
 *   nominator picks a player → auction_lots row open with closes_at
 *   each accepted bid resets closes_at (anti-snipe in 3.2)
 *   closes_at passes → status='sold' → trigger creates roster + budget delta
 *   advance current_nominator_profile_id, increment next_lot_number
 *   repeat until every manager filled their roster
 */

import type { Database } from "@/lib/db";

export type DraftConfig = {
  id: string;
  budgetPerManager: number;
  rosterSize: number;
  rosterRequirements: Record<string, number>;
  minBid: number;
  incrementRules: Array<{ threshold: number; inc: number }>;
  bidSeconds: number;
};

export function nextIncrement(
  currentBid: number,
  rules: Array<{ threshold: number; inc: number }>
): number {
  // rules sorted ascending; find the last threshold ≤ currentBid
  let inc = 1;
  for (const r of rules) {
    if (currentBid >= r.threshold) inc = r.inc;
  }
  return inc;
}

export function minNextBid(
  currentBid: number,
  rules: Array<{ threshold: number; inc: number }>
): number {
  return currentBid + nextIncrement(currentBid, rules);
}

/** Effective max bid for a manager on the *current* lot. */
export function maxBidNow(args: {
  budget: number;
  spent: number;
  committedToOtherOpenLots: number;
  rosterSize: number;
  slotsFilled: number;
  minBid: number;
}): number {
  const remaining = args.budget - args.spent - args.committedToOtherOpenLots;
  const slotsRemaining = args.rosterSize - args.slotsFilled;
  if (slotsRemaining <= 0) return 0;
  // Reserve min_bid × (slotsRemaining - 1) for remaining slots
  return Math.max(0, remaining - (slotsRemaining - 1) * args.minBid);
}

export type BidValidation =
  | { ok: true }
  | { ok: false; reason: string };

export function validateBid(args: {
  bidAmount: number;
  currentBid: number;
  currentBidderId: string | null;
  bidderProfileId: string;
  rosterReqsForPosition: number;
  bidderSlotsForPosition: number;
  lotStatus: string;
  draftStatus: string;
  rules: Array<{ threshold: number; inc: number }>;
  maxBidForBidder: number;
}): BidValidation {
  if (args.draftStatus !== "live") {
    return { ok: false, reason: `draft is ${args.draftStatus}` };
  }
  if (args.lotStatus !== "open" && args.lotStatus !== "closing") {
    return { ok: false, reason: `lot is ${args.lotStatus}` };
  }
  if (args.currentBidderId === args.bidderProfileId) {
    return { ok: false, reason: "you are already the high bidder" };
  }
  if (args.bidderSlotsForPosition >= args.rosterReqsForPosition) {
    return {
      ok: false,
      reason: "roster slot for this position is full",
    };
  }
  const minNext = minNextBid(args.currentBid, args.rules);
  if (args.bidAmount < minNext) {
    return { ok: false, reason: `min next bid is ${minNext}` };
  }
  if (args.bidAmount > args.maxBidForBidder) {
    return {
      ok: false,
      reason: `over budget — max ${args.maxBidForBidder}`,
    };
  }
  return { ok: true };
}

/**
 * Decide which manager nominates next.
 *
 * Rotates through league_members in `nomination_order`, regardless of
 * who won the previous lot. Skips managers whose rosters are full.
 *
 * Returns null when all managers are full (draft → complete).
 */
export function nextNominator(args: {
  members: Array<{ profileId: string; nominationOrder: number }>;
  slotsFilledByProfile: Map<string, number>;
  rosterSize: number;
  previousNominatorId: string | null;
}): string | null {
  // Sort once by nomination order
  const sorted = [...args.members].sort(
    (a, b) => a.nominationOrder - b.nominationOrder
  );
  if (sorted.length === 0) return null;

  // Determine starting index
  let startIdx = 0;
  if (args.previousNominatorId) {
    const prevIdx = sorted.findIndex(
      (m) => m.profileId === args.previousNominatorId
    );
    startIdx = prevIdx >= 0 ? (prevIdx + 1) % sorted.length : 0;
  }

  // Find first manager from startIdx whose roster isn't full
  for (let i = 0; i < sorted.length; i++) {
    const idx = (startIdx + i) % sorted.length;
    const filled = args.slotsFilledByProfile.get(sorted[idx].profileId) ?? 0;
    if (filled < args.rosterSize) {
      return sorted[idx].profileId;
    }
  }
  return null; // everyone full
}

// Compile-time hint that we're keeping the Database export referenced.
// (Importers will want it for tx contexts later.)
export type _DbType = Database;
