"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyProfileBulk } from "../scouting/actions";

export type BulkRateProfile = {
  id: string;
  name: string;
  factorCount: number;
};

export type BulkRatePanelProps = {
  profiles: BulkRateProfile[];
  /** Current filter state — what the bulk apply will target. */
  filters: {
    q?: string | null;
    position?: "GK" | "DEF" | "MID" | "FWD" | null;
    countryCode?: string | null;
  };
  /** Total players matching the base filters (q + position + country). */
  matchCount: number;
};

/**
 * Compact bar that appears above the players table/grid. Lets the manager
 * pick one of their saved formulas and apply it to every player matching
 * the current search/position/country filters in one click.
 *
 * Personal scouting filters (interest, rated_by) don't constrain the
 * bulk-apply cohort — they're view-only overlays, so applying with
 * "rated by me" set still rates every player matching the base filters.
 */
export default function BulkRatePanel(props: BulkRatePanelProps) {
  const router = useRouter();
  const [profileId, setProfileId] = useState<string>(
    props.profiles[0]?.id ?? ""
  );
  const [skipExisting, setSkipExisting] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  if (props.profiles.length === 0) {
    return null;
  }

  const filterSummary = describeFilters(props.filters);

  function handleApply() {
    if (!profileId) {
      setResult("Pick a formula first.");
      return;
    }
    setResult(null);
    startTransition(() => {
      applyProfileBulk({
        profileId,
        filters: {
          position: props.filters.position ?? null,
          countryCode: props.filters.countryCode ?? null,
          query: props.filters.q ?? null,
          skipExisting,
        },
      })
        .then((r) => {
          const parts: string[] = [];
          if (r.inserted > 0) parts.push(`${r.inserted} new`);
          if (r.updated > 0) parts.push(`${r.updated} updated`);
          if (r.skipped > 0) parts.push(`${r.skipped} skipped`);
          setResult(
            r.matched === 0
              ? "No players matched the filters."
              : `Applied to ${r.matched} players — ${parts.join(" · ") || "no changes"}`
          );
          router.refresh();
        })
        .catch((e) => setResult(`Error: ${String(e.message ?? e)}`));
    });
  }

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs uppercase tracking-widest text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
          Bulk rate
        </span>

        <select
          value={profileId}
          disabled={isPending}
          onChange={(e) => setProfileId(e.target.value)}
          className="rounded-md border border-input bg-background px-2.5 py-1 text-xs flex-1 min-w-[160px] max-w-[280px]"
        >
          {props.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.factorCount} factor
              {p.factorCount === 1 ? "" : "s"})
            </option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground">→</span>

        <span className="text-xs px-2 py-1 rounded bg-background border border-border tabular-nums">
          {props.matchCount} player{props.matchCount === 1 ? "" : "s"}{" "}
          {filterSummary && (
            <span className="text-muted-foreground">({filterSummary})</span>
          )}
        </span>

        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipExisting}
            disabled={isPending}
            onChange={(e) => setSkipExisting(e.target.checked)}
            className="rounded border-border"
          />
          Skip already-rated
        </label>

        <button
          type="button"
          disabled={isPending || props.matchCount === 0}
          onClick={handleApply}
          className="ml-auto rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          {isPending ? "Applying…" : "Apply"}
        </button>
      </div>
      {result && (
        <p className="text-xs font-medium text-foreground bg-background/60 rounded px-2 py-1.5">
          {result}
        </p>
      )}
    </div>
  );
}

function describeFilters(f: BulkRatePanelProps["filters"]): string {
  const parts: string[] = [];
  if (f.position) parts.push(f.position);
  if (f.countryCode) parts.push(f.countryCode);
  if (f.q?.trim()) parts.push(`"${f.q.trim()}"`);
  return parts.length === 0 ? "" : parts.join(" · ");
}
