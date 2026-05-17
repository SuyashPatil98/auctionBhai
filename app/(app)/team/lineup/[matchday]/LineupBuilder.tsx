"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Kickoff } from "@/components/Kickoff";
import {
  FORMATION_KEYS,
  FORMATIONS,
  type FormationKey,
} from "@/lib/lineup/formations";
import {
  explainError,
  isValid,
  validateLineup,
  type LineupDraft,
  type RosterPlayer,
} from "@/lib/lineup/validate";
import { saveLineup, autoFillFromPriorMatchday } from "../actions";
import type { Position } from "@/lib/scoring/points";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type RosterPlayerView = {
  realPlayerId: string;
  position: Position;
  displayName: string;
  countryFlag: string | null;
  countryName: string;
  price: number | null;
  tier: string | null;
  photoUrl: string | null;
};

export type LineupBuilderProps = {
  matchday: number;
  initialDraft: LineupDraft;
  roster: RosterPlayerView[];
  lockTime: string | null; // ISO
  isLocked: boolean;
  hasPriorLineup: boolean;
  tz: string | null;
  /** Number of bench slots — derives from draft.rosterSize − 11. */
  benchSize: number;
};

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export default function LineupBuilder(props: LineupBuilderProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<LineupDraft>(props.initialDraft);
  const [picker, setPicker] = useState<PickerSpec | null>(null);
  const [actionFor, setActionFor] = useState<{
    kind: "starter" | "bench";
    realPlayerId: string;
  } | null>(null);
  const [saveState, setSaveState] = useState<
    "clean" | "dirty" | "saving" | "saved" | "error"
  >("clean");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ---- Validation (live)
  const rosterAsRosterPlayer: RosterPlayer[] = useMemo(
    () =>
      props.roster.map((p) => ({
        realPlayerId: p.realPlayerId,
        position: p.position,
      })),
    [props.roster]
  );
  const rules = useMemo(() => ({ benchSize: props.benchSize }), [props.benchSize]);
  const errors = useMemo(
    () => validateLineup(draft, rosterAsRosterPlayer, rules),
    [draft, rosterAsRosterPlayer, rules]
  );

  // ---- Roster index for quick lookup
  const rosterById = useMemo(
    () => new Map(props.roster.map((p) => [p.realPlayerId, p])),
    [props.roster]
  );

  // ---- Auto-save with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveState !== "dirty") return;
    if (props.isLocked) return;
    if (!isValid(errors)) return; // don't auto-save broken state

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doSave();
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, saveState, errors]);

  async function doSave() {
    setSaveState("saving");
    setErrorMsg(null);
    try {
      await saveLineup({
        matchday: props.matchday,
        formation: draft.formation,
        starterIds: draft.starters,
        benchIds: draft.bench,
        captainId: draft.captainId,
        viceId: draft.viceId,
      });
      setSaveState("saved");
      router.refresh();
    } catch (e) {
      setSaveState("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function markDirty() {
    setSaveState("dirty");
  }

  // ---- Formation rows for rendering
  const quota = FORMATIONS[draft.formation];
  const startersByPos = useMemo(() => {
    const buckets: Record<Position, string[]> = {
      GK: [],
      DEF: [],
      MID: [],
      FWD: [],
    };
    for (const id of draft.starters) {
      const p = rosterById.get(id);
      if (!p) continue; // unknown — shouldn't happen normally
      buckets[p.position].push(id);
    }
    return buckets;
  }, [draft.starters, rosterById]);

  // ---- Position-eligible roster for picker
  function eligibleForPosition(pos: Position | "any"): RosterPlayerView[] {
    const placed = new Set([...draft.starters, ...draft.bench]);
    return props.roster.filter((p) => {
      if (placed.has(p.realPlayerId)) return false;
      if (pos === "any") return true;
      return p.position === pos;
    });
  }

  // ---- Slot click handlers
  function openStarterSlot(pos: Position, idx: number, occupied: boolean) {
    if (props.isLocked) return;
    if (occupied) {
      const realPlayerId = startersByPos[pos][idx];
      setActionFor({ kind: "starter", realPlayerId });
    } else {
      setPicker({ kind: "starter", position: pos });
    }
  }
  function openBenchSlot(idx: number) {
    if (props.isLocked) return;
    const id = draft.bench[idx];
    if (id) {
      setActionFor({ kind: "bench", realPlayerId: id });
    } else {
      setPicker({ kind: "bench", benchIndex: idx });
    }
  }

  // ---- Picker selection
  function placePlayerFromPicker(playerId: string) {
    if (!picker) return;
    if (picker.kind === "starter") {
      // Replace empty slot — append to starters
      setDraft((d) => ({ ...d, starters: [...d.starters, playerId] }));
    } else {
      // Bench slot
      setDraft((d) => {
        const newBench = [...d.bench];
        newBench[picker.benchIndex] = playerId;
        // Pad if needed (e.g. user filled slot 3 before 0)
        return { ...d, bench: newBench };
      });
    }
    setPicker(null);
    markDirty();
  }

  // ---- Slot action handlers
  function removeStarter(playerId: string) {
    setDraft((d) => ({
      ...d,
      starters: d.starters.filter((id) => id !== playerId),
      captainId: d.captainId === playerId ? "" : d.captainId,
      viceId: d.viceId === playerId ? "" : d.viceId,
    }));
    setActionFor(null);
    markDirty();
  }
  function removeBench(playerId: string) {
    setDraft((d) => ({
      ...d,
      bench: d.bench.map((id) => (id === playerId ? "" : id)),
    }));
    setActionFor(null);
    markDirty();
  }
  function moveStarterToBench(playerId: string) {
    setDraft((d) => {
      const newBench = [...d.bench];
      const emptyIdx = newBench.findIndex((x) => !x);
      if (emptyIdx === -1) return d; // bench full
      newBench[emptyIdx] = playerId;
      return {
        ...d,
        starters: d.starters.filter((id) => id !== playerId),
        bench: newBench,
        captainId: d.captainId === playerId ? "" : d.captainId,
        viceId: d.viceId === playerId ? "" : d.viceId,
      };
    });
    setActionFor(null);
    markDirty();
  }
  function promoteBenchToStarter(playerId: string) {
    setDraft((d) => ({
      ...d,
      starters: [...d.starters, playerId],
      bench: d.bench.map((id) => (id === playerId ? "" : id)),
    }));
    setActionFor(null);
    markDirty();
  }
  function moveBench(playerId: string, dir: -1 | 1) {
    setDraft((d) => {
      const idx = d.bench.indexOf(playerId);
      if (idx === -1) return d;
      const target = idx + dir;
      if (target < 0 || target >= d.bench.length) return d;
      const newBench = [...d.bench];
      [newBench[idx], newBench[target]] = [newBench[target], newBench[idx]];
      return { ...d, bench: newBench };
    });
    setActionFor(null);
    markDirty();
  }
  function makeCaptain(playerId: string) {
    setDraft((d) => ({
      ...d,
      captainId: playerId,
      viceId: d.viceId === playerId ? "" : d.viceId,
    }));
    setActionFor(null);
    markDirty();
  }
  function makeVice(playerId: string) {
    setDraft((d) => ({
      ...d,
      viceId: playerId,
      captainId: d.captainId === playerId ? "" : d.captainId,
    }));
    setActionFor(null);
    markDirty();
  }

  // ---- Formation change
  function changeFormation(next: FormationKey) {
    if (next === draft.formation) return;
    setDraft((d) => ({ ...d, formation: next }));
    markDirty();
  }

  // ---- Auto-fill from prior MD
  async function handleAutoFill() {
    if (!confirm("Replace current lineup with last matchday's setup?")) return;
    setSaveState("saving");
    try {
      await autoFillFromPriorMatchday(props.matchday);
      router.refresh();
    } catch (e) {
      setSaveState("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  // ----------------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------------

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <FormationPicker
            value={draft.formation}
            disabled={props.isLocked}
            onChange={changeFormation}
          />
          <SaveStatus state={saveState} />
          {errorMsg && (
            <span className="text-xs text-destructive">{errorMsg}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {props.hasPriorLineup && !props.isLocked && (
            <button
              type="button"
              onClick={handleAutoFill}
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition"
            >
              Copy from last MD
            </button>
          )}
          <LockBadge
            isLocked={props.isLocked}
            lockTime={props.lockTime}
            tz={props.tz}
          />
        </div>
      </div>

      {/* Pitch */}
      <div className="rounded-2xl border border-emerald-900/40 bg-gradient-to-b from-emerald-900/40 via-emerald-800/30 to-emerald-900/40 p-4 sm:p-6 space-y-4">
        {(["FWD", "MID", "DEF", "GK"] as Position[]).map((pos) => (
          <PitchRow
            key={pos}
            position={pos}
            quotaCount={quota[pos]}
            placedIds={startersByPos[pos]}
            rosterById={rosterById}
            captainId={draft.captainId}
            viceId={draft.viceId}
            disabled={props.isLocked}
            onSlotClick={(idx, occupied) =>
              openStarterSlot(pos, idx, occupied)
            }
          />
        ))}
      </div>

      {/* Bench */}
      <div className="space-y-2">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Bench · subbed in (in order) when a starter at the same position
          plays 0 minutes
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {draft.bench.map((id, idx) => (
            <BenchSlot
              key={idx}
              index={idx}
              playerId={id || null}
              player={id ? rosterById.get(id) ?? null : null}
              disabled={props.isLocked}
              onClick={() => openBenchSlot(idx)}
            />
          ))}
        </div>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
          <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400">
            Lineup not yet valid · {errors.length} issue
            {errors.length === 1 ? "" : "s"}
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5">
            {errors.slice(0, 5).map((e, i) => (
              <li key={i}>· {explainError(e)}</li>
            ))}
            {errors.length > 5 && (
              <li className="italic">+ {errors.length - 5} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Player picker modal */}
      {picker && (
        <PlayerPicker
          spec={picker}
          eligible={
            picker.kind === "starter"
              ? eligibleForPosition(picker.position)
              : eligibleForPosition("any")
          }
          onClose={() => setPicker(null)}
          onPick={placePlayerFromPicker}
        />
      )}

      {/* Slot action popover */}
      {actionFor && (
        <SlotActionModal
          kind={actionFor.kind}
          player={rosterById.get(actionFor.realPlayerId) ?? null}
          isCaptain={draft.captainId === actionFor.realPlayerId}
          isVice={draft.viceId === actionFor.realPlayerId}
          benchFull={draft.bench.every((id) => !!id)}
          onClose={() => setActionFor(null)}
          onRemove={
            actionFor.kind === "starter"
              ? () => removeStarter(actionFor.realPlayerId)
              : () => removeBench(actionFor.realPlayerId)
          }
          onMakeCaptain={
            actionFor.kind === "starter"
              ? () => makeCaptain(actionFor.realPlayerId)
              : undefined
          }
          onMakeVice={
            actionFor.kind === "starter"
              ? () => makeVice(actionFor.realPlayerId)
              : undefined
          }
          onMoveToBench={
            actionFor.kind === "starter"
              ? () => moveStarterToBench(actionFor.realPlayerId)
              : undefined
          }
          onPromote={
            actionFor.kind === "bench"
              ? () => promoteBenchToStarter(actionFor.realPlayerId)
              : undefined
          }
          onMoveUp={
            actionFor.kind === "bench"
              ? () => moveBench(actionFor.realPlayerId, -1)
              : undefined
          }
          onMoveDown={
            actionFor.kind === "bench"
              ? () => moveBench(actionFor.realPlayerId, 1)
              : undefined
          }
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

type PickerSpec =
  | { kind: "starter"; position: Position }
  | { kind: "bench"; benchIndex: number };

function FormationPicker({
  value,
  onChange,
  disabled,
}: {
  value: FormationKey;
  onChange: (v: FormationKey) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">
        Formation
      </span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as FormationKey)}
        className="rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium font-mono focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      >
        {FORMATION_KEYS.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </select>
    </label>
  );
}

function SaveStatus({ state }: { state: string }) {
  const txt =
    state === "saving"
      ? "Saving…"
      : state === "saved"
      ? "Saved"
      : state === "dirty"
      ? "Unsaved"
      : state === "error"
      ? "Save failed"
      : "";
  if (!txt) return null;
  const color =
    state === "error"
      ? "text-destructive"
      : state === "saved"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-muted-foreground";
  return <span className={`text-xs ${color}`}>{txt}</span>;
}

function LockBadge({
  isLocked,
  lockTime,
  tz,
}: {
  isLocked: boolean;
  lockTime: string | null;
  tz: string | null;
}) {
  if (isLocked) {
    return (
      <span className="text-xs rounded-md bg-destructive/10 text-destructive border border-destructive/30 px-2 py-1">
        🔒 Locked
      </span>
    );
  }
  if (!lockTime) {
    return (
      <span className="text-xs text-muted-foreground">
        No fixtures yet
      </span>
    );
  }
  return (
    <span className="text-xs text-muted-foreground">
      Locks at <Kickoff at={lockTime} tz={tz} variant="datetime" />
    </span>
  );
}

function PitchRow({
  position,
  quotaCount,
  placedIds,
  rosterById,
  captainId,
  viceId,
  disabled,
  onSlotClick,
}: {
  position: Position;
  quotaCount: number;
  placedIds: string[];
  rosterById: Map<string, RosterPlayerView>;
  captainId: string;
  viceId: string;
  disabled: boolean;
  onSlotClick: (idx: number, occupied: boolean) => void;
}) {
  const slots: Array<{ idx: number; playerId: string | null }> = [];
  for (let i = 0; i < quotaCount; i++) {
    slots.push({ idx: i, playerId: placedIds[i] ?? null });
  }
  // Extra players beyond the quota (over-placed) shown as warnings
  const overflow = placedIds.slice(quotaCount);

  return (
    <div>
      <div className="flex justify-center gap-2 sm:gap-3 flex-wrap">
        {slots.map((s) => {
          const player = s.playerId ? rosterById.get(s.playerId) : null;
          const isCap = s.playerId === captainId;
          const isVice = s.playerId === viceId;
          return (
            <PitchSlot
              key={`${position}-${s.idx}`}
              position={position}
              player={player ?? null}
              isCaptain={isCap}
              isVice={isVice}
              disabled={disabled}
              onClick={() => onSlotClick(s.idx, !!player)}
            />
          );
        })}
      </div>
      {overflow.length > 0 && (
        <p className="mt-1 text-center text-[10px] text-amber-500">
          {overflow.length} extra {position}{" "}
          {overflow.length === 1 ? "is" : "are"} in lineup — formation only
          wants {quotaCount}.
        </p>
      )}
    </div>
  );
}

function PitchSlot({
  position,
  player,
  isCaptain,
  isVice,
  disabled,
  onClick,
}: {
  position: Position;
  player: RosterPlayerView | null;
  isCaptain: boolean;
  isVice: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (!player) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="relative w-[80px] h-[100px] sm:w-[92px] sm:h-[116px] rounded-lg border-2 border-dashed border-emerald-500/30 bg-emerald-900/20 text-emerald-200/60 hover:bg-emerald-500/10 hover:border-emerald-500/60 transition disabled:opacity-50 disabled:hover:bg-emerald-900/20 flex items-center justify-center flex-col"
      >
        <span className="text-2xl">+</span>
        <span className="text-[10px] uppercase tracking-wider">
          {position}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="relative w-[80px] h-[100px] sm:w-[92px] sm:h-[116px] rounded-lg overflow-hidden ring-1 ring-emerald-300/40 hover:ring-2 hover:ring-emerald-300/80 transition disabled:opacity-60 bg-zinc-900/70 text-zinc-100 flex flex-col p-1.5"
    >
      {(isCaptain || isVice) && (
        <span
          className={`absolute top-1 left-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black ${
            isCaptain
              ? "bg-amber-400 text-amber-950"
              : "bg-zinc-200 text-zinc-900"
          }`}
        >
          {isCaptain ? "C" : "V"}
        </span>
      )}
      {player.countryFlag && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.countryFlag}
          alt=""
          className="absolute top-1 right-1 w-4 h-4"
        />
      )}
      <div className="flex-1 flex items-center justify-center mt-2">
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.photoUrl}
            alt=""
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-zinc-700 flex items-center justify-center text-sm font-semibold">
            {player.displayName.slice(0, 1)}
          </div>
        )}
      </div>
      <p className="text-[10px] sm:text-[11px] text-center truncate font-medium leading-tight mt-1">
        {player.displayName}
      </p>
      <p className="text-[9px] text-center text-zinc-400 tabular-nums">
        {position} {player.price ? `· ${player.price}` : ""}
      </p>
    </button>
  );
}

function BenchSlot({
  index,
  playerId,
  player,
  disabled,
  onClick,
}: {
  index: number;
  playerId: string | null;
  player: RosterPlayerView | null;
  disabled: boolean;
  onClick: () => void;
}) {
  if (!playerId || !player) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="h-16 rounded-lg border-2 border-dashed border-border bg-card/50 hover:bg-card text-muted-foreground transition disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <span className="text-xs uppercase tracking-wider">
          Bench {index + 1}
        </span>
        <span className="text-lg leading-none">+</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-16 rounded-lg ring-1 ring-border hover:ring-foreground/40 bg-card transition disabled:opacity-60 flex items-center gap-2 px-2 text-left"
    >
      <span className="text-xs font-bold tabular-nums w-5 text-muted-foreground">
        {index + 1}
      </span>
      {player.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.photoUrl}
          alt=""
          className="w-9 h-9 rounded-full object-cover"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-100">
          {player.displayName.slice(0, 1)}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate">{player.displayName}</p>
        <p className="text-[10px] text-muted-foreground">{player.position}</p>
      </div>
    </button>
  );
}

function PlayerPicker({
  spec,
  eligible,
  onClose,
  onPick,
}: {
  spec: PickerSpec;
  eligible: RosterPlayerView[];
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const title =
    spec.kind === "starter"
      ? `Pick a ${spec.position}`
      : `Pick for bench ${spec.benchIndex + 1}`;

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
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-background">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
        {eligible.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground italic">
            No eligible players on your roster.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {eligible.map((p) => (
              <li key={p.realPlayerId}>
                <button
                  type="button"
                  onClick={() => onPick(p.realPlayerId)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition text-left"
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
                    <p className="text-xs text-muted-foreground truncate">
                      {p.position} · {p.countryName}
                    </p>
                  </div>
                  {p.price !== null && (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.price} cr
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SlotActionModal(props: {
  kind: "starter" | "bench";
  player: RosterPlayerView | null;
  isCaptain: boolean;
  isVice: boolean;
  benchFull: boolean;
  onClose: () => void;
  onRemove: () => void;
  onMakeCaptain?: () => void;
  onMakeVice?: () => void;
  onMoveToBench?: () => void;
  onPromote?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  if (!props.player) return null;
  const btnCls =
    "w-full rounded-md border border-border bg-card hover:bg-muted px-3 py-2 text-sm text-left transition disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-background border border-border shadow-2xl p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-border pb-3">
          {props.player.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.player.photoUrl}
              alt=""
              className="w-12 h-12 rounded-full object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-zinc-700 flex items-center justify-center text-base font-semibold text-zinc-100">
              {props.player.displayName.slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium truncate">{props.player.displayName}</p>
            <p className="text-xs text-muted-foreground">
              {props.player.position} · {props.player.countryName}
            </p>
          </div>
        </div>

        {props.kind === "starter" && (
          <>
            {props.onMakeCaptain && (
              <button
                type="button"
                onClick={props.onMakeCaptain}
                disabled={props.isCaptain}
                className={btnCls}
              >
                {props.isCaptain ? "Already captain ⭐" : "Make captain (×2)"}
              </button>
            )}
            {props.onMakeVice && (
              <button
                type="button"
                onClick={props.onMakeVice}
                disabled={props.isVice}
                className={btnCls}
              >
                {props.isVice
                  ? "Already vice-captain"
                  : "Make vice-captain (×1.5 if captain DNP)"}
              </button>
            )}
            {props.onMoveToBench && (
              <button
                type="button"
                onClick={props.onMoveToBench}
                disabled={props.benchFull}
                className={btnCls}
              >
                {props.benchFull ? "Bench is full" : "Move to bench"}
              </button>
            )}
          </>
        )}

        {props.kind === "bench" && (
          <>
            {props.onPromote && (
              <button
                type="button"
                onClick={props.onPromote}
                className={btnCls}
              >
                Promote to starting XI
              </button>
            )}
            {props.onMoveUp && (
              <button
                type="button"
                onClick={props.onMoveUp}
                className={btnCls}
              >
                Move up
              </button>
            )}
            {props.onMoveDown && (
              <button
                type="button"
                onClick={props.onMoveDown}
                className={btnCls}
              >
                Move down
              </button>
            )}
          </>
        )}

        <button
          type="button"
          onClick={props.onRemove}
          className="w-full rounded-md border border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive px-3 py-2 text-sm transition"
        >
          Remove from lineup
        </button>
        <button
          type="button"
          onClick={props.onClose}
          className="w-full rounded-md text-muted-foreground hover:text-foreground py-2 text-xs transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
