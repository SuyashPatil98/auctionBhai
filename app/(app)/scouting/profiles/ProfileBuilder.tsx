"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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
          <SavedList
            profiles={props.savedProfiles}
            disabled={disabled}
            onNew={() => setEditor(blankEditor())}
            onEdit={(p) => setEditor(fromSaved(p))}
            onDelete={(p) => {
              if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
              startTransition(() => {
                deleteProfile(p.id)
                  .then(() => router.refresh())
                  .catch((e) => setError(String(e.message ?? e)));
              });
            }}
          />
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

function SavedList({
  profiles,
  disabled,
  onNew,
  onEdit,
  onDelete,
}: {
  profiles: SavedProfile[];
  disabled: boolean;
  onNew: () => void;
  onEdit: (p: SavedProfile) => void;
  onDelete: (p: SavedProfile) => void;
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
            <div
              key={p.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{p.name}</p>
                  {p.description && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {p.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    {p.factors.length} factor{p.factors.length === 1 ? "" : "s"} ·{" "}
                    {p.factors.filter((f) => f.importance === "important").length}{" "}
                    important
                  </p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onEdit(p)}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40 transition"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onDelete(p)}
                    className="rounded-md border border-destructive/30 bg-destructive/5 text-destructive px-3 py-1.5 text-xs hover:bg-destructive/10 disabled:opacity-40 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
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
