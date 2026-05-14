/**
 * Layer 1 of the rating engine: deterministic skeleton.
 *
 * Computes a baseline 0-100 score from features we always have:
 *   - age (from DOB)
 *   - position
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

/** Anchor at 50, position differences come out in normalization later. */
const POSITION_BASELINE: Record<DbPosition, number> = {
  GK: 50,
  DEF: 50,
  MID: 50,
  FWD: 50,
};

/**
 * Age curve. Centered on peak years (25-28). Drops fast above 32 and
 * is muted below 21 (raw potential alone isn't worth much in fantasy
 * for a tournament-format game).
 */
function ageAdjustment(age: number): number {
  if (age < 18) return -6;
  if (age < 21) return -3;
  if (age < 25) return +2;
  if (age < 29) return +5;
  if (age < 32) return +2;
  if (age < 35) return -3;
  return -6;
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
  const adj = age !== null ? ageAdjustment(age) : 0;
  return {
    score: positionBaseline + adj,
    age,
    ageAdjustment: adj,
    positionBaseline,
  };
}
