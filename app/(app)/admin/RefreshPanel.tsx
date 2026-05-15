"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshAll, type RefreshResult } from "./actions";

/**
 * The entire /admin surface — one big button that runs the fast
 * ingest + recompute pipeline and shows what changed.
 *
 * Everything heavier (countries+squads ingest, AI Gemini, TM/FBref
 * CSV imports) stays in CLI per CLAUDE.md.
 */
export default function RefreshPanel() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RefreshResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRefresh() {
    setError(null);
    startTransition(() => {
      refreshAll()
        .then((r) => {
          setResult(r);
          router.refresh();
        })
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={isPending}
        onClick={handleRefresh}
        className="group relative w-full rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-8 text-left transition-all hover:border-emerald-500/60 hover:shadow-xl hover:shadow-emerald-500/20 active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
      >
        <div className="flex items-center gap-5">
          <div
            className={`w-16 h-16 rounded-full bg-emerald-500/20 ring-2 ring-emerald-500/40 flex items-center justify-center text-3xl transition-transform ${
              isPending
                ? "animate-spin"
                : "group-hover:rotate-180 duration-500"
            }`}
          >
            ↻
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold tracking-tight">
              {isPending ? "Refreshing…" : "Refresh everything"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Pulls fresh fixtures + tournament metadata from football-data.org,
              re-runs the bracket simulation, recomputes prices and factor
              percentiles. Takes about 10 seconds.
            </p>
          </div>
        </div>
      </button>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {result && <ResultPanel result={result} />}

      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          CLI only — too slow for serverless
        </p>
        <p className="text-xs text-muted-foreground">
          The big imports take minutes (rate-limited APIs, large CSV files)
          and don&apos;t fit Vercel&apos;s 10s timeout. Run from your dev
          box:
        </p>
        <div className="grid gap-1 text-xs font-mono">
          <CliLine cmd="pnpm ingest" desc="Full football-data sync incl. countries + squads" />
          <CliLine cmd="pnpm import:tm" desc="Refresh Transfermarkt market values + caps" />
          <CliLine cmd="pnpm import:fbref" desc="Re-import FBref season stats" />
          <CliLine cmd="pnpm import:wc" desc="Apply edits to lib/data/wc_pedigree.json" />
          <CliLine cmd="pnpm compute:ratings" desc="Full 4-layer rating engine recompute" />
          <CliLine cmd="pnpm backfill:photos" desc="Backfill player photos from TM" />
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: RefreshResult }) {
  const okCount = result.steps.filter((s) => s.ok).length;
  const failed = result.steps.filter((s) => !s.ok);
  const allOk = failed.length === 0;

  return (
    <div
      className={`rounded-lg border p-4 space-y-3 ${
        allOk
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={`text-sm font-semibold ${
            allOk
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400"
          }`}
        >
          {allOk ? "✓ Done" : `⚠ ${okCount}/${result.steps.length} steps succeeded`}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {(result.totalMs / 1000).toFixed(1)}s ·{" "}
          {result.totalRowsChanged.toLocaleString()} rows changed
        </p>
      </div>

      <div className="space-y-1.5">
        {result.steps.map((s, i) => (
          <div
            key={i}
            className="flex items-baseline gap-3 text-xs rounded-md bg-background/60 px-3 py-2"
          >
            <span
              className={`shrink-0 w-4 ${
                s.ok
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {s.ok ? "✓" : "✗"}
            </span>
            <span className="font-medium min-w-[140px] shrink-0">
              {s.name}
            </span>
            <span className="flex-1 text-muted-foreground truncate">
              {s.ok
                ? s.notes
                  ? s.notes
                  : "no changes"
                : s.error ?? "failed"}
            </span>
            <span className="tabular-nums text-muted-foreground shrink-0">
              {s.rowsChanged !== null && (
                <>
                  <strong className="text-foreground">{s.rowsChanged}</strong>{" "}
                  rows ·{" "}
                </>
              )}
              {(s.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CliLine({ cmd, desc }: { cmd: string; desc: string }) {
  return (
    <div className="flex items-baseline gap-3 py-0.5">
      <code className="text-foreground/90 whitespace-nowrap">{cmd}</code>
      <span className="text-muted-foreground truncate">{desc}</span>
    </div>
  );
}
