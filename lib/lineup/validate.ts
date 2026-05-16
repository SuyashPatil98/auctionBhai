/**
 * Pure lineup validation.
 *
 * Given a proposed lineup (formation + starters + bench + captain + vice)
 * and the manager's roster, return either a list of human-readable
 * errors or an empty array (= valid).
 *
 * Used by:
 *   - The lineup builder UI (live validation, disables Save when invalid)
 *   - Server actions (defence-in-depth — never trust the client)
 *
 * The function is pure: it doesn't reach for the DB. Pass it everything
 * it needs and it tells you what's wrong.
 */

import type { Position } from "@/lib/scoring/points";
import { FORMATIONS, type FormationKey } from "./formations";

export type LineupDraft = {
  formation: FormationKey;
  /** Exactly 11 realPlayerIds, in any order — counts are validated. */
  starters: string[];
  /** Bench slots in order; 4 for WC, fewer for sandbox / test fixtures. */
  bench: string[];
  captainId: string;
  viceId: string;
};

export type RosterPlayer = {
  realPlayerId: string;
  position: Position;
};

export type LineupRules = {
  /** Number of bench slots required (WC = 4; test fixtures = 1). */
  benchSize: number;
};

export const WC_RULES: LineupRules = { benchSize: 4 };

export type ValidationError =
  | { code: "starter_count"; expected: number; got: number }
  | { code: "bench_count"; expected: number; got: number }
  | { code: "position_mismatch"; position: Position; expected: number; got: number }
  | { code: "captain_not_starter" }
  | { code: "vice_not_starter" }
  | { code: "captain_vice_same" }
  | { code: "duplicate_player"; realPlayerId: string }
  | { code: "unknown_player"; realPlayerId: string };

export function validateLineup(
  draft: LineupDraft,
  roster: RosterPlayer[],
  rules: LineupRules = WC_RULES
): ValidationError[] {
  const errors: ValidationError[] = [];
  const rosterById = new Map(roster.map((r) => [r.realPlayerId, r]));

  // Cardinality
  if (draft.starters.length !== 11) {
    errors.push({
      code: "starter_count",
      expected: 11,
      got: draft.starters.length,
    });
  }
  if (draft.bench.length !== rules.benchSize) {
    errors.push({
      code: "bench_count",
      expected: rules.benchSize,
      got: draft.bench.length,
    });
  }

  // No duplicates within or across starters + bench
  const seen = new Set<string>();
  for (const id of [...draft.starters, ...draft.bench]) {
    if (seen.has(id)) {
      errors.push({ code: "duplicate_player", realPlayerId: id });
    }
    seen.add(id);
  }

  // All player ids must be in the roster
  for (const id of [...draft.starters, ...draft.bench]) {
    if (!rosterById.has(id)) {
      errors.push({ code: "unknown_player", realPlayerId: id });
    }
  }

  // Position quota — only meaningful if we have 11 starters that exist
  if (
    draft.starters.length === 11 &&
    draft.starters.every((id) => rosterById.has(id))
  ) {
    const quota = FORMATIONS[draft.formation];
    const got: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const id of draft.starters) {
      const p = rosterById.get(id)!.position;
      got[p]++;
    }
    for (const pos of ["GK", "DEF", "MID", "FWD"] as Position[]) {
      if (got[pos] !== quota[pos]) {
        errors.push({
          code: "position_mismatch",
          position: pos,
          expected: quota[pos],
          got: got[pos],
        });
      }
    }
  }

  // Captain + vice must both be in starters and must be distinct
  if (draft.captainId === draft.viceId) {
    errors.push({ code: "captain_vice_same" });
  }
  if (!draft.starters.includes(draft.captainId)) {
    errors.push({ code: "captain_not_starter" });
  }
  if (!draft.starters.includes(draft.viceId)) {
    errors.push({ code: "vice_not_starter" });
  }

  return errors;
}

/** Human-readable explanation of an error — for surfacing in the UI. */
export function explainError(e: ValidationError): string {
  switch (e.code) {
    case "starter_count":
      return `Lineup has ${e.got} starters; need ${e.expected}.`;
    case "bench_count":
      return `Bench has ${e.got} players; need ${e.expected}.`;
    case "position_mismatch":
      return `Formation requires ${e.expected} ${e.position}, you have ${e.got}.`;
    case "captain_not_starter":
      return "Captain must be in the starting XI.";
    case "vice_not_starter":
      return "Vice-captain must be in the starting XI.";
    case "captain_vice_same":
      return "Captain and vice-captain must be different players.";
    case "duplicate_player":
      return "Same player appears twice in the lineup.";
    case "unknown_player":
      return "A player in the lineup isn't on your roster.";
  }
}

export function isValid(errors: ValidationError[]): boolean {
  return errors.length === 0;
}
