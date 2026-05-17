/**
 * Roster composition validator.
 *
 * After ANY trading mutation (sell, free-agent buy, trade) the resulting
 * squad must still satisfy the draft's position quotas (e.g. 2/5/5/4 for
 * the new 16-player default) — otherwise the manager couldn't field a
 * legal lineup.
 *
 * Pure. Pass the proposed roster (post-mutation) + the quota; get back
 * either OK or a list of complaints.
 */

import type { Position } from "@/lib/scoring/points";

export type RosterComposition = Record<Position, number>;

export type QuotaViolation = {
  position: Position;
  expected: number;
  got: number;
};

export function composition(
  players: Array<{ position: Position }>
): RosterComposition {
  const c: RosterComposition = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
  for (const p of players) c[p.position]++;
  return c;
}

export function validateComposition(
  players: Array<{ position: Position }>,
  quota: RosterComposition
): QuotaViolation[] {
  const got = composition(players);
  const errors: QuotaViolation[] = [];
  for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
    if (got[pos] !== quota[pos]) {
      errors.push({ position: pos, expected: quota[pos], got: got[pos] });
    }
  }
  return errors;
}

export function explainQuotaViolation(v: QuotaViolation): string {
  const diff = v.got - v.expected;
  if (diff > 0) {
    return `${v.position}: ${v.got} (need ${v.expected}; ${diff} too many — sell one before adding more)`;
  }
  return `${v.position}: ${v.got} (need ${v.expected}; ${-diff} short — buy one before selling another)`;
}
