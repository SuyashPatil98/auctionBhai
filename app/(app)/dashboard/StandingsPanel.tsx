"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { syncAllStandings } from "@/app/(app)/matchday/actions";

export type ManagerStanding = {
  profileId: string;
  displayName: string;
  teamEmoji: string | null;
  matchdayPoints: number;
  cumulativePoints: number;
};

export default function StandingsPanel({
  currentMatchday,
  standings,
  myProfileId,
  hasAnyScores,
}: {
  currentMatchday: number | null;
  standings: ManagerStanding[];
  myProfileId: string;
  hasAnyScores: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isPending, startTransition] = useTransition();
  const [report, setReport] = useState<{
    matchdays: number;
    managers: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Listen for matchday_scores changes so the panel ticks live
  useEffect(() => {
    const channel = supabase
      .channel("dashboard:standings")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matchday_scores",
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, router]);

  function handleSync() {
    setError(null);
    setReport(null);
    startTransition(() => {
      syncAllStandings()
        .then((r) => {
          setReport({
            matchdays: r.reports.length,
            managers: r.totalManagersScored,
          });
          router.refresh();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  const sorted = [...standings].sort(
    (a, b) => b.cumulativePoints - a.cumulativePoints
  );

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Standings
            {currentMatchday !== null && (
              <span className="ml-2 text-foreground normal-case font-normal tracking-normal">
                · MD {currentMatchday}
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {currentMatchday !== null && (
            <Link
              href={`/matchday/${currentMatchday}`}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              View MD {currentMatchday} →
            </Link>
          )}
          <button
            type="button"
            onClick={handleSync}
            disabled={isPending}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-semibold transition disabled:opacity-50"
            title="Recompute every matchday's standings from current stats + lineups + MOTM."
          >
            {isPending ? "Syncing…" : "↻ Sync standings"}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs text-destructive border border-destructive/30 rounded-md bg-destructive/5 px-2 py-1">
          {error}
        </p>
      )}
      {report && (
        <p className="text-xs text-emerald-700 dark:text-emerald-400">
          Synced {report.matchdays} matchday
          {report.matchdays === 1 ? "" : "s"} · {report.managers} manager-row
          {report.managers === 1 ? "" : "s"} updated.
        </p>
      )}

      {!hasAnyScores ? (
        <p className="text-sm text-muted-foreground italic">
          No scores yet. Standings appear once stewards finalize stats.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {sorted.map((m, idx) => {
            const rank = idx + 1;
            const isMe = m.profileId === myProfileId;
            return (
              <li
                key={m.profileId}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 ${
                  rank === 1
                    ? "bg-amber-500/10"
                    : isMe
                    ? "bg-emerald-500/10"
                    : ""
                }`}
              >
                <span className="w-5 text-center text-xs font-bold tabular-nums">
                  {rank === 1 ? "🏆" : `#${rank}`}
                </span>
                <span className="text-lg">{m.teamEmoji ?? "👤"}</span>
                <span className="flex-1 min-w-0 truncate text-sm">
                  {m.displayName}
                  {isMe && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      (you)
                    </span>
                  )}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  MD <strong className="text-foreground">{m.matchdayPoints.toFixed(1)}</strong>
                </span>
                <span className="text-sm font-bold tabular-nums w-14 text-right">
                  {m.cumulativePoints.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
