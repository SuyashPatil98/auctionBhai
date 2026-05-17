import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  drafts,
  fixtures,
  leagues,
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
  type WindowState,
} from "@/lib/trading/window";
import type { Position } from "@/lib/scoring/points";

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

  // My squad
  const myRoster = await db
    .select({
      realPlayerId: rosters.realPlayerId,
      position: realPlayers.position,
      displayName: realPlayers.displayName,
      photoUrl: realPlayers.photoUrl,
      acquiredAmount: rosters.acquiredAmount,
    })
    .from(rosters)
    .innerJoin(realPlayers, eq(realPlayers.id, rosters.realPlayerId))
    .where(
      and(
        eq(rosters.leagueId, league.id),
        eq(rosters.profileId, user.id),
        isNull(rosters.droppedAt)
      )
    )
    .orderBy(asc(realPlayers.position), asc(realPlayers.displayName));

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

      <div className="grid gap-4 sm:grid-cols-3">
        <PlaceholderCard
          title="Sell to market"
          subtitle="Get 50% credit back. Player re-lists at engine price for everyone to bid on."
          available={windowState.isOpen}
        />
        <PlaceholderCard
          title="Free-agent bids"
          subtitle="Sealed-bid auction. Submit a max for any unowned player; resolves at window close."
          available={windowState.isOpen}
        />
        <PlaceholderCard
          title="Trade with manager"
          subtitle="Player-for-player + credit balance. Mutual accept. 2 trades per window."
          available={windowState.isOpen}
        />
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Sell-back / free-agent / trade UIs land as 5.9 → 5.10 → 5.11. This
        page becomes the activity hub for the window.
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
