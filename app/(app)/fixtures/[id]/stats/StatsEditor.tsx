"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  finalizeFixtureStats,
  removePlayerFromFixture,
  setFixtureScore,
  unfinalizeFixtureStats,
  upsertPlayerStats,
} from "./actions";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type SideKey = "home" | "away";

export type EligiblePlayer = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
};

export type PlayerStatRow = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  photoUrl: string | null;
  side: SideKey;
  isStarter: boolean;
  minutes: number;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
  ownGoals: number;
  pensMissed: number;
  penSaves: number;
  cleanSheet: boolean;
};

export type StatsEditorProps = {
  fixtureId: string;
  homeName: string;
  awayName: string;
  homeFlag: string | null;
  awayFlag: string | null;
  initialHomeScore: number | null;
  initialAwayScore: number | null;
  finalizedAt: string | null;
  canUnfinalize: boolean;
  /** False = read-only view (page visitor isn't steward/commissioner). */
  canEdit: boolean;
  initialStats: PlayerStatRow[];
  eligibleHome: EligiblePlayer[];
  eligibleAway: EligiblePlayer[];
};

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export default function StatsEditor(props: StatsEditorProps) {
  const router = useRouter();
  const [homeScore, setHomeScore] = useState<number>(
    props.initialHomeScore ?? 0
  );
  const [awayScore, setAwayScore] = useState<number>(
    props.initialAwayScore ?? 0
  );
  const [isPending, startTransition] = useTransition();
  const [picker, setPicker] = useState<SideKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finalized = !!props.finalizedAt;
  const editable = props.canEdit && !finalized;

  const homeRows = props.initialStats.filter((s) => s.side === "home");
  const awayRows = props.initialStats.filter((s) => s.side === "away");

  const placedIds = useMemo(
    () => new Set(props.initialStats.map((s) => s.realPlayerId)),
    [props.initialStats]
  );

  function handleSaveScore() {
    if (!editable) return;
    setError(null);
    startTransition(() => {
      setFixtureScore(props.fixtureId, homeScore, awayScore)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleFinalize() {
    if (!confirm("Finalize stats? MOTM voting opens after this.")) return;
    setError(null);
    startTransition(() => {
      finalizeFixtureStats(props.fixtureId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleUnfinalize() {
    if (
      !confirm(
        "Re-open stats for edits? This clears the MOTM resolution if any."
      )
    ) {
      return;
    }
    setError(null);
    startTransition(() => {
      unfinalizeFixtureStats(props.fixtureId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  return (
    <div className="space-y-6">
      {/* Header status */}
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Status:
          </span>
          {finalized ? (
            <span className="rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 text-xs font-semibold">
              Finalized
            </span>
          ) : props.canEdit ? (
            <span className="rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-semibold">
              Editing
            </span>
          ) : (
            <span className="rounded-md bg-zinc-500/15 text-muted-foreground px-2 py-0.5 text-xs font-semibold">
              View-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {finalized && props.canUnfinalize && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleUnfinalize}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition"
            >
              Re-open for edits
            </button>
          )}
          {editable && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleFinalize}
              className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-sm font-semibold transition disabled:opacity-50"
            >
              Finalize stats →
            </button>
          )}
        </div>
      </div>

      {/* Score */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">
          Final score
        </h2>
        <div className="flex items-center justify-center gap-3 sm:gap-6">
          <SideLabel name={props.homeName} flag={props.homeFlag} align="right" />
          <ScoreInput
            value={homeScore}
            disabled={!editable || isPending}
            onChange={setHomeScore}
          />
          <span className="text-2xl font-bold text-muted-foreground">—</span>
          <ScoreInput
            value={awayScore}
            disabled={!editable || isPending}
            onChange={setAwayScore}
          />
          <SideLabel name={props.awayName} flag={props.awayFlag} align="left" />
        </div>
        {editable && (
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={
                isPending ||
                (homeScore === (props.initialHomeScore ?? 0) &&
                  awayScore === (props.initialAwayScore ?? 0))
              }
              onClick={handleSaveScore}
              className="text-xs rounded-md bg-foreground/10 hover:bg-foreground/20 px-3 py-1 transition disabled:opacity-50"
            >
              Save score
            </button>
            <p className="text-xs text-muted-foreground">
              Saving recomputes clean sheets + goals conceded.
            </p>
          </div>
        )}
      </section>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Two sides */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SideSection
          side="home"
          label={props.homeName}
          flag={props.homeFlag}
          rows={homeRows}
          fixtureId={props.fixtureId}
          editable={editable}
          onOpenPicker={() => setPicker("home")}
          setError={setError}
        />
        <SideSection
          side="away"
          label={props.awayName}
          flag={props.awayFlag}
          rows={awayRows}
          fixtureId={props.fixtureId}
          editable={editable}
          onOpenPicker={() => setPicker("away")}
          setError={setError}
        />
      </div>

      {/* Picker modal */}
      {picker && (
        <PlayerPickerModal
          side={picker}
          eligible={(picker === "home"
            ? props.eligibleHome
            : props.eligibleAway
          ).filter((p) => !placedIds.has(p.realPlayerId))}
          fixtureId={props.fixtureId}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function SideLabel({
  name,
  flag,
  align,
}: {
  name: string;
  flag: string | null;
  align: "left" | "right";
}) {
  return (
    <div
      className={`flex items-center gap-2 ${
        align === "right" ? "flex-row-reverse text-right" : ""
      } min-w-[6rem]`}
    >
      {flag && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={flag} alt="" className="w-5 h-5 flex-shrink-0" />
      )}
      <span className="text-sm font-medium truncate">{name}</span>
    </div>
  );
}

function ScoreInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={20}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
      className="w-14 text-center text-3xl font-bold tabular-nums rounded-md border border-input bg-background py-1 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
    />
  );
}

function SideSection({
  side,
  label,
  flag,
  rows,
  fixtureId,
  editable,
  onOpenPicker,
  setError,
}: {
  side: SideKey;
  label: string;
  flag: string | null;
  rows: PlayerStatRow[];
  fixtureId: string;
  editable: boolean;
  onOpenPicker: () => void;
  setError: (msg: string | null) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {flag && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={flag} alt="" className="w-4 h-4" />
          )}
          {label} · {rows.length} player{rows.length === 1 ? "" : "s"}
        </h2>
        {editable && (
          <button
            type="button"
            onClick={onOpenPicker}
            className="text-xs rounded-md bg-foreground/10 hover:bg-foreground/20 px-2.5 py-1 transition"
          >
            + Add player
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No players added yet.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <PlayerStatRowCard
              key={row.realPlayerId}
              row={row}
              fixtureId={fixtureId}
              editable={editable}
              setError={setError}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PlayerStatRowCard({
  row,
  fixtureId,
  editable,
  setError,
}: {
  row: PlayerStatRow;
  fixtureId: string;
  editable: boolean;
  setError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState({
    isStarter: row.isStarter,
    minutes: row.minutes,
    goals: row.goals,
    assists: row.assists,
    yellows: row.yellows,
    reds: row.reds,
    ownGoals: row.ownGoals,
    pensMissed: row.pensMissed,
    penSaves: row.penSaves,
  });

  function update<K extends keyof typeof state>(k: K, v: (typeof state)[K]) {
    setState((s) => ({ ...s, [k]: v }));
  }

  function handleSave() {
    setError(null);
    startTransition(() => {
      upsertPlayerStats(fixtureId, {
        realPlayerId: row.realPlayerId,
        side: row.side,
        isStarter: state.isStarter,
        minutes: state.minutes,
        goals: state.goals,
        assists: state.assists,
        yellows: state.yellows,
        reds: state.reds,
        ownGoals: state.ownGoals,
        pensMissed: state.pensMissed,
        penSaves: state.penSaves,
      })
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${row.displayName} from this fixture?`)) return;
    setError(null);
    startTransition(() => {
      removePlayerFromFixture(fixtureId, row.realPlayerId)
        .then(() => router.refresh())
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  const dirty =
    state.isStarter !== row.isStarter ||
    state.minutes !== row.minutes ||
    state.goals !== row.goals ||
    state.assists !== row.assists ||
    state.yellows !== row.yellows ||
    state.reds !== row.reds ||
    state.ownGoals !== row.ownGoals ||
    state.pensMissed !== row.pensMissed ||
    state.penSaves !== row.penSaves;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        {row.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.photoUrl}
            alt=""
            className="w-9 h-9 rounded-full object-cover"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-100">
            {row.displayName.slice(0, 1)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{row.displayName}</p>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {row.position}
            {row.cleanSheet && (
              <>
                {" · "}
                <span className="text-emerald-500">CS</span>
              </>
            )}
          </p>
        </div>
        {editable && (
          <button
            type="button"
            onClick={handleRemove}
            disabled={isPending}
            className="text-xs text-muted-foreground hover:text-destructive transition px-2"
            aria-label="remove"
          >
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        <NumField
          label="Min"
          value={state.minutes}
          disabled={!editable || isPending}
          max={130}
          onChange={(v) => update("minutes", v)}
        />
        <NumField
          label="G"
          value={state.goals}
          disabled={!editable || isPending}
          onChange={(v) => update("goals", v)}
        />
        <NumField
          label="A"
          value={state.assists}
          disabled={!editable || isPending}
          onChange={(v) => update("assists", v)}
        />
        <NumField
          label="Y"
          value={state.yellows}
          disabled={!editable || isPending}
          onChange={(v) => update("yellows", v)}
        />
        <NumField
          label="R"
          value={state.reds}
          disabled={!editable || isPending}
          onChange={(v) => update("reds", v)}
        />
        <NumField
          label="OG"
          value={state.ownGoals}
          disabled={!editable || isPending}
          onChange={(v) => update("ownGoals", v)}
        />
        <NumField
          label="PenMiss"
          value={state.pensMissed}
          disabled={!editable || isPending}
          onChange={(v) => update("pensMissed", v)}
        />
        {row.position === "GK" && (
          <NumField
            label="PenSave"
            value={state.penSaves}
            disabled={!editable || isPending}
            onChange={(v) => update("penSaves", v)}
          />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Started?
          </span>
          <button
            type="button"
            disabled={!editable || isPending}
            onClick={() => update("isStarter", !state.isStarter)}
            className={`text-xs rounded px-2 py-1.5 font-semibold transition disabled:opacity-40 ${
              state.isStarter
                ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {state.isStarter ? "Starter" : "Sub"}
          </button>
        </div>
      </div>

      {editable && dirty && (
        <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-semibold transition disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Save row"}
          </button>
        </div>
      )}
    </div>
  );
}

function NumField({
  label,
  value,
  disabled,
  max,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
    </label>
  );
}

function PlayerPickerModal({
  side,
  eligible,
  fixtureId,
  onClose,
}: {
  side: SideKey;
  eligible: EligiblePlayer[];
  fixtureId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      filter.trim()
        ? eligible.filter((p) =>
            p.displayName.toLowerCase().includes(filter.trim().toLowerCase())
          )
        : eligible,
    [eligible, filter]
  );

  function pick(player: EligiblePlayer, isStarter: boolean) {
    setError(null);
    startTransition(() => {
      upsertPlayerStats(fixtureId, {
        realPlayerId: player.realPlayerId,
        side,
        isStarter,
        minutes: isStarter ? 90 : 0,
      })
        .then(() => {
          router.refresh();
          onClose();
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-2xl bg-background border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-background border-b border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              Add {side === "home" ? "home" : "away"} player
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <input
            type="text"
            placeholder="Search…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {error && (
          <div className="px-4 py-2 text-xs text-destructive">{error}</div>
        )}
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground italic">
            No matches.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((p) => (
              <li
                key={p.realPlayerId}
                className="flex items-center gap-3 px-4 py-2.5"
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
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {p.displayName}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.position}</p>
                </div>
                <button
                  type="button"
                  onClick={() => pick(p, true)}
                  disabled={isPending}
                  className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50"
                >
                  + Starter
                </button>
                <button
                  type="button"
                  onClick={() => pick(p, false)}
                  disabled={isPending}
                  className="rounded-md bg-foreground/10 hover:bg-foreground/20 px-2.5 py-1 text-xs transition disabled:opacity-50"
                >
                  + Sub
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
