"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { castMotmVote, clearMotmVote, forceResolveMotm } from "./actions";

export type Candidate = {
  realPlayerId: string;
  displayName: string;
  side: "home" | "away";
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
  countryFlag: string | null;
  minutes: number;
  goals: number;
  assists: number;
  isMotmWinner: boolean;
};

export type Voter = {
  profileId: string;
  displayName: string;
  teamEmoji: string | null;
  candidateRealPlayerId: string | null;
};

export type MotmPanelProps = {
  fixtureId: string;
  homeName: string;
  awayName: string;
  candidates: Candidate[];
  voters: Voter[];
  myProfileId: string;
  myVoteRealPlayerId: string | null;
  isResolved: boolean;
  resolvedAt: string | null;
  isFinalized: boolean;
  finalizedAt: string | null;
  windowCloseAt: string | null;
  canForceResolve: boolean;
};

export default function MotmPanel(props: MotmPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Tally votes per candidate
  const voteCount = new Map<string, number>();
  for (const v of props.voters) {
    if (!v.candidateRealPlayerId) continue;
    voteCount.set(
      v.candidateRealPlayerId,
      (voteCount.get(v.candidateRealPlayerId) ?? 0) + 1
    );
  }

  function handleVote(playerId: string) {
    if (props.isResolved) return;
    setError(null);
    startTransition(() => {
      castMotmVote(props.fixtureId, playerId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleClear() {
    setError(null);
    startTransition(() => {
      clearMotmVote(props.fixtureId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleForceResolve() {
    if (
      !confirm("Close MOTM voting now? Winners are determined by current tally.")
    )
      return;
    setError(null);
    startTransition(() => {
      forceResolveMotm(props.fixtureId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  // Not finalized yet
  if (!props.isFinalized) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center space-y-2">
        <p className="text-sm text-muted-foreground">
          MOTM voting opens once a steward finalizes the fixture&apos;s stats.
        </p>
      </div>
    );
  }

  const totalVotes = props.voters.filter((v) => v.candidateRealPlayerId).length;
  const totalVoters = props.voters.length;

  return (
    <div className="space-y-5">
      {/* Window status */}
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          {props.isResolved ? (
            <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-semibold">
              Closed
            </span>
          ) : (
            <span className="rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-semibold">
              Voting open
            </span>
          )}
          <span className="text-muted-foreground">
            {totalVotes}/{totalVoters} votes in
            {props.windowCloseAt && !props.isResolved && (
              <> · closes by {new Date(props.windowCloseAt).toLocaleString()}</>
            )}
          </span>
        </div>
        {!props.isResolved && props.canForceResolve && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleForceResolve}
            className="text-xs rounded-md border border-border bg-card hover:bg-muted px-2.5 py-1 transition"
          >
            Close voting now (commissioner)
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Voters strip */}
      <section className="space-y-1">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Votes cast
        </p>
        <div className="flex flex-wrap gap-2">
          {props.voters.map((v) => (
            <div
              key={v.profileId}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                v.candidateRealPlayerId
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-border bg-card"
              }`}
            >
              <span>{v.teamEmoji ?? "👤"}</span>
              <span className="font-medium">
                {v.displayName}
                {v.profileId === props.myProfileId && (
                  <span className="ml-1 text-muted-foreground">(you)</span>
                )}
              </span>
              {v.candidateRealPlayerId ? (
                <span className="text-emerald-600 dark:text-emerald-400">
                  ✓
                </span>
              ) : (
                <span className="text-muted-foreground">pending</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Candidates */}
      <section className="space-y-3">
        {(["home", "away"] as const).map((side) => (
          <SideBlock
            key={side}
            label={side === "home" ? props.homeName : props.awayName}
            candidates={props.candidates.filter((c) => c.side === side)}
            voteCount={voteCount}
            myVote={props.myVoteRealPlayerId}
            disabled={props.isResolved || isPending}
            onVote={handleVote}
            isResolved={props.isResolved}
          />
        ))}
      </section>

      {!props.isResolved && props.myVoteRealPlayerId && (
        <p className="text-center text-xs text-muted-foreground">
          Your vote is recorded.{" "}
          <button
            type="button"
            onClick={handleClear}
            disabled={isPending}
            className="underline-offset-2 hover:underline"
          >
            Withdraw vote
          </button>
        </p>
      )}
    </div>
  );
}

function SideBlock({
  label,
  candidates,
  voteCount,
  myVote,
  disabled,
  onVote,
  isResolved,
}: {
  label: string;
  candidates: Candidate[];
  voteCount: Map<string, number>;
  myVote: string | null;
  disabled: boolean;
  onVote: (id: string) => void;
  isResolved: boolean;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {candidates.map((c) => {
          const votes = voteCount.get(c.realPlayerId) ?? 0;
          const isMine = myVote === c.realPlayerId;
          const isWinner = isResolved && c.isMotmWinner;
          return (
            <button
              key={c.realPlayerId}
              type="button"
              onClick={() => onVote(c.realPlayerId)}
              disabled={disabled}
              className={`flex items-center gap-3 rounded-lg border p-2.5 text-left transition disabled:cursor-not-allowed ${
                isWinner
                  ? "border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30"
                  : isMine
                  ? "border-emerald-500/40 bg-emerald-500/10"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {c.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.photoUrl}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-semibold text-zinc-100">
                  {c.displayName.slice(0, 1)}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {c.displayName}
                  {isWinner && <span className="ml-1.5">🏆</span>}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {c.position} · {c.minutes}&apos;
                  {c.goals > 0 && (
                    <> · <span className="text-foreground">{c.goals}G</span></>
                  )}
                  {c.assists > 0 && (
                    <> · <span className="text-foreground">{c.assists}A</span></>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-bold tabular-nums">{votes}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {votes === 1 ? "vote" : "votes"}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
