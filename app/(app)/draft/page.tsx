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
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { maxBidNow, minNextBid } from "@/lib/auction/state";
import { nominate, placeBid, resolveExpired, startDraft } from "./actions";

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

  // Find league + draft. v1 = single league.
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    return (
      <Page>
        <SetupNotice msg="No league exists. Run `pnpm seed:league` to create one." />
      </Page>
    );
  }
  const [draft] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!draft) {
    return (
      <Page>
        <SetupNotice msg="No draft for this league. Run `pnpm seed:league`." />
      </Page>
    );
  }

  // Self-heal: finalize any expired lots before we render.
  if (draft.status === "live" && draft.currentLotId) {
    await resolveExpired(draft.id);
  }

  // Reload draft after potential mutation.
  const [d] = await db.select().from(drafts).where(eq(drafts.id, draft.id)).limit(1);

  // Members + budgets
  const members = await db
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

  const budgets = await db
    .select()
    .from(managerBudgets)
    .where(eq(managerBudgets.draftId, d.id));
  const budgetsByProfile = new Map(budgets.map((b) => [b.profileId, b]));

  // Current lot, if any
  let currentLot:
    | (typeof auctionLots.$inferSelect & {
        playerName: string;
        position: string;
        countryName: string;
        bidderName: string | null;
      })
    | null = null;
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
        ...row.lot,
        playerName: row.playerName,
        position: row.position,
        countryName: row.countryName,
        bidderName: bidder?.displayName ?? null,
      };
    }
  }

  // Recent bids on current lot
  const recentBids = currentLot
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

  // My state
  const isMember = members.some((m) => m.profileId === user.id);
  const isCurrentNominator = d.currentNominatorProfileId === user.id;
  const myBudget = budgetsByProfile.get(user.id);
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

  // Players available to nominate / bid on
  // - active, not already on a roster, not on a non-voided lot in this draft
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

  const availablePlayers = await db
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

  const minNext = currentLot
    ? minNextBid(
        currentLot.currentBid,
        d.incrementRules as Array<{ threshold: number; inc: number }>
      )
    : d.minBid;

  return (
    <Page>
      <Header draft={d} league={league} />

      {bidError && (
        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          Bid rejected: {bidError}
        </p>
      )}

      {/* Manager budgets */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Managers
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {members.map((m) => {
            const b = budgetsByProfile.get(m.profileId);
            const spent = b?.spent ?? 0;
            const slots = b?.slotsFilled ?? 0;
            const remaining = d.budgetPerManager - spent;
            const isMe = m.profileId === user.id;
            const isTurn = m.profileId === d.currentNominatorProfileId;
            return (
              <div
                key={m.profileId}
                className={`rounded-lg border p-3 ${
                  isTurn
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border bg-card"
                }`}
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {m.teamEmoji} {m.displayName}
                    {isMe && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </span>
                  {isTurn && (
                    <span className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Nominating
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">
                    {remaining}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {slots}/{d.rosterSize} slots
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${(remaining / d.budgetPerManager) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  spent {spent} / {d.budgetPerManager}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Current lot */}
      {d.status === "live" && currentLot && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            On the block · lot #{currentLot.lotNumber}
          </h2>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-2xl font-bold">{currentLot.playerName}</p>
                <p className="text-sm text-muted-foreground">
                  {currentLot.position} · {currentLot.countryName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Current bid
                </p>
                <p className="text-4xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {currentLot.currentBid}
                </p>
                {currentLot.bidderName && (
                  <p className="text-xs text-muted-foreground mt-1">
                    by {currentLot.bidderName}
                  </p>
                )}
              </div>
            </div>

            {currentLot.closesAt && (
              <p className="text-xs text-muted-foreground">
                Closes at{" "}
                {new Date(currentLot.closesAt).toLocaleTimeString()}
              </p>
            )}

            {isMember && (
              <form
                action={placeBid}
                className="flex flex-wrap items-end gap-2 pt-2 border-t border-border"
              >
                <input
                  type="hidden"
                  name="lot_id"
                  value={currentLot.id}
                />
                <label className="flex flex-col">
                  <span className="text-xs text-muted-foreground mb-1">
                    Bid (min {minNext}, max {myMaxBidNow})
                  </span>
                  <input
                    type="number"
                    name="amount"
                    defaultValue={minNext}
                    min={minNext}
                    max={myMaxBidNow}
                    className="rounded-md border border-input bg-background px-3 py-1.5 w-32 tabular-nums"
                  />
                </label>
                <button
                  type="submit"
                  disabled={currentLot.currentBidderId === user.id}
                  className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  {currentLot.currentBidderId === user.id
                    ? "You're high"
                    : "Place bid"}
                </button>
              </form>
            )}
          </div>

          {recentBids.length > 0 && (
            <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-1.5">Time</th>
                    <th className="text-left px-3 py-1.5">Bidder</th>
                    <th className="text-right px-3 py-1.5">Amount</th>
                    <th className="text-left px-3 py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBids.map((b, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 text-muted-foreground tabular-nums">
                        {new Date(b.placedAt).toLocaleTimeString()}
                      </td>
                      <td className="px-3 py-1.5">{b.bidderName}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {b.amount}
                      </td>
                      <td className="px-3 py-1.5">
                        {b.accepted ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            ✓
                          </span>
                        ) : (
                          <span
                            className="text-destructive"
                            title={b.rejectionReason ?? ""}
                          >
                            ✗ {b.rejectionReason ?? "rejected"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Nominate form */}
      {d.status === "live" && !currentLot && isCurrentNominator && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            Your nomination
          </h2>
          <form
            action={nominate}
            className="rounded-2xl border border-border bg-card p-5 space-y-3"
          >
            <input type="hidden" name="draft_id" value={d.id} />
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <label className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-1">
                  Player (filtered by search above)
                </span>
                <select
                  name="real_player_id"
                  required
                  className="rounded-md border border-input bg-background px-3 py-1.5"
                >
                  {availablePlayers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName} · {p.position} · {p.countryName}
                      {p.price ? ` · ${p.price}cr` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-1">
                  Opening bid
                </span>
                <input
                  type="number"
                  name="opening_bid"
                  defaultValue={d.minBid}
                  min={d.minBid}
                  max={myMaxBidNow}
                  className="rounded-md border border-input bg-background px-3 py-1.5 w-24 tabular-nums"
                />
              </label>
              <button
                type="submit"
                className="self-end rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 transition"
              >
                Nominate
              </button>
            </div>
          </form>

          <form className="flex items-end gap-2 text-sm" method="get">
            <label className="flex flex-col flex-1">
              <span className="text-xs text-muted-foreground mb-1">
                Search players to nominate (refresh page after typing)
              </span>
              <input
                type="text"
                name="q"
                defaultValue={q ?? ""}
                placeholder="Mbappé, Rodri, …"
                className="rounded-md border border-input bg-background px-3 py-1.5"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted transition"
            >
              Filter
            </button>
          </form>
        </section>
      )}

      {d.status === "live" && !currentLot && !isCurrentNominator && (
        <section className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Waiting for{" "}
          <span className="font-medium text-foreground">
            {members.find(
              (m) => m.profileId === d.currentNominatorProfileId
            )?.displayName ?? "next nominator"}
          </span>{" "}
          to pick a player…
        </section>
      )}

      {/* Start draft */}
      {d.status === "scheduled" && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Draft hasn't started yet</h2>
          <p className="text-sm text-muted-foreground">
            {members.length} manager(s) in the league. Click below to start when
            everyone's ready.
          </p>
          <form action={startDraftAction}>
            <input type="hidden" name="draft_id" value={d.id} />
            <button
              type="submit"
              disabled={members.length < 2}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Start draft
            </button>
          </form>
          {members.length < 2 && (
            <p className="text-xs text-muted-foreground">
              Need at least 2 managers to start.
            </p>
          )}
        </section>
      )}

      {d.status === "complete" && (
        <section className="rounded-lg border border-border bg-card p-6 text-center">
          <h2 className="text-lg font-semibold">Draft complete 🎉</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Every manager has filled their roster. Visit{" "}
            <a href="/team" className="underline">
              /team
            </a>{" "}
            to set your lineup.
          </p>
        </section>
      )}
    </Page>
  );
}

async function startDraftAction(formData: FormData) {
  "use server";
  const id = String(formData.get("draft_id") ?? "");
  if (!id) return;
  await startDraft(id);
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

function Header({
  draft,
  league,
}: {
  draft: typeof drafts.$inferSelect;
  league: typeof leagues.$inferSelect;
}) {
  const status = draft.status;
  const pill: Record<string, string> = {
    scheduled: "bg-muted text-muted-foreground",
    live: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    paused: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    complete: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  };
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Draft</h1>
        <p className="text-sm text-muted-foreground">{league.name}</p>
      </div>
      <span
        className={`text-xs uppercase tracking-wider font-medium px-2 py-1 rounded ${pill[status]}`}
      >
        {status}
      </span>
    </div>
  );
}

function SetupNotice({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground">
      {msg}
    </div>
  );
}
