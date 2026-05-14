/**
 * Layer 1 of the rating engine: deterministic skeleton.
 *
 * Computes a baseline 0-100 score from features we always have:
 *   - age (from DOB)
 *   - position (with per-position age curves)
 *
 * This is the *fallback* layer — every player gets a Layer 1 score so we
 * always have a defensible default. Layers 2 (market value) and 3 (AI
 * research) refine it where they have signal.
 */

import type { DbPosition } from "@/lib/ingest/mappers";

export type Layer1Inputs = {
  position: DbPosition;
  dob: string | null; // ISO date "YYYY-MM-DD"
};

export type Layer1Result = {
  score: number;
  age: number | null;
  ageAdjustment: number;
  positionBaseline: number;
};

const POSITION_BASELINE: Record<DbPosition, number> = {
  GK: 50,
  DEF: 50,
  MID: 50,
  FWD: 50,
};

/**
 * Per-position age curves. Different positions peak at different ages:
 *  - GKs peak latest (28-34) and decline slowly; experience matters
 *  - DEFs peak slightly earlier and rely on positional reading
 *  - MIDs peak 25-30; tempo + workload central
 *  - FWDs peak earliest (24-28) — pace and explosiveness fade fast
 *
 * Each row maps an age band (inclusive lower bound) to the adjustment
 * added to the position baseline. The lookup uses the highest band
 * whose lower bound the age meets.
 */
type AgeCurve = Array<{ from: number; adj: number }>;

const AGE_CURVE: Record<DbPosition, AgeCurve> = {
  GK: [
    { from: 0, adj: -8 },
    { from: 18, adj: -5 },
    { from: 22, adj: -2 },
    { from: 25, adj: +1 },
    { from: 28, adj: +5 }, // GK peak
    { from: 35, adj: +3 },
    { from: 38, adj: -2 },
    { from: 40, adj: -6 },
  ],
  DEF: [
    { from: 0, adj: -8 },
    { from: 18, adj: -3 },
    { from: 22, adj: +2 },
    { from: 26, adj: +5 }, // DEF peak (26-31)
    { from: 32, adj: +1 },
    { from: 34, adj: -3 },
    { from: 37, adj: -7 },
  ],
  MID: [
    { from: 0, adj: -7 },
    { from: 18, adj: -3 },
    { from: 22, adj: +2 },
    { from: 25, adj: +5 }, // MID peak (25-30)
    { from: 31, adj: +1 },
    { from: 33, adj: -3 },
    { from: 36, adj: -7 },
  ],
  FWD: [
    { from: 0, adj: -7 },
    { from: 18, adj: -2 },
    { from: 21, adj: +3 },
    { from: 24, adj: +5 }, // FWD peak (24-28)
    { from: 29, adj: +1 },
    { from: 31, adj: -2 },
    { from: 33, adj: -5 },
    { from: 35, adj: -8 },
  ],
};

function ageAdjustment(age: number, position: DbPosition): number {
  const curve = AGE_CURVE[position];
  let adj = curve[0].adj;
  for (const band of curve) {
    if (age >= band.from) adj = band.adj;
    else break;
  }
  return adj;
}

export function ageFromDob(dob: string | null, asOf = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const yearDiff = asOf.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    asOf.getMonth() < birth.getMonth() ||
    (asOf.getMonth() === birth.getMonth() && asOf.getDate() < birth.getDate());
  return beforeBirthday ? yearDiff - 1 : yearDiff;
}

export function computeLayer1(inputs: Layer1Inputs): Layer1Result {
  const positionBaseline = POSITION_BASELINE[inputs.position];
  const age = ageFromDob(inputs.dob);
  const adj = age !== null ? ageAdjustment(age, inputs.position) : 0;
  return {
    score: positionBaseline + adj,
    age,
    ageAdjustment: adj,
    positionBaseline,
  };
}
