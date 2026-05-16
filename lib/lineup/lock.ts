/**
 * Lineup lock-time computation.
 *
 * Rule (locked 2026-05-16): the lineup for matchday N is editable up to
 * 6 hours before the earliest kickoff in MD N. After that, no edits.
 *
 * Pure function — pass in the fixtures, get the lock time. The page reads
 * fixtures from the DB and calls this; lockedAt also gets persisted on
 * manager_lineups when the page determines we've crossed the threshold,
 * so historic queries don't have to recompute.
 */

export const LOCK_OFFSET_HOURS = 6;

/**
 * Earliest kickoff in `fixtures` minus LOCK_OFFSET_HOURS. Returns null if
 * the array is empty (matchday has no fixtures yet — e.g. knockout slots
 * not drawn).
 */
export function computeLockTime(
  fixtures: Array<{ kickoffAt: Date | string }>
): Date | null {
  if (fixtures.length === 0) return null;
  const earliestMs = fixtures.reduce((min, f) => {
    const t =
      typeof f.kickoffAt === "string"
        ? new Date(f.kickoffAt).getTime()
        : f.kickoffAt.getTime();
    return t < min ? t : min;
  }, Number.POSITIVE_INFINITY);
  return new Date(earliestMs - LOCK_OFFSET_HOURS * 60 * 60 * 1000);
}

export function isLocked(lockTime: Date | null, now: Date = new Date()): boolean {
  if (!lockTime) return false; // no fixtures → no lock
  return now.getTime() >= lockTime.getTime();
}

/** Milliseconds remaining until lock. Negative if already locked. Null if no lock. */
export function timeUntilLock(
  lockTime: Date | null,
  now: Date = new Date()
): number | null {
  if (!lockTime) return null;
  return lockTime.getTime() - now.getTime();
}
