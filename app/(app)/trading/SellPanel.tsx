"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sellPlayer } from "./actions";

export type SellablePlayer = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
  countryName: string;
  acquiredAmount: number | null;
  enginePrice: number | null;
};

export default function SellPanel({
  players,
  available,
}: {
  players: SellablePlayer[];
  available: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lastSold, setLastSold] = useState<{
    name: string;
    refund: number;
  } | null>(null);

  function handleSell(p: SellablePlayer) {
    const paid = p.acquiredAmount ?? 0;
    const refund = Math.floor(paid / 2);
    if (
      !confirm(
        `Sell ${p.displayName} for ${refund} cr refund (50% of ${paid} you paid)?\n\n` +
          `The player goes back into the free-agent pool at ${
            p.enginePrice ?? "engine"
          } cr floor. ` +
          `You'll need to buy a replacement ${p.position} before the window closes.`
      )
    ) {
      return;
    }
    setError(null);
    setLastSold(null);
    startTransition(() => {
      sellPlayer(p.realPlayerId)
        .then((res) => {
          setLastSold({ name: p.displayName, refund: res.refund });
          router.refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  if (!available) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-4">
        <h3 className="text-sm font-semibold">Sell to market</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Trading window is closed. Sell-back unlocks when the window
          opens (every Tuesday 00:00 UTC).
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Sell to market</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Receive 50% of what you paid as credit. Player re-enters the
          free-agent pool at their engine price for anyone (including
          you) to bid on.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      {lastSold && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          Sold {lastSold.name} · +{lastSold.refund} cr refunded.
        </div>
      )}

      {players.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          You don&apos;t own any players yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {players.map((p) => {
            const paid = p.acquiredAmount ?? 0;
            const refund = Math.floor(paid / 2);
            return (
              <li
                key={p.realPlayerId}
                className="flex items-center gap-3 py-2"
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
                  </p>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-xs text-muted-foreground tabular-nums">
                    paid {paid} · floor{" "}
                    {p.enginePrice !== null ? p.enginePrice : "—"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isPending || paid === 0}
                  onClick={() => handleSell(p)}
                  className="rounded-md bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed tabular-nums shrink-0"
                  title={
                    paid === 0
                      ? "Free-agent picks have no refund value"
                      : `Sell for ${refund} cr`
                  }
                >
                  Sell {refund > 0 ? `+${refund}cr` : ""}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
