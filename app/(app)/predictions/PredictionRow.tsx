"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Kickoff } from "@/components/Kickoff";
import { clearPrediction, savePrediction } from "./actions";

export type PredictionFixture = {
  id: string;
  stage: string;
  kickoffAt: string; // ISO
  status: string;
  homeName: string;
  homeFlag: string | null;
  awayName: string;
  awayFlag: string | null;
  homeFinal: number | null;
  awayFinal: number | null;
};

export type MyPrediction = {
  homeScore: number;
  awayScore: number;
  pointsAwarded: number | null;
};

const STAGE_LABEL: Record<string, string> = {
  group: "Group",
  r32: "R32",
  r16: "R16",
  qf: "QF",
  sf: "SF",
  third: "3rd place",
  final: "Final",
};

export default function PredictionRow({
  fixture,
  myPrediction,
  mode,
  tz,
}: {
  fixture: PredictionFixture;
  myPrediction: MyPrediction | null;
  mode: "upcoming" | "past";
  tz: string | null;
}) {
  const router = useRouter();
  const [home, setHome] = useState<number>(myPrediction?.homeScore ?? 0);
  const [away, setAway] = useState<number>(myPrediction?.awayScore ?? 0);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const kickoffDate = new Date(fixture.kickoffAt);
  const finalised =
    fixture.homeFinal !== null && fixture.awayFinal !== null;
  const isPast = mode === "past";

  function handleSave() {
    setError(null);
    const fd = new FormData();
    fd.append("fixture_id", fixture.id);
    fd.append("home_score", String(home));
    fd.append("away_score", String(away));
    startTransition(() => {
      savePrediction(fd)
        .then(() => router.refresh())
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  function handleClear() {
    if (!confirm("Remove your prediction for this fixture?")) return;
    setError(null);
    const fd = new FormData();
    fd.append("fixture_id", fixture.id);
    startTransition(() => {
      clearPrediction(fd)
        .then(() => {
          setHome(0);
          setAway(0);
          router.refresh();
        })
        .catch((e) => setError(String(e.message ?? e)));
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      {/* Stage + kickoff */}
      <div className="w-32 shrink-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {STAGE_LABEL[fixture.stage] ?? fixture.stage}
        </p>
        <p className="text-xs tabular-nums">
          <Kickoff at={kickoffDate} tz={tz} />
        </p>
      </div>

      {/* Teams + actual score if past */}
      <div className="flex-1 min-w-[200px] flex items-center gap-2 text-sm">
        <Flag flag={fixture.homeFlag} />
        <span className="font-medium truncate flex-1 text-right">
          {fixture.homeName}
        </span>
        {isPast && finalised ? (
          <span className="text-base font-bold tabular-nums px-2">
            {fixture.homeFinal} – {fixture.awayFinal}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">vs</span>
        )}
        <span className="font-medium truncate flex-1">
          {fixture.awayName}
        </span>
        <Flag flag={fixture.awayFlag} />
      </div>

      {/* Prediction inputs (upcoming) or display (past) */}
      {isPast ? (
        <PastPredictionDisplay
          myPrediction={myPrediction}
          finalised={finalised}
        />
      ) : (
        <div className="flex items-center gap-2">
          <NumberStepper
            value={home}
            onChange={setHome}
            disabled={isPending}
            label={`${fixture.homeName} score`}
          />
          <span className="text-muted-foreground text-sm">–</span>
          <NumberStepper
            value={away}
            onChange={setAway}
            disabled={isPending}
            label={`${fixture.awayName} score`}
          />
          <button
            type="button"
            disabled={isPending}
            onClick={handleSave}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-semibold transition-all hover:scale-105 hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
          >
            {isPending ? "Saving…" : myPrediction ? "Update" : "Predict"}
          </button>
          {myPrediction && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleClear}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Remove your prediction"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="basis-full text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function NumberStepper({
  value,
  onChange,
  disabled,
  label,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="inline-flex items-stretch rounded-md border border-border overflow-hidden">
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        aria-label={`Decrement ${label}`}
        className="w-7 bg-background hover:bg-muted text-muted-foreground transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        −
      </button>
      <span className="w-8 text-center text-sm font-bold tabular-nums leading-none bg-background flex items-center justify-center">
        {value}
      </span>
      <button
        type="button"
        disabled={disabled || value >= 20}
        onClick={() => onChange(Math.min(20, value + 1))}
        aria-label={`Increment ${label}`}
        className="w-7 bg-background hover:bg-muted text-muted-foreground transition disabled:opacity-30 disabled:cursor-not-allowed"
      >
        +
      </button>
    </div>
  );
}

function PastPredictionDisplay({
  myPrediction,
  finalised,
}: {
  myPrediction: MyPrediction | null;
  finalised: boolean;
}) {
  if (!myPrediction) {
    return (
      <span className="text-xs text-muted-foreground italic w-44 text-right">
        no prediction
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 w-44 justify-end">
      <span className="text-xs text-muted-foreground">predicted</span>
      <span className="text-sm font-semibold tabular-nums">
        {myPrediction.homeScore}–{myPrediction.awayScore}
      </span>
      {finalised && (
        <PointsPill points={myPrediction.pointsAwarded} />
      )}
    </div>
  );
}

function PointsPill({ points }: { points: number | null }) {
  if (points === null) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        pending
      </span>
    );
  }
  const tone =
    points >= 3
      ? "bg-amber-500/20 text-amber-700 dark:text-amber-400"
      : points >= 2
      ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-400"
      : points >= 1
      ? "bg-sky-500/20 text-sky-700 dark:text-sky-400"
      : "bg-muted text-muted-foreground";
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${tone}`}>
      +{points}
    </span>
  );
}

function Flag({ flag }: { flag: string | null }) {
  if (!flag) return <span className="w-5" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={flag}
      alt=""
      className="w-5 h-5 rounded-sm shrink-0 ring-1 ring-border"
    />
  );
}
