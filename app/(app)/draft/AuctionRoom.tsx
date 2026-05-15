"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  nominate,
  passLot,
  placeBid,
  resolveExpired,
  setProxy,
  startDraft,
} from "./actions";

// ============================================================================
// Types — mirror what page.tsx fetches
// ============================================================================

export type Manager = {
  profileId: string;
  nominationOrder: number;
  displayName: string;
  teamName: string | null;
  teamEmoji: string | null;
};

export type Budget = {
  profileId: string;
  spent: number;
  committed: number;
  slotsFilled: number;
};

export type CurrentLot = {
  id: string;
  lotNumber: number;
  realPlayerId: string;
  openingBid: number;
  currentBid: number;
  currentBidderId: string | null;
  status: string;
  closesAt: string | null; // ISO
  playerName: string;
  position: string;
  countryName: string;
  bidderName: string | null;
} | null;

export type Bid = {
  amount: number;
  accepted: boolean;
  rejectionReason: string | null;
  placedAt: string; // ISO
  bidderName: string;
};

export type AvailablePlayer = {
  id: string;
  displayName: string;
  position: string;
  countryName: string;
  price: number | null;
  tier: string | null;
};

export type DraftState = {
  id: string;
  leagueId: string;
  leagueName: string;
  status: "scheduled" | "live" | "paused" | "complete";
  budgetPerManager: number;
  rosterSize: number;
  rosterRequirements: Record<string, number>;
  minBid: number;
  incrementRules: Array<{ threshold: number; inc: number }>;
  bidSeconds: number;
  currentNominatorProfileId: string | null;
  currentLotId: string | null;
};

export type AuctionRoomProps = {
  userId: string;
  draft: DraftState;
  members: Manager[];
  budgets: Budget[];
  currentLot: CurrentLot;
  recentBids: Bid[];
  availablePlayers: AvailablePlayer[];
  myMaxBidNow: number;
  myProxyMax: number | null;
  passedProfileIds: string[];
  searchQuery: string;
  bidError: string | null;
};

// ============================================================================
// Helpers
// ============================================================================

function nextIncrement(
  currentBid: number,
  rules: Array<{ threshold: number; inc: number }>
): number {
  let inc = 1;
  for (const r of rules) if (currentBid >= r.threshold) inc = r.inc;
  return inc;
}

function minNextBid(
  currentBid: number,
  rules: Array<{ threshold: number; inc: number }>
): number {
  return currentBid + nextIncrement(currentBid, rules);
}

// ============================================================================
// Main component
// ============================================================================

export default function AuctionRoom(props: AuctionRoomProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const tickFiredRef = useRef<string | null>(null); // lot id we already ticked

  // --- realtime subscription -----------------------------------------------
  useEffect(() => {
    const channel = supabase
      .channel(`draft:${props.draft.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_lots",
          filter: `draft_id=eq.${props.draft.id}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drafts",
          filter: `id=eq.${props.draft.id}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "auction_bids",
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "manager_budgets",
          filter: `draft_id=eq.${props.draft.id}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rosters",
          filter: `league_id=eq.${props.draft.leagueId}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_lot_passes",
        },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [props.draft.id, props.draft.leagueId, supabase, router]);

  // --- countdown timer -----------------------------------------------------
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!props.currentLot?.closesAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [props.currentLot?.closesAt]);

  const closesAtMs = props.currentLot?.closesAt
    ? new Date(props.currentLot.closesAt).getTime()
    : null;
  const secondsRemaining =
    closesAtMs !== null ? Math.max(0, (closesAtMs - now) / 1000) : null;

  // Auto-fire the server tick when timer hits 0 (only once per lot).
  // Don't fire when paused — the server pauses closes_at clock semantically.
  useEffect(() => {
    if (
      props.currentLot &&
      props.draft.status === "live" &&
      secondsRemaining !== null &&
      secondsRemaining <= 0 &&
      tickFiredRef.current !== props.currentLot.id
    ) {
      tickFiredRef.current = props.currentLot.id;
      void resolveExpired(props.draft.id).catch(() => {});
    }
  }, [secondsRemaining, props.currentLot, props.draft.id, props.draft.status]);

  // --- derived state -------------------------------------------------------
  const budgetByProfile = useMemo(
    () => new Map(props.budgets.map((b) => [b.profileId, b])),
    [props.budgets]
  );
  const passedSet = useMemo(
    () => new Set(props.passedProfileIds),
    [props.passedProfileIds]
  );
  const iHavePassed = passedSet.has(props.userId);
  const iAmHighBidder =
    props.currentLot?.currentBidderId === props.userId;
  const isCurrentNominator =
    props.draft.currentNominatorProfileId === props.userId;
  const isMember = props.members.some((m) => m.profileId === props.userId);
  const minNext = props.currentLot
    ? minNextBid(props.currentLot.currentBid, props.draft.incrementRules)
    : props.draft.minBid;

  return (
    <div className="space-y-6">
      <Header draft={props.draft} />

      {props.draft.status === "paused" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          <strong>⏸ Paused.</strong> Bidding is frozen until a commissioner
          resumes the draft.{" "}
          <a href="/draft/admin" className="underline">
            Admin →
          </a>
        </div>
      )}

      {props.bidError && (
        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          Bid rejected: {props.bidError}
        </p>
      )}

      {/* Manager budgets */}
      <section className="space-y-2">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Managers
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {props.members.map((m) => {
            const b = budgetByProfile.get(m.profileId);
            const spent = b?.spent ?? 0;
            const slots = b?.slotsFilled ?? 0;
            const remaining = props.draft.budgetPerManager - spent;
            const isMe = m.profileId === props.userId;
            const isTurn =
              m.profileId === props.draft.currentNominatorProfileId;
            const hasPassedThisLot = passedSet.has(m.profileId);
            return (
              <div
                key={m.profileId}
                className={`rounded-lg border p-3 transition ${
                  isTurn
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-border bg-card"
                } ${hasPassedThisLot ? "opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="font-medium truncate">
                    {m.teamEmoji} {m.displayName}
                    {isMe && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasPassedThisLot && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">
                        ⊘ passed
                      </span>
                    )}
                    {isTurn && (
                      <span className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                        Nominating
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">
                    {remaining}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {slots}/{props.draft.rosterSize} slots
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{
                      width: `${
                        (remaining / props.draft.budgetPerManager) * 100
                      }%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  spent {spent} / {props.draft.budgetPerManager}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Current lot — shown in live AND paused states (paused freezes the form) */}
      {(props.draft.status === "live" || props.draft.status === "paused") &&
        props.currentLot && (
        <section className="space-y-3">
          <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
            On the block · lot #{props.currentLot.lotNumber}
          </h2>
          <div className="rounded-2xl border border-border bg-card p-5 space-y-4 relative overflow-hidden">
            {/* Timer ribbon */}
            {secondsRemaining !== null && (
              <CountdownBar
                seconds={secondsRemaining}
                total={props.draft.bidSeconds}
              />
            )}

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-2xl font-bold">
                  {props.currentLot.playerName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {props.currentLot.position} · {props.currentLot.countryName}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Current bid
                </p>
                <p className="text-4xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {props.currentLot.currentBid}
                </p>
                {props.currentLot.bidderName && (
                  <p className="text-xs text-muted-foreground mt-1">
                    by {props.currentLot.bidderName}
                  </p>
                )}
              </div>
            </div>

            {secondsRemaining !== null && (
              <p className="text-sm tabular-nums">
                {props.draft.status === "paused" ? (
                  <span className="text-amber-600 dark:text-amber-400">
                    ⏸ paused
                  </span>
                ) : (
                  <CountdownText seconds={secondsRemaining} />
                )}
              </p>
            )}

            {isMember && props.draft.status === "live" && (
              <>
                {iHavePassed ? (
                  <div className="pt-2 border-t border-border text-sm text-muted-foreground">
                    ⊘ You passed on this lot. Waiting for the rest.
                  </div>
                ) : (
                  <>
                    <BidForm
                      lotId={props.currentLot.id}
                      minNext={minNext}
                      maxBid={props.myMaxBidNow}
                      isHighBidder={iAmHighBidder}
                    />
                    <ProxyForm
                      lotId={props.currentLot.id}
                      minNext={minNext}
                      maxBid={props.myMaxBidNow}
                      existingMax={props.myProxyMax}
                    />
                    {!iAmHighBidder && (
                      <PassButton
                        lotId={props.currentLot.id}
                        playerName={props.currentLot.playerName}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {props.recentBids.length > 0 && (
            <BidLog bids={props.recentBids} />
          )}
        </section>
        )}

      {/* Nominate form */}
      {props.draft.status === "live" &&
        !props.currentLot &&
        isCurrentNominator && (
          <NominateSection
            draftId={props.draft.id}
            minBid={props.draft.minBid}
            myMax={props.myMaxBidNow}
            availablePlayers={props.availablePlayers}
            searchQuery={props.searchQuery}
          />
        )}

      {props.draft.status === "live" &&
        !props.currentLot &&
        !isCurrentNominator && (
          <section className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Waiting for{" "}
            <span className="font-medium text-foreground">
              {props.members.find(
                (m) =>
                  m.profileId === props.draft.currentNominatorProfileId
              )?.displayName ?? "next nominator"}
            </span>{" "}
            to pick a player…
          </section>
        )}

      {/* Start draft */}
      {props.draft.status === "scheduled" && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="font-semibold">Draft hasn&apos;t started yet</h2>
          <p className="text-sm text-muted-foreground">
            {props.members.length} manager(s) in the league. Click below to
            start when everyone&apos;s ready.
          </p>
          <form
            action={async () => {
              await startDraft(props.draft.id);
            }}
          >
            <button
              type="submit"
              disabled={props.members.length < 2}
              className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Start draft
            </button>
          </form>
          {props.members.length < 2 && (
            <p className="text-xs text-muted-foreground">
              Need at least 2 managers to start.
            </p>
          )}
        </section>
      )}

      {props.draft.status === "complete" && (
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
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function Header({ draft }: { draft: DraftState }) {
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
        <p className="text-sm text-muted-foreground">{draft.leagueName}</p>
      </div>
      <div className="flex items-center gap-3">
        <a
          href="/draft/admin"
          className="text-xs text-muted-foreground hover:text-foreground transition underline"
        >
          Admin
        </a>
        <span
          className={`text-xs uppercase tracking-wider font-medium px-2 py-1 rounded ${pill[draft.status]}`}
        >
          {draft.status}
        </span>
      </div>
    </div>
  );
}

function CountdownBar({
  seconds,
  total,
}: {
  seconds: number;
  total: number;
}) {
  // Visual urgency: green > yellow > red as time runs out. `total` is the
  // draft's bidSeconds (currently 45) so the bar scales correctly.
  const pct = Math.max(0, Math.min(100, (seconds / total) * 100));
  const color =
    seconds <= 3
      ? "bg-red-500"
      : seconds <= 10
      ? "bg-amber-500"
      : "bg-emerald-500";
  return (
    <div className="absolute top-0 left-0 right-0 h-1 bg-muted/40">
      <div
        className={`h-full transition-all duration-200 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function CountdownText({ seconds }: { seconds: number }) {
  if (seconds <= 0)
    return <span className="text-muted-foreground">finalizing…</span>;
  const tone =
    seconds <= 3
      ? "text-red-600 dark:text-red-400 font-bold animate-pulse"
      : seconds <= 8
      ? "text-amber-600 dark:text-amber-400 font-semibold"
      : "text-muted-foreground";
  return (
    <span className={tone}>
      ⏱ {Math.ceil(seconds)}s
    </span>
  );
}

function BidForm({
  lotId,
  minNext,
  maxBid,
  isHighBidder,
}: {
  lotId: string;
  minNext: number;
  maxBid: number;
  isHighBidder: boolean;
}) {
  const [amount, setAmount] = useState(minNext);
  const [isPending, startTransition] = useTransition();

  // When the lot's minNext changes (server pushed a bid), bump our input
  // to keep it valid.
  useEffect(() => {
    setAmount((prev) => Math.max(minNext, prev));
  }, [minNext]);

  const disabled =
    isHighBidder || amount < minNext || amount > maxBid || isPending;

  return (
    <form
      action={(formData) => {
        // Optimistic UX: disable + show "bidding…" instantly via useTransition,
        // so the user sees feedback during the ~300–800ms server roundtrip.
        // Server is still authoritative — if rejected, page re-renders with
        // bidError set and this transition unwinds.
        startTransition(() => {
          placeBid(formData);
        });
      }}
      className="flex flex-wrap items-end gap-2 pt-2 border-t border-border"
    >
      <input type="hidden" name="lot_id" value={lotId} />
      <label className="flex flex-col">
        <span className="text-xs text-muted-foreground mb-1">
          Bid (min {minNext}, max {maxBid})
        </span>
        <input
          type="number"
          name="amount"
          value={amount}
          min={minNext}
          max={maxBid}
          disabled={isPending}
          onChange={(e) =>
            setAmount(Number.parseInt(e.target.value, 10) || minNext)
          }
          className="rounded-md border border-input bg-background px-3 py-1.5 w-32 tabular-nums disabled:opacity-50"
        />
      </label>
      <QuickBids
        current={amount}
        minNext={minNext}
        maxBid={maxBid}
        onSet={setAmount}
        disabled={isPending}
      />
      <button
        type="submit"
        disabled={disabled}
        className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition min-w-[100px]"
      >
        {isPending
          ? "Bidding…"
          : isHighBidder
          ? "You're high"
          : `Bid ${amount}`}
      </button>
    </form>
  );
}

function QuickBids({
  current,
  minNext,
  maxBid,
  onSet,
  disabled,
}: {
  current: number;
  minNext: number;
  maxBid: number;
  onSet: (n: number) => void;
  disabled?: boolean;
}) {
  const bumps = [1, 5, 10];
  return (
    <div className="flex items-end gap-1">
      {bumps.map((b) => {
        const target = Math.min(maxBid, Math.max(minNext, current + b));
        return (
          <button
            key={b}
            type="button"
            onClick={() => onSet(target)}
            disabled={disabled || target > maxBid}
            className="rounded border border-border bg-background px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-30 transition"
          >
            +{b}
          </button>
        );
      })}
      <button
        type="button"
        onClick={() => onSet(maxBid)}
        disabled={disabled || maxBid <= current}
        className="rounded border border-border bg-background px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-30 transition"
      >
        MAX
      </button>
    </div>
  );
}

function ProxyForm({
  lotId,
  minNext,
  maxBid,
  existingMax,
}: {
  lotId: string;
  minNext: number;
  maxBid: number;
  existingMax: number | null;
}) {
  const [value, setValue] = useState(
    existingMax ?? Math.min(maxBid, minNext + 10)
  );

  return (
    <div className="rounded-md border border-sky-500/40 bg-sky-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-sky-700 dark:text-sky-300">
          🛡️ Set a max bid — never miss out on a slow connection
        </p>
        {existingMax !== null && (
          <span className="text-xs tabular-nums text-sky-700 dark:text-sky-300">
            active: up to {existingMax}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        The server auto-bids the minimum needed to keep you on top, up to your
        max. Immune to your network — recommended for every player you really
        want.
      </p>
      <form
        action={setProxy}
        className="flex flex-wrap items-end gap-2 text-xs"
      >
        <input type="hidden" name="lot_id" value={lotId} />
        <label className="flex flex-col">
          <span className="text-muted-foreground mb-1">My max bid</span>
          <input
            type="number"
            name="max_amount"
            value={value}
            min={minNext}
            max={maxBid}
            onChange={(e) =>
              setValue(Number.parseInt(e.target.value, 10) || minNext)
            }
            className="rounded-md border border-input bg-background px-2 py-1 w-28 tabular-nums"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 px-3 py-1.5 hover:bg-sky-500/20 transition font-medium"
        >
          {existingMax !== null ? "Update max" : "Set max"}
        </button>
      </form>
    </div>
  );
}

function PassButton({
  lotId,
  playerName,
}: {
  lotId: string;
  playerName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <div className="pt-2">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-xs text-muted-foreground hover:text-destructive underline transition"
        >
          ⊘ Pass on this lot
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
      <p className="text-sm font-medium">
        Pass on <span className="font-semibold">{playerName}</span>?
      </p>
      <p className="text-xs text-muted-foreground">
        Passing is <strong>final</strong> for this lot — you won&apos;t be able
        to bid on this player again. Any max-bid you&apos;ve set will be
        cancelled. If everyone else passes, the lot closes immediately.
      </p>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(() => {
              passLot(lotId);
            })
          }
          className="rounded-md bg-destructive text-destructive-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 disabled:opacity-40 transition"
        >
          {isPending ? "Passing…" : "Yes, pass"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(false)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function BidLog({ bids }: { bids: Bid[] }) {
  return (
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
          {bids.map((b, i) => (
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
  );
}

function NominateSection({
  draftId,
  minBid,
  myMax,
  availablePlayers,
  searchQuery,
}: {
  draftId: string;
  minBid: number;
  myMax: number;
  availablePlayers: AvailablePlayer[];
  searchQuery: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
        Your nomination
      </h2>
      <form
        action={nominate}
        className="rounded-2xl border border-border bg-card p-5 space-y-3"
      >
        <input type="hidden" name="draft_id" value={draftId} />
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <label className="flex flex-col">
            <span className="text-xs text-muted-foreground mb-1">
              Player {searchQuery ? `(filtered "${searchQuery}")` : ""}
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
              defaultValue={minBid}
              min={minBid}
              max={myMax}
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
            Search players (typing applies on submit)
          </span>
          <input
            type="text"
            name="q"
            defaultValue={searchQuery}
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
  );
}
