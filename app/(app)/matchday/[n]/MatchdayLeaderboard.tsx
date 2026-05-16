"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Kickoff } from "@/components/Kickoff";

export type FixtureBreakdown = {
  fixtureId: string;
  stage: string;
  base: number;
  captainMultiplier: number;
  stageMultiplier: number;
  total: number;
  breakdown: Array<{ label: string; points: number }>;
};

export type SlotBreakdown = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
  slotPosition: "GK" | "DEF" | "MID" | "FWD";
  fromBench: boolean;
  role: "captain" | "vice_promoted" | "none";
  total: number;
  fixtureBreakdowns: FixtureBreakdown[];
};

export type LeaderboardManager = {
  profileId: string;
  displayName: string;
  teamName: string | null;
  teamEmoji: string | null;
  total: number;
  captainPlayed: boolean | null;
  computedAt: string | null;
  slots: SlotBreakdown[];
};

export default function MatchdayLeaderboard({
  matchday,
  leaderboard,
  myProfileId,
  lockTime,
  tz,
}: {
  matchday: number;
  leaderboard: LeaderboardManager[];
  myProfileId: string;
  lockTime: string | null;
  tz: string | null;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel(`matchday:${matchday}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matchday_scores",
          filter: `matchday=eq.${matchday}`,
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "player_match_stats",
        },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "motm_votes",
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [matchday, supabase, router]);

  const anyScores = leaderboard.some((m) => m.total !== 0 || m.slots.length > 0);

  return (
    <div className="space-y-4">
      {!anyScores && (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No scores yet for this matchday.{" "}
          {lockTime && (
            <>
              Lineups lock at <Kickoff at={lockTime} tz={tz} /> .
            </>
          )}
          {" "}
          Points appear as stewards finalize stats and MOTM resolves.
        </div>
      )}

      <ol className="space-y-3">
        {leaderboard.map((m, idx) => {
          const rank = idx + 1;
          const isMe = m.profileId === myProfileId;
          const isOpen = expanded === m.profileId;
          return (
            <li key={m.profileId}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : m.profileId)}
                disabled={m.slots.length === 0}
                className={`w-full flex items-center gap-3 rounded-xl border p-3 transition ${
                  rank === 1 && m.total > 0
                    ? "border-amber-500/40 bg-amber-500/5"
                    : isMe
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-card hover:bg-card/80"
                }`}
              >
                <div className="w-7 text-center text-sm font-bold tabular-nums">
                  {rank === 1 && m.total > 0 ? "🏆" : `#${rank}`}
                </div>
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-xl ring-2 ring-border shrink-0">
                  {m.teamEmoji ?? "👤"}
                </div>
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-medium truncate">
                    {m.displayName}
                    {isMe && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        (you)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {m.teamName ?? <span className="italic">no team name</span>}
                    {m.captainPlayed === false && (
                      <>
                        {" · "}
                        <span className="text-amber-600 dark:text-amber-400">
                          vice promoted
                        </span>
                      </>
                    )}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-bold tabular-nums">
                    {m.total.toFixed(1)}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    pts
                  </div>
                </div>
                {m.slots.length > 0 && (
                  <span
                    className={`text-xs text-muted-foreground transition ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  >
                    ▼
                  </span>
                )}
              </button>

              {isOpen && m.slots.length > 0 && (
                <div className="mt-2 rounded-lg border border-border bg-card/50 p-3 space-y-2">
                  <BreakdownTable slots={m.slots} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-muted-foreground text-center">
        Standings push live via Supabase Realtime · no refresh needed
      </p>
    </div>
  );
}

function BreakdownTable({ slots }: { slots: SlotBreakdown[] }) {
  const active = slots.filter((s) => !s.fromBench || s.role !== "none" || s.total > 0);
  const bench = slots.filter((s) => s.fromBench && s.role === "none" && s.total === 0);
  return (
    <div className="space-y-2">
      {active.map((s) => (
        <SlotRow key={s.realPlayerId} slot={s} />
      ))}
      {bench.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Unused bench ({bench.length})
          </summary>
          <div className="mt-2 space-y-2">
            {bench.map((s) => (
              <SlotRow key={s.realPlayerId} slot={s} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SlotRow({ slot }: { slot: SlotBreakdown }) {
  const ROLE_BADGE: Record<SlotBreakdown["role"], string | null> = {
    captain: "C ×2",
    vice_promoted: "V ×1.5",
    none: null,
  };
  return (
    <div className="flex items-start gap-2 text-xs">
      {slot.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={slot.photoUrl}
          alt=""
          className="w-7 h-7 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center text-[10px] font-semibold text-zinc-100 shrink-0">
          {slot.displayName.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/players/${slot.realPlayerId}`}
            className="font-medium truncate hover:underline"
          >
            {slot.displayName}
          </Link>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {slot.position}
          </span>
          {slot.fromBench && (
            <span className="text-[9px] rounded bg-zinc-500/15 px-1 py-0.5 text-muted-foreground">
              SUB
            </span>
          )}
          {ROLE_BADGE[slot.role] && (
            <span className="text-[9px] rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 px-1 py-0.5 font-semibold">
              {ROLE_BADGE[slot.role]}
            </span>
          )}
        </div>
        {slot.fixtureBreakdowns.map((fb, i) => (
          <div key={i} className="text-[10px] text-muted-foreground">
            {fb.breakdown.length === 0 ? (
              <span className="italic">DNP</span>
            ) : (
              fb.breakdown
                .map((b) => `${b.points >= 0 ? "+" : ""}${b.points} ${b.label}`)
                .join(" · ")
            )}
            {fb.stageMultiplier !== 1 && (
              <span> · stage ×{fb.stageMultiplier}</span>
            )}
          </div>
        ))}
      </div>
      <div className="text-right shrink-0 tabular-nums font-semibold">
        {slot.total.toFixed(1)}
      </div>
    </div>
  );
}
