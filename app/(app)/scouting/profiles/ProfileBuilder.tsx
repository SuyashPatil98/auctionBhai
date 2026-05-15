"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyProfileBulk,
  clearAllMyRatings,
  clearRatingsForProfile,
  createProfile,
  deleteProfile,
  updateProfile,
  type ProfileFactorInput,
} from "../actions";
import {
  FACTORS,
  FACTORS_ARRAY,
  type FactorCategory,
  type FactorId,
} from "@/lib/personal-rating/factors";
import {
  computePersonalRating,
  type FactorPercentile,
  type Importance,
} from "@/lib/personal-rating/compute";

// ============================================================================
// Types — re-exported so the server page can build the props
// ============================================================================

export type SavedProfile = {
  id: string;
  name: string;
  description: string | null;
  factors: Array<{ factor_id: string; importance: Importance }>;
  lockedAt: string | null;
  updatedAt: string;
  /** How many players are currently rated via this formula */
  ratingCount: number;
};

export type PreviewPlayer = {
  id: string;
  displayName: string;
  position: string;
  countryName: string;
};

export type PercentileRow = {
  factor_id: string;
  percentile: number;
  has_data: boolean;
};

export type ProfileBuilderProps = {
  isMember: boolean;
  locked: boolean;
  lockReason: string | null;
  savedProfiles: SavedProfile[];
  previewPlayer: PreviewPlayer | null;
  previewPercentiles: PercentileRow[];
  /** Total ratings across all this manager's profiles + overrides */
  totalRated: number;
};

// ============================================================================
// Three-state importance toggle
// ============================================================================

type Selection = "off" | "standard" | "important";

const CATEGORY_LABELS: Record<FactorCategory, string> = {
  attacking: "Attacking",
  defensive: "Defensive",
  goalkeeping: "Goalkeeping",
  playing_time: "Playing time",
  profile: "Profile",
  wc_pedigree: "WC pedigree",
  meta: "Meta",
};

const CATEGORY_ORDER: FactorCategory[] = [
  "attacking",
  "defensive",
  "goalkeeping",
  "playing_time",
  "profile",
  "wc_pedigree",
  "meta",
];

// ============================================================================
// Main component
// ============================================================================

type EditorState = {
  mode: "create" | "edit";
  profileId?: string;
  name: string;
  description: string;
  selections: Record<FactorId, Selection>;
};

function emptySelections(): Record<FactorId, Selection> {
  const obj = {} as Record<FactorId, Selection>;
  for (const f of FACTORS_ARRAY) obj[f.id] = "off";
  return obj;
}

function fromSaved(p: SavedProfile): EditorState {
  const sel = emptySelections();
  for (const f of p.factors) {
    sel[f.factor_id as FactorId] = f.importance;
  }
  return {
    mode: "edit",
    profileId: p.id,
    name: p.name,
    description: p.description ?? "",
    selections: sel,
  };
}

function blankEditor(): EditorState {
  return {
    mode: "create",
    name: "",
    description: "",
    selections: emptySelections(),
  };
}

export default function ProfileBuilder(props: ProfileBuilderProps) {
  const router = useRouter();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const disabled = !props.isMember || props.locked || isPending;

  const factorsByCategory = useMemo(() => {
    const map = new Map<FactorCategory, typeof FACTORS_ARRAY>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const f of FACTORS_ARRAY) {
      map.get(f.category)!.push(f);
    }
    return map;
  }, []);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Left column: editor or saved list */}
      <div className="space-y-4">
        {editor === null ? (
          <>
            {props.totalRated > 0 && !props.locked && (
              <ResetAllBar
                totalRated={props.totalRated}
                disabled={disabled}
                onReset={() => {
                  if (
                    !confirm(
                      `Reset all ${props.totalRated} of your ratings? You'll keep your formulas — just the per-player ratings get cleared. This can't be undone.`
                    )
                  )
                    return;
                  startTransition(() => {
                    clearAllMyRatings()
                      .then((r) => {
                        setError(null);
                        router.refresh();
                        // Optionally show a toast — for now silent + router.refresh
                        void r;
                      })
                      .catch((e) => setError(String(e.message ?? e)));
                  });
                }}
              />
            )}
            <SavedList
              profiles={props.savedProfiles}
              disabled={disabled}
              onNew={() => setEditor(blankEditor())}
              onEdit={(p) => setEditor(fromSaved(p))}
              onDelete={(p) => {
                if (
                  !confirm(`Delete "${p.name}"? This can't be undone.`)
                )
                  return;
                startTransition(() => {
                  deleteProfile(p.id)
                    .then(() => router.refresh())
                    .catch((e) => setError(String(e.message ?? e)));
                });
              }}
              onClear={(p) => {
                if (
                  !confirm(
                    `Clear ${p.ratingCount} player rating${p.ratingCount === 1 ? "" : "s"} applied via "${p.name}"? The formula stays — just the ratings get removed.`
                  )
                )
                  return;
                startTransition(() => {
                  clearRatingsForProfile(p.id)
                    .then(() => router.refresh())
                    .catch((e) => setError(String(e.message ?? e)));
                });
              }}
            />
            {error && (
              <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                {error}
              </p>
            )}
          </>
        ) : (
          <Editor
            state={editor}
            disabled={disabled}
            isPending={isPending}
            onChange={setEditor}
            onCancel={() => {
              setEditor(null);
              setError(null);
            }}
            onSave={(state) => {
              setError(null);
              const factors: ProfileFactorInput[] = (
                Object.keys(state.selections) as FactorId[]
              )
                .filter((k) => state.selections[k] !== "off")
                .map((k) => ({
                  factor_id: k,
                  importance: state.selections[k] as Importance,
                }));
              if (factors.length === 0) {
                setError("Pick at least one factor.");
                return;
              }
              if (!state.name.trim()) {
                setError("Name your profile.");
                return;
              }
              startTransition(() => {
                const promise =
                  state.mode === "create"
                    ? createProfile({
                        name: state.name,
                        description: state.description,
                        factors,
                      }).then(() => {})
                    : updateProfile({
                        profileId: state.profileId!,
                        name: state.name,
                        description: state.description,
                        factors,
                      });
                promise
                  .then(() => {
                    setEditor(null);
                    router.refresh();
                  })
                  .catch((e) => setError(String(e.message ?? e)));
              });
            }}
            error={error}
            factorsByCategory={factorsByCategory}
          />
        )}
      </div>

      {/* Right column: live preview */}
      <aside className="space-y-3 lg:sticky lg:top-20 self-start">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Live preview
        </h2>
        {props.previewPlayer ? (
          <Preview
            player={props.previewPlayer}
            percentiles={props.previewPercentiles}
            selections={editor?.selections ?? emptySelections()}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            No players priced yet — run <code>compute:prices</code>.
          </p>
        )}
      </aside>
    </div>
  );
}

// ============================================================================
// SavedList
// ============================================================================

function ResetAllBar({
  totalRated,
  disabled,
  onReset,
}: {
  totalRated: number;
  disabled: boolean;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {totalRated} player rating{totalRated === 1 ? "" : "s"} on your list
        </p>
        <p className="text-xs text-muted-foreground">
          Wipe everything to start over from a blank slate. Your saved
          formulas stay intact.
        </p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onReset}
        className="rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-3 py-1.5 text-xs font-semibold shrink-0 transition-all hover:bg-amber-500/20 hover:border-amber-500/60 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40"
      >
        Reset all ratings
      </button>
    </div>
  );
}

function SavedList({
  profiles,
  disabled,
  onNew,
  onEdit,
  onDelete,
  onClear,
}: {
  profiles: SavedProfile[];
  disabled: boolean;
  onNew: () => void;
  onEdit: (p: SavedProfile) => void;
  onDelete: (p: SavedProfile) => void;
  onClear: (p: SavedProfile) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
          Your formulas
        </h2>
        <button
          type="button"
          disabled={disabled}
          onClick={onNew}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-semibold transition-all hover:bg-emerald-400 hover:scale-[1.03] hover:shadow-lg hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          + New formula
        </button>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No formulas yet. Build one — most managers have 1-3 (e.g. one per
          position).
        </div>
      ) : (
        <div className="space-y-2">
          {profiles.map((p) => (
            <SavedProfileCard
              key={p.id}
              profile={p}
              disabled={disabled}
              onEdit={() => onEdit(p)}
              onDelete={() => onDelete(p)}
              onClear={() => onClear(p)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SavedProfileCard — one saved formula row with edit/delete + bulk-apply
// ============================================================================

function SavedProfileCard({
  profile,
  disabled,
  onEdit,
  onDelete,
  onClear,
}: {
  profile: SavedProfile;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-medium">{profile.name}</p>
          {profile.description && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {profile.description}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {profile.factors.length} factor
            {profile.factors.length === 1 ? "" : "s"} ·{" "}
            {profile.factors.filter((f) => f.importance === "important").length}{" "}
            important
            {profile.ratingCount > 0 && (
              <>
                {" · "}
                <span className="text-foreground/70">
                  {profile.ratingCount} player
                  {profile.ratingCount === 1 ? "" : "s"} rated
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            disabled={disabled}
            onClick={onEdit}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs transition-all hover:border-foreground/30 hover:bg-muted hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-1.5 text-xs transition-all hover:bg-destructive/15 hover:border-destructive/50 hover:scale-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Delete
          </button>
        </div>
      </div>

      <BulkApply profile={profile} disabled={disabled} />

      {profile.ratingCount > 0 && (
        <div className="flex items-center justify-end pt-2 border-t border-border">
          <button
            type="button"
            disabled={disabled}
            onClick={onClear}
            className="text-xs text-muted-foreground hover:text-amber-600 dark:hover:text-amber-400 underline-offset-2 hover:underline transition disabled:opacity-40 disabled:cursor-not-allowed"
            title={`Remove the ${profile.ratingCount} ratings applied via this formula. Formula stays.`}
          >
            Clear {profile.ratingCount} rating
            {profile.ratingCount === 1 ? "" : "s"} from this formula →
          </button>
        </div>
      )}
    </div>
  );
}

function BulkApply({
  profile,
  disabled,
}: {
  profile: SavedProfile;
  disabled: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | "GK" | "DEF" | "MID" | "FWD">(
    "all"
  );
  const [skipExisting, setSkipExisting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function handleApply() {
    setResult(null);
    startTransition(() => {
      applyProfileBulk({
        profileId: profile.id,
        filters: {
          position: filter === "all" ? null : filter,
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
              ? "No players matched the filter."
              : `Applied to ${r.matched} players — ${parts.join(" · ") || "no changes"}`
          );
          router.refresh();
        })
        .catch((e) => setResult(`Error: ${String(e.message ?? e)}`));
    });
  }

  return (
    <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
      <p className="text-xs uppercase tracking-widest text-emerald-700 dark:text-emerald-400 font-semibold">
        Bulk apply
      </p>
      <p className="text-xs text-muted-foreground">
        Rate many players at once with this formula. Per-player overrides
        you&apos;ve already set are preserved.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {(["all", "GK", "DEF", "MID", "FWD"] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={disabled || isPending}
              onClick={() => setFilter(opt)}
              className={`px-2.5 py-1 transition-colors ${
                filter === opt
                  ? "bg-foreground text-background"
                  : "bg-background hover:bg-muted text-muted-foreground"
              }`}
            >
              {opt === "all" ? "All players" : opt}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={skipExisting}
            disabled={disabled || isPending}
            onChange={(e) => setSkipExisting(e.target.checked)}
            className="rounded border-border"
          />
          Only rate new players (skip already-rated)
        </label>
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={handleApply}
          className="ml-auto rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          {isPending
            ? "Applying…"
            : filter === "all"
            ? "Apply to all"
            : `Apply to all ${filter}s`}
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

// ============================================================================
// Editor
// ============================================================================

function Editor({
  state,
  disabled,
  isPending,
  onChange,
  onCancel,
  onSave,
  error,
  factorsByCategory,
}: {
  state: EditorState;
  disabled: boolean;
  isPending: boolean;
  onChange: (s: EditorState) => void;
  onCancel: () => void;
  onSave: (s: EditorState) => void;
  error: string | null;
  factorsByCategory: Map<FactorCategory, typeof FACTORS_ARRAY>;
}) {
  const countByImportance = useMemo(() => {
    let imp = 0,
      std = 0;
    for (const k of Object.keys(state.selections) as FactorId[]) {
      if (state.selections[k] === "important") imp++;
      else if (state.selections[k] === "standard") std++;
    }
    return { imp, std };
  }, [state.selections]);

  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {state.mode === "create" ? "New formula" : "Edit formula"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-xs text-muted-foreground hover:text-foreground transition"
        >
          Cancel
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">Name *</span>
          <input
            type="text"
            value={state.name}
            placeholder="e.g. My CM workhorse"
            disabled={isPending}
            onChange={(e) => onChange({ ...state, name: e.target.value })}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-xs text-muted-foreground mb-1">
            Description (optional)
          </span>
          <input
            type="text"
            value={state.description}
            placeholder="Notes for yourself"
            disabled={isPending}
            onChange={(e) =>
              onChange({ ...state, description: e.target.value })
            }
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Factors</h3>
          <p className="text-xs text-muted-foreground tabular-nums">
            {countByImportance.imp} important · {countByImportance.std} standard
          </p>
        </div>

        {CATEGORY_ORDER.map((cat) => {
          const factors = factorsByCategory.get(cat) ?? [];
          return (
            <div key={cat} className="space-y-2">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                {CATEGORY_LABELS[cat]}
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {factors.map((f) => (
                  <FactorRow
                    key={f.id}
                    factor={f}
                    value={state.selections[f.id]}
                    disabled={isPending}
                    onChange={(v) =>
                      onChange({
                        ...state,
                        selections: { ...state.selections, [f.id]: v },
                      })
                    }
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSave(state)}
          className="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-40 transition"
        >
          {isPending
            ? "Saving…"
            : state.mode === "create"
            ? "Create formula"
            : "Save changes"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onCancel}
          className="rounded-md border border-border bg-background px-4 py-1.5 text-sm hover:bg-muted disabled:opacity-40 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function FactorRow({
  factor,
  value,
  disabled,
  onChange,
}: {
  factor: (typeof FACTORS_ARRAY)[number];
  value: Selection;
  disabled: boolean;
  onChange: (v: Selection) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-2.5">
      <div className="min-w-0">
        <p className="text-sm truncate" title={factor.description}>
          {factor.label}
        </p>
        {factor.sparse && (
          <p className="text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
            patchy coverage
          </p>
        )}
      </div>
      <div className="inline-flex shrink-0 rounded-md border border-border overflow-hidden text-xs">
        <SegBtn
          active={value === "off"}
          disabled={disabled}
          onClick={() => onChange("off")}
        >
          Off
        </SegBtn>
        <SegBtn
          active={value === "standard"}
          disabled={disabled}
          onClick={() => onChange("standard")}
          highlight="standard"
        >
          Std
        </SegBtn>
        <SegBtn
          active={value === "important"}
          disabled={disabled}
          onClick={() => onChange("important")}
          highlight="important"
        >
          Imp
        </SegBtn>
      </div>
    </div>
  );
}

function SegBtn({
  active,
  disabled,
  onClick,
  highlight,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  highlight?: "standard" | "important";
  children: React.ReactNode;
}) {
  let bg = "bg-background hover:bg-muted text-muted-foreground";
  if (active && highlight === "important")
    bg = "bg-emerald-600 text-white";
  else if (active && highlight === "standard")
    bg = "bg-sky-600 text-white";
  else if (active) bg = "bg-foreground text-background";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`px-2.5 py-1 transition disabled:opacity-40 ${bg}`}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Preview
// ============================================================================

function Preview({
  player,
  percentiles,
  selections,
}: {
  player: PreviewPlayer;
  percentiles: PercentileRow[];
  selections: Record<FactorId, Selection>;
}) {
  const weights = (Object.keys(selections) as FactorId[])
    .filter((k) => selections[k] !== "off")
    .map((k) => ({
      factor_id: k,
      importance: selections[k] as Importance,
    }));

  const pctMap: FactorPercentile[] = percentiles.map((p) => ({
    factor_id: p.factor_id as FactorId,
    percentile: p.percentile,
    has_data: p.has_data,
  }));

  const result =
    weights.length > 0
      ? computePersonalRating(weights, pctMap)
      : { score: 0, coverage: 0, total: 0, breakdown: [] as never[] };

  const hasAny = weights.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Applied to
        </p>
        <p className="font-medium mt-1">{player.displayName}</p>
        <p className="text-xs text-muted-foreground">
          {player.position} · {player.countryName}
        </p>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold tabular-nums">
          {hasAny ? result.score : "—"}
        </span>
        {hasAny && (
          <span className="text-xs text-muted-foreground">
            coverage {result.coverage}/{result.total}
          </span>
        )}
      </div>
      {!hasAny && (
        <p className="text-xs text-muted-foreground">
          Pick factors to see a score.
        </p>
      )}
      {hasAny && result.breakdown.length > 0 && (
        <div className="pt-2 border-t border-border space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Breakdown
          </p>
          {result.breakdown.map((b) => (
            <div
              key={b.factor_id}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-muted-foreground truncate" title={b.factor_id}>
                {FACTORS[b.factor_id as FactorId]?.label ?? b.factor_id}
                {b.importance === "important" && (
                  <span className="ml-1 text-emerald-600">★</span>
                )}
              </span>
              <span className="tabular-nums shrink-0">
                {b.percentile === null
                  ? "—"
                  : `${Math.round(b.percentile * 100)}%`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
