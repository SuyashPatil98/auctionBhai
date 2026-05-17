"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  placeBlindBid,
  resolveFreeAgentWindow,
  withdrawBid,
} from "./actions";

export type FreeAgent = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
  countryName: string;
  enginePrice: number | null;
  /** This user's current bid (undefined = no bid placed). */
  myBid: number | null;
  /** Number of other managers bidding (myself not included). Live. */
  otherBidsCount: number;
};

export type ResolutionRow = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  winnerProfileId: string | null;
  winnerName: string | null;
  winningAmount: number | null;
  biddersCount: number;
};

export default function FreeAgentPanel({
  available,
  freeAgents,
  resolutions,
  remainingBudget,
  canForceResolve,
  windowOpen,
  windowKey,
}: {
  available: boolean;
  freeAgents: FreeAgent[];
  resolutions: ResolutionRow[];
  remainingBudget: number;
  canForceResolve: boolean;
  windowOpen: boolean;
  windowKey: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [posFilter, setPosFilter] = useState<string>("");
  const [bidInputs, setBidInputs] = useState<Record<string, string>>({});
  const [report, setReport] = useState<{
    resolved: number;
    awarded: number;
  } | null>(null);

  const filtered = useMemo(() => {
    return freeAgents.filter((p) => {
      if (posFilter && p.position !== posFilter) return false;
      if (
        filter.trim() &&
        !p.displayName.toLowerCase().includes(filter.trim().toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [freeAgents, filter, posFilter]);

  function getBidValue(realPlayerId: string, defaultV: number): number {
    const raw = bidInputs[realPlayerId];
    if (raw === undefined) return defaultV;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : defaultV;
  }

  function handleBid(p: FreeAgent) {
    setError(null);
    const value = getBidValue(p.realPlayerId, p.enginePrice ?? 1);
    if (!Number.isFinite(value) || value < 1) {
      setError("bid must be a positive integer");
      return;
    }
    startTransition(() => {
      placeBlindBid(p.realPlayerId, value)
        .then(() => {
          router.refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleWithdraw(p: FreeAgent) {
    if (!confirm(`Withdraw your bid on ${p.displayName}?`)) return;
    setError(null);
    startTransition(() => {
      withdrawBid(p.realPlayerId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleResolve() {
    if (
      !confirm(
        "Close the window early and resolve all free-agent bids now? Highest bidder wins each player. This bypasses Tuesday 23:59 UTC auto-close."
      )
    ) {
      return;
    }
    setError(null);
    setReport(null);
    startTransition(() => {
      resolveFreeAgentWindow()
        .then((r) => {
          setReport({ resolved: r.resolved, awarded: r.awarded });
          router.refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  if (!available && resolutions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-4">
        <h3 className="text-sm font-semibold">Free-agent bids</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Trading window is closed. Submit blind bids during the next
          Tuesday window — auctions resolve at window close.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Free-agent bids</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Sealed-bid · highest amount wins · earliest bid breaks ties ·
            you can only see your own amount until resolution.
          </p>
        </div>
        {available && canForceResolve && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleResolve}
            className="rounded-md border border-border bg-card hover:bg-muted px-2.5 py-1 text-xs transition"
          >
            Resolve now (commissioner)
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Window <code>{windowKey}</code> · your remaining budget{" "}
        <strong className="text-foreground tabular-nums">
          {remainingBudget} cr
        </strong>
      </p>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {report && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Resolved {report.resolved} lot{report.resolved === 1 ? "" : "s"};
          awarded {report.awarded}.
        </div>
      )}

      {/* Filter row */}
      {available && (
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <input
            type="text"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-2.5 py-1 flex-1 min-w-[10rem]"
          />
          <select
            value={posFilter}
            onChange={(e) => setPosFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1"
          >
            <option value="">All positions</option>
            <option value="GK">GK</option>
            <option value="DEF">DEF</option>
            <option value="MID">MID</option>
            <option value="FWD">FWD</option>
          </select>
        </div>
      )}

      {/* Lot rows */}
      {available && (
        <ul className="divide-y divide-border/60 max-h-[28rem] overflow-y-auto">
          {filtered.slice(0, 100).map((p) => {
            const placeholder = p.enginePrice ?? 1;
            const inputVal = bidInputs[p.realPlayerId] ?? String(placeholder);
            return (
              <li
                key={p.realPlayerId}
                className="flex items-center gap-2 py-2"
              >
                {p.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.photoUrl}
                    alt=""
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-100">
                    {p.displayName.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {p.displayName}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {p.position} · {p.countryName}
                    {p.enginePrice !== null && (
                      <> · floor {p.enginePrice}</>
                    )}
                    {p.otherBidsCount > 0 && (
                      <>
                        {" · "}
                        <span className="text-amber-600 dark:text-amber-400">
                          {p.otherBidsCount} other bid
                          {p.otherBidsCount === 1 ? "" : "s"}
                        </span>
                      </>
                    )}
                  </p>
                </div>
                {p.myBid !== null ? (
                  <>
                    <span className="text-xs rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-1 tabular-nums">
                      Your bid: {p.myBid}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleWithdraw(p)}
                      disabled={isPending}
                      className="text-[10px] rounded-md border border-border bg-card hover:bg-muted px-2 py-1 transition shrink-0"
                    >
                      Withdraw
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      min={1}
                      max={remainingBudget}
                      value={inputVal}
                      onChange={(e) =>
                        setBidInputs((s) => ({
                          ...s,
                          [p.realPlayerId]: e.target.value,
                        }))
                      }
                      className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums text-right"
                      placeholder={String(placeholder)}
                    />
                    <button
                      type="button"
                      onClick={() => handleBid(p)}
                      disabled={isPending}
                      className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-semibold transition disabled:opacity-50 shrink-0"
                    >
                      Bid
                    </button>
                  </>
                )}
              </li>
            );
          })}
          {filtered.length > 100 && (
            <li className="py-2 text-xs text-center text-muted-foreground italic">
              + {filtered.length - 100} more — filter to narrow down
            </li>
          )}
          {filtered.length === 0 && (
            <li className="py-4 text-xs text-center text-muted-foreground italic">
              No matches.
            </li>
          )}
        </ul>
      )}

      {/* Resolutions */}
      {resolutions.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition">
            Last window&apos;s results ({resolutions.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {resolutions.map((r) => (
              <li
                key={r.realPlayerId}
                className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
              >
                <span className="font-medium truncate flex-1">
                  {r.displayName}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {r.position}
                </span>
                {r.winnerProfileId ? (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    → {r.winnerName} ({r.winningAmount} cr ·{" "}
                    {r.biddersCount} bidder{r.biddersCount === 1 ? "" : "s"})
                  </span>
                ) : (
                  <span className="text-muted-foreground italic">
                    No winner ({r.biddersCount} bidder
                    {r.biddersCount === 1 ? "" : "s"} couldn&apos;t afford)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
