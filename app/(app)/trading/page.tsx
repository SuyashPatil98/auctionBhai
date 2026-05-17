import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, count, desc, eq, isNull, ne, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  countries,
  drafts,
  fixtures,
  freeAgentBids,
  freeAgentResolutions,
  leagues,
  managerBudgets,
  playerPrices,
  profiles,
  realPlayers,
  rosters,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfileTimezone } from "@/lib/util/current-profile";
import { Kickoff } from "@/components/Kickoff";
import {
  composition,
  validateComposition,
  type RosterComposition,
} from "@/lib/trading/quota";
import {
  computeWindowState,
  windowKeyFor,
  type WindowState,
} from "@/lib/trading/window";
import type { Position } from "@/lib/scoring/points";
import SellPanel, { type SellablePlayer } from "./SellPanel";
import FreeAgentPanel, {
  type FreeAgent,
  type ResolutionRow,
} from "./FreeAgentPanel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Trading · FiFantasy" };

export default async function TradingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tz = await getCurrentProfileTimezone();
  const [league] = await db.select().from(leagues).limit(1);
  if (!league) {
    return (
      <div className="space-y-3 max-w-xl">
        <h1 className="text-2xl font-semibold">Trading</h1>
        <p className="text-sm text-muted-foreground">No league configured.</p>
      </div>
    );
  }

  const [draft] = await db
    .select({
      rosterRequirements: drafts.rosterRequirements,
      rosterSize: drafts.rosterSize,
    })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);

  const quota = (draft?.rosterRequirements ?? {
    GK: 2,
    DEF: 5,
    MID: 5,
    FWD: 4,
  }) as RosterComposition;

  // Knockout cutoff = first R32 fixture's kickoff
  const [knockoutFx] = await db
    .select({ kickoffAt: fixtures.kickoffAt })
    .from(fixtures)
    .where(eq(fixtures.stage, "r32"))
    .orderBy(asc(fixtures.kickoffAt))
    .limit(1);
  const knockoutCutoff = knockoutFx?.kickoffAt
    ? knockoutFx.kickoffAt.getTime()
    : null;

  const now = Date.now();
  const windowState = computeWindowState(now, knockoutCutoff);

  // My squad — with country + engine price for the sell UI
  const myRoster = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      position: realPlayers.position,
      displayName: realPlayers.displayName,
      photoUrl: realPlayers.photoUrl,
      acquiredAmount: rosters.acquiredAmount,
      countryName: countries.name,
      enginePrice: playerPrices.price,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, user.id),
        isNull(rosters.droppedAt)
      )
    )
    .orderBy(asc(realPlayers.position), asc(realPlayers.displayName));

  const sellablePlayers: SellablePlayer[] = myRoster.map((p) => ({
    realPlayerId: p.realPlayerId,
    displayName: p.displayName,
    position: p.position as Position,
    photoUrl: p.photoUrl,
    countryName: p.countryName,
    acquiredAmount: p.acquiredAmount,
    enginePrice: p.enginePrice,
  }));

  // -- Free-agent panel data ----------------------------------------------
  const windowKey = windowKeyFor(windowState.opensAt);

  // All currently-unowned players (no active roster row).
  const ownedIdsRows = await db
    .select({ id: rosters.realPlayerId })
    .from(rosters)
    .where(and(eq(rosters.leagueId, league.id), isNull(rosters.droppedAt)));
  const ownedIds = ownedIdsRows.map((r) => r.id);

  const freeAgentRows = await db
    .select({
      realPlayerId: realPlayers.id,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      photoUrl: realPlayers.photoUrl,
      countryName: countries.name,
      enginePrice: playerPrices.price,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(countries.id, realPlayers.countryId))
    .leftJoin(playerPrices, eq(playerPrices.realPlayerId, realPlayers.id))
    .where(
      and(
        eq(realPlayers.isActive, true),
        ownedIds.length ? notInArray(realPlayers.id, ownedIds) : undefined
      )
    )
    .orderBy(desc(playerPrices.price))
    .limit(500);

  // My bids + others' counts for these players in the current window
  const myBidRows = await db
    .select({
      realPlayerId: freeAgentBids.realPlayerId,
      amount: freeAgentBids.amount,
    })
    .from(freeAgentBids)
    .where(
      and(
        eq(freeAgentBids.windowKey, windowKey),
        eq(freeAgentBids.profileId, user.id),
        isNull(freeAgentBids.withdrawnAt)
      )
    );
  const myBidByPlayer = new Map(
    myBidRows.map((b) => [b.realPlayerId, b.amount])
  );

  const otherBidCountRows = (await db.execute(sql`
    select real_player_id as "realPlayerId", count(*)::int as "n"
    from free_agent_bids
    where window_key = ${windowKey}
      and withdrawn_at is null
      and profile_id <> ${user.id}
    group by real_player_id
  `)) as unknown as Array<{ realPlayerId: string; n: number }>;
  const otherCountByPlayer = new Map(
    otherBidCountRows.map((r) => [r.realPlayerId, r.n])
  );

  const freeAgents: FreeAgent[] = freeAgentRows.map((p) => ({
    realPlayerId: p.realPlayerId,
    displayName: p.displayName,
    position: p.position as Position,
    photoUrl: p.photoUrl,
    countryName: p.countryName,
    enginePrice: p.enginePrice,
    myBid: myBidByPlayer.get(p.realPlayerId) ?? null,
    otherBidsCount: otherCountByPlayer.get(p.realPlayerId) ?? 0,
  }));

  // Most-recent resolved window (might be the current one if commissioner
  // already force-resolved, or a prior one).
  const recentResolutions = await db
    .select({
      realPlayerId: freeAgentResolutions.realPlayerId,
      windowKey: freeAgentResolutions.windowKey,
      winnerProfileId: freeAgentResolutions.winnerProfileId,
      winningAmount: freeAgentResolutions.winningAmount,
      biddersCount: freeAgentResolutions.biddersCount,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      winnerName: profiles.displayName,
    })
    .from(freeAgentResolutions)
    .innerJoin(
      realPlayers,
      eq(realPlayers.id, freeAgentResolutions.realPlayerId)
    )
    .leftJoin(
      profiles,
      eq(profiles.id, freeAgentResolutions.winnerProfileId)
    )
    .orderBy(desc(freeAgentResolutions.resolvedAt))
    .limit(30);

  const resolutions: ResolutionRow[] = recentResolutions.map((r) => ({
    realPlayerId: r.realPlayerId,
    displayName: r.displayName,
    position: r.position as Position,
    winnerProfileId: r.winnerProfileId,
    winnerName: r.winnerName,
    winningAmount: r.winningAmount,
    biddersCount: r.biddersCount,
  }));

  // Commissioner check + budget remaining
  const [me] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const isCommissioner = me?.role === "commissioner";

  const [draftFull] = await db
    .select({ budgetPerManager: drafts.budgetPerManager, id: drafts.id })
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  const [myBudget] = draftFull
    ? await db
        .select()
        .from(managerBudgets)
        .where(
          and(
            eq(managerBudgets.draftId, draftFull.id),
            eq(managerBudgets.profileId, user.id)
          )
        )
        .limit(1)
    : [];
  const remainingBudget =
    (draftFull?.budgetPerManager ?? 500) - (myBudget?.spent ?? 0);

  const myComposition = composition(
    myRoster.map((p) => ({ position: p.position as Position }))
  );
  const violations = validateComposition(
    myRoster.map((p) => ({ position: p.position as Position })),
    quota
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Trading window
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Sell players, bid on free agents, or trade with another manager.
          Every Tuesday 00:00–23:59 UTC. Locked the rest of the week.
        </p>
      </div>

      <WindowStatusCard state={windowState} tz={tz} />

      <section className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Your squad — {myRoster.length}/{draft?.rosterSize ?? 16}
        </h2>
        <CompositionGrid composition={myComposition} quota={quota} />
        {violations.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            Composition off-spec ({violations.length} issue
            {violations.length === 1 ? "" : "s"}). Sell/buy actions will
            refuse any mutation that doesn&apos;t bring you back to{" "}
            <code>
              {Object.entries(quota)
                .map(([k, v]) => `${k}:${v}`)
                .join(" ")}
            </code>
            .
          </div>
        )}
      </section>

      <SellPanel
        players={sellablePlayers}
        available={windowState.isOpen && !windowState.knockoutCutoffPassed}
      />

      <FreeAgentPanel
        available={windowState.isOpen && !windowState.knockoutCutoffPassed}
        freeAgents={freeAgents}
        resolutions={resolutions}
        remainingBudget={remainingBudget}
        canForceResolve={isCommissioner}
        windowOpen={windowState.isOpen}
        windowKey={windowKey}
      />

      <div className="grid gap-4 sm:grid-cols-1">
        <PlaceholderCard
          title="Trade with manager"
          subtitle="Player-for-player + credit balance. Mutual accept. 2 trades per window."
          available={windowState.isOpen}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Trade UI lands as 5.11.
      </p>
    </div>
  );
}

function WindowStatusCard({
  state,
  tz,
}: {
  state: WindowState;
  tz: string | null;
}) {
  if (state.knockoutCutoffPassed) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm">
          🔒 <strong>Trading frozen</strong> — knockout stage has begun.
          Squads are locked for the rest of the tournament.
        </p>
      </div>
    );
  }
  return (
    <div
      className={`rounded-xl border p-4 ${
        state.isOpen
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold">
            {state.isOpen ? (
              <>
                <span className="text-emerald-600 dark:text-emerald-400">
                  Window open
                </span>{" "}
                · closes{" "}
                <Kickoff at={new Date(state.closesAt).toISOString()} tz={tz} />
              </>
            ) : (
              <>
                <span className="text-muted-foreground">Window closed</span>{" "}
                · opens{" "}
                <Kickoff at={new Date(state.opensAt).toISOString()} tz={tz} />
              </>
            )}
          </p>
        </div>
        {!state.isOpen && (
          <CountdownChip msAway={state.opensAt - Date.now()} />
        )}
      </div>
    </div>
  );
}

function CountdownChip({ msAway }: { msAway: number }) {
  const total = Math.max(0, msAway);
  const days = Math.floor(total / (24 * 60 * 60 * 1000));
  const hours = Math.floor((total % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const mins = Math.floor((total % (60 * 60 * 1000)) / (60 * 1000));
  return (
    <span className="text-xs rounded-md bg-muted px-2.5 py-1 tabular-nums">
      {days > 0 && `${days}d `}
      {hours}h {mins}m
    </span>
  );
}

function CompositionGrid({
  composition,
  quota,
}: {
  composition: RosterComposition;
  quota: RosterComposition;
}) {
  const POSITIONS: Position[] = ["GK", "DEF", "MID", "FWD"];
  return (
    <div className="grid grid-cols-4 gap-2">
      {POSITIONS.map((pos) => {
        const got = composition[pos];
        const need = quota[pos];
        const ok = got === need;
        return (
          <div
            key={pos}
            className={`rounded-lg border p-3 ${
              ok ? "border-border" : "border-amber-500/40 bg-amber-500/5"
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {pos}
            </p>
            <p className="text-xl font-bold tabular-nums">
              {got}
              <span className="text-sm text-muted-foreground">/{need}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function PlaceholderCard({
  title,
  subtitle,
  available,
}: {
  title: string;
  subtitle: string;
  available: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 space-y-2 ${
        available
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-dashed border-border bg-card/50"
      }`}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {available ? "Coming soon · UI lands in next phase" : "Window closed"}
      </p>
    </div>
  );
}
