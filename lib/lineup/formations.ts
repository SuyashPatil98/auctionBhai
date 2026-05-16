/**
 * Formation definitions for the lineup builder.
 *
 * Every formation has exactly 11 starters: 1 GK + 10 outfield, split by
 * position. Pitch-view bands are rendered from this map.
 */

import type { Position } from "@/lib/scoring/points";

export type FormationKey =
  | "3-4-3"
  | "4-3-3"
  | "4-4-2"
  | "4-5-1"
  | "5-3-2"
  | "5-4-1"
  | "3-5-2";

export type FormationQuota = Record<Position, number>;

export const FORMATIONS: Record<FormationKey, FormationQuota> = {
  "3-4-3": { GK: 1, DEF: 3, MID: 4, FWD: 3 },
  "4-3-3": { GK: 1, DEF: 4, MID: 3, FWD: 3 },
  "4-4-2": { GK: 1, DEF: 4, MID: 4, FWD: 2 },
  "4-5-1": { GK: 1, DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { GK: 1, DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { GK: 1, DEF: 5, MID: 4, FWD: 1 },
  "3-5-2": { GK: 1, DEF: 3, MID: 5, FWD: 2 },
};

export const FORMATION_KEYS = Object.keys(FORMATIONS) as FormationKey[];

export const DEFAULT_FORMATION: FormationKey = "4-3-3";

/** Sanity assert at module load — every formation must add to 11. */
for (const [k, q] of Object.entries(FORMATIONS)) {
  const sum = q.GK + q.DEF + q.MID + q.FWD;
  if (sum !== 11) {
    throw new Error(`Formation ${k} sums to ${sum}, expected 11`);
  }
}

export function isFormationKey(s: string): s is FormationKey {
  return s in FORMATIONS;
}
