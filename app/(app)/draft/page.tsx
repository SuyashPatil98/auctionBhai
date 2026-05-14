import { redirect } from "next/navigation";
import { and, asc, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auctionBids,
  auctionLots,
  countries,
  drafts,
  leagueMembers,
  leagues,
  managerBudgets,
  playerPrices,
  profiles,
  proxyBids,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { maxBidNow } from "@/lib/auction/state";
import { resolveExpired } from "./actions";
import AuctionRoom, {
  type AuctionRoomProps,
  type AvailablePlayer,
  type Bid,
  type Budget,
  type CurrentLot,
  type Manager,
} from "./AuctionRoom";

export const dynamic = "force-dynamic";

export const metadata = { title: "Draft · FiFantasy" };

type SearchParams = Promise<{
  q?: string;
  bidError?: string;
}>;

export default async function DraftPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q, bidError } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No league exists. Run <code>pnpm seed:league</code>.
      </div>
    );
  }
  const [initialDraft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!initialDraft) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
        No draft yet. Run <code>pnpm seed:league</code>.
      </div>
    );
  }

  // Self-heal: finalize any expired lots before render.
  if (initialDraft.status === "live" && initialDraft.currentLotId) {
    await resolveExpired(initialDraft.id);
  }
  const [d] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.id, initialDraft.id))
    .limit(1);

  const memberRows = await db
    .select({
      profileId: leagueMembers.profileId,
      nominationOrder: leagueMembers.nominationOrder,
      displayName: profiles.displayName,
      teamName: profiles.teamName,
      teamEmoji: profiles.teamEmoji,
    })
    .from(leagueMembers)
    .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
    .where(eq(leagueMembers.leagueId, league.id))
    .orderBy(asc(leagueMembers.nominationOrder));

  const members: Manager[] = memberRows;

  const budgetRows = await db
    .select()
    .from(managerBudgets)
    .where(eq(managerBudgets.draftId, d.id));
  const budgets: Budget[] = budgetRows.map((b) => ({
    profileId: b.profileId,
    spent: b.spent,
    committed: b.committed,
    slotsFilled: b.slotsFilled,
  }));

  let currentLot: CurrentLot = null;
  if (d.currentLotId) {
    const [row] = await db
      .select({
        lot: auctionLots,
        playerName: realPlayers.displayName,
        position: realPlayers.position,
        countryName: countries.name,
      })
      .from(auctionLots)
      .innerJoin(realPlayers, eq(realPlayers.id, auctionLots.realPlayerId))
      .innerJoin(countries, eq(countries.id, realPlayers.countryId))
      .where(eq(auctionLots.id, d.currentLotId))
      .limit(1);
    if (row) {
      const [bidder] = row.lot.currentBidderId
        ? await db
            .select({ displayName: profiles.displayName })
            .from(profiles)
            .where(eq(profiles.id, row.lot.currentBidderId))
            .limit(1)
        : [];
      currentLot = {
        id: row.lot.id,
        lotNumber: row.lot.lotNumber,
        realPlayerId: row.lot.realPlayerId,
        openingBid: row.lot.openingBid,
        currentBid: row.lot.currentBid,
        currentBidderId: row.lot.currentBidderId,
        status: row.lot.status,
        closesAt: row.lot.closesAt ? row.lot.closesAt.toISOString() : null,
        playerName: row.playerName,
        position: row.position,
        countryName: row.countryName,
        bidderName: bidder?.displayName ?? null,
      };
    }
  }

  const recentBidsRaw = currentLot
    ? await db
        .select({
          amount: auctionBids.amount,
          accepted: auctionBids.accepted,
          rejectionReason: auctionBids.rejectionReason,
          placedAt: auctionBids.placedAt,
          bidderName: profiles.displayName,
        })
        .from(auctionBids)
        .innerJoin(profiles, eq(profiles.id, auctionBids.profileId))
        .where(eq(auctionBids.lotId, currentLot.id))
        .orderBy(desc(auctionBids.placedAt))
        .limit(10)
    : [];

  const recentBids: Bid[] = recentBidsRaw.map((b) => ({
    amount: b.amount,
    accepted: b.accepted,
    rejectionReason: b.rejectionReason,
    placedAt: b.placedAt.toISOString(),
    bidderName: b.bidderName,
  }));

  // My proxy on the current lot (if any)
  let myProxyMax: number | null = null;
  if (currentLot) {
    const [p] = await db
      .select()
      .from(proxyBids)
      .where(
        and(
          eq(proxyBids.lotId, currentLot.id),
          eq(proxyBids.profileId, user.id)
        )
      )
      .limit(1);
    myProxyMax = p?.maxAmount ?? null;
  }

  // My budget context
  const myBudget = budgets.find((b) => b.profileId === user.id);
  const myMaxBidNow = myBudget
    ? maxBidNow({
        budget: d.budgetPerManager,
        spent: myBudget.spent,
        committedToOtherOpenLots: 0,
        rosterSize: d.rosterSize,
        slotsFilled: myBudget.slotsFilled,
        minBid: d.minBid,
      })
    : 0;

  // Available players for nomination
  const ownedIds = await db
    .select({ id: rosters.realPlayerId })
    .from(rosters)
    .where(and(eq(rosters.leagueId, league.id), isNull(rosters.droppedAt)));
  const onLotIds = await db
    .select({ id: auctionLots.realPlayerId })
    .from(auctionLots)
    .where(and(eq(auctionLots.draftId, d.id), ne(auctionLots.status, "voided")));
  const excludedIds = [...ownedIds, ...onLotIds].map((r) => r.id);
  const playerFilter = q?.trim() ? `%${q.trim()}%` : null;

  const availablePlayersRaw = await db
    .select({
      id: realPlayers.id,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      countryName: countries.name,
      price: playerPrices.price,
      tier: playerPrices.tier,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(
      and(
        eq(realPlayers.isActive, true),
        excludedIds.length
          ? notInArray(realPlayers.id, excludedIds)
          : undefined,
        playerFilter
          ? sql`lower(${realPlayers.fullName}) like lower(${playerFilter})`
          : undefined
      )
    )
    .orderBy(desc(playerPrices.price))
    .limit(150);

  const availablePlayers: AvailablePlayer[] = availablePlayersRaw.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    position: p.position,
    countryName: p.countryName,
    price: p.price,
    tier: p.tier,
  }));

  const props: AuctionRoomProps = {
    userId: user.id,
    draft: {
      id: d.id,
      leagueId: d.leagueId,
      leagueName: league.name,
      status: d.status,
      budgetPerManager: d.budgetPerManager,
      rosterSize: d.rosterSize,
      rosterRequirements: d.rosterRequirements as Record<string, number>,
      minBid: d.minBid,
      incrementRules: d.incrementRules as Array<{
        threshold: number;
        inc: number;
      }>,
      bidSeconds: d.bidSeconds,
      currentNominatorProfileId: d.currentNominatorProfileId,
      currentLotId: d.currentLotId,
    },
    members,
    budgets,
    currentLot,
    recentBids,
    availablePlayers,
    myMaxBidNow,
    myProxyMax,
    searchQuery: q ?? "",
    bidError: bidError ?? null,
  };

  return <AuctionRoom {...props} />;
}
