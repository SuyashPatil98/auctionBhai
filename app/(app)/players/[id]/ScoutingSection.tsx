"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyProfileToPlayer,
  unratePlayer,
} from "../../scouting/actions";

export type LeagueRating = {
  managerName: string;
  managerEmoji: string | null;
  isMe: boolean;
  score: number | null; // null if this manager hasn't rated
  coverageCount: number | null;
  totalFactors: number | null;
  sourceProfileName: string | null;
};

export type MyProfileOption = {
  id: string;
  name: string;
  factorCount: number;
  importantCount: number;
};

export type ScoutingSectionProps = {
  playerId: string;
  playerName: string;
  consensus: number | null;
  locked: boolean;
  lockReason: string | null;
  isMember: boolean;
  myProfiles: MyProfileOption[];
  myCurrentRating: {
    score: number;
    coverageCount: number;
    totalFactors: number;
    sourceProfileId: string | null;
  } | null;
  leagueRatings: LeagueRating[];
};

export default function ScoutingSection(props: ScoutingSectionProps) {
  const router = useRouter();
  const [selectedProfile, setSelectedProfile] = useState<string>(
    props.myCurrentRating?.sourceProfileId ?? props.myProfiles[0]?.id ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const disabled = !props.isMember || props.locked || isPending;
  const hasProfiles = props.myProfiles.length > 0;

  function handleApply() {
    if (!selectedProfile) {
      setError("Pick a profile first.");
      return;
    }
    setError(null);
    startTransition(() => {
      applyProfileToPlayer({
        profileId: selectedProfile,
        realPlayerId: props.playerId,
      })
        .then(() => router.refresh())
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  function handleUnrate() {
    if (!confirm(`Remove your rating for ${props.playerName}?`)) return;
    setError(null);
    startTransition(() => {
      unratePlayer(props.playerId)
        .then(() => router.refresh())
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        Scouting
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        {/* My controls */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Your rating
            </p>
            {props.myCurrentRating && (
              <button
                type="button"
                disabled={disabled}
                onClick={handleUnrate}
                className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-40 transition"
              >
                Remove
              </button>
            )}
          </div>

          {props.myCurrentRating ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums">
                  {props.myCurrentRating.score}
                </span>
                {props.consensus !== null && (
                  <DeltaPill
                    delta={props.myCurrentRating.score - props.consensus}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                coverage {props.myCurrentRating.coverageCount}/
                {props.myCurrentRating.totalFactors} factors
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t rated this player yet.
            </p>
          )}

          {!hasProfiles ? (
            <p className="text-xs text-muted-foreground">
              No formulas yet —{" "}
              <a href="/scouting/profiles" className="underline">
                create one
              </a>{" "}
              first.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
              <label className="flex flex-col flex-1 min-w-[140px]">
                <span className="text-xs text-muted-foreground mb-1">
                  Apply formula
                </span>
                <select
                  value={selectedProfile}
                  disabled={disabled}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                >
                  {props.myProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.factorCount} factors)
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={handleApply}
                className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
              >
                {isPending
                  ? "Applying…"
                  : props.myCurrentRating
                  ? "Re-apply"
                  : "Apply"}
              </button>
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              {error}
            </p>
          )}

          {props.locked && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⏸ Ratings frozen — draft is {props.lockReason}.
            </p>
          )}
        </div>

        {/* League view */}
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            League
          </p>
          <div className="space-y-2">
            {props.leagueRatings.map((r) => (
              <ManagerRow key={r.managerName} r={r} consensus={props.consensus} />
            ))}
          </div>
          {props.leagueRatings.every((r) => r.score === null) && (
            <p className="text-xs text-muted-foreground">
              Nobody&apos;s rated this player yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function ManagerRow({
  r,
  consensus,
}: {
  r: LeagueRating;
  consensus: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background p-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">
          {r.managerEmoji} {r.managerName}
          {r.isMe && (
            <span className="ml-1 text-xs text-muted-foreground">(you)</span>
          )}
        </p>
        {r.sourceProfileName && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            via {r.sourceProfileName}
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        {r.score === null ? (
          <span className="text-sm text-muted-foreground/60">—</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-semibold tabular-nums">
              {r.score}
            </span>
            {consensus !== null && (
              <DeltaPill delta={r.score - consensus} compact />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DeltaPill({
  delta,
  compact,
}: {
  delta: number;
  compact?: boolean;
}) {
  const rounded = Math.round(delta);
  const tone =
    rounded >= 5
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
      : rounded <= -5
      ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
      : "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-block rounded ${
        compact ? "px-1 py-0 text-[10px]" : "px-1.5 py-0.5 text-xs"
      } font-medium ${tone}`}
      title={`${rounded >= 0 ? "+" : ""}${rounded} vs consensus`}
    >
      {rounded >= 0 ? "+" : ""}
      {rounded}
    </span>
  );
}
