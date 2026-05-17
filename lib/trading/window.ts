/**
 * Trading window — when can managers sell, buy from free agents, or trade?
 *
 * Rule (locked 2026-05-16):
 *   - Window opens every Tuesday 00:00 UTC
 *   - Window closes Tuesday 23:59:59 UTC
 *   - Outside the window: lineup edits still allowed (up to -6h before
 *     the next kickoff); roster mutations (sells/buys/trades) refused.
 *   - Knockout cutoff: once the first R32 fixture kicks off, all
 *     trading is frozen for the rest of the tournament.
 *
 * Pure helpers — no DB. Caller passes the knockout-cutoff timestamp if
 * known (looked up from fixtures table).
 */

export const WINDOW_DAY_OF_WEEK = 2; // 0=Sun, 1=Mon, 2=Tue, ...

export type WindowState = {
  /** UTC ms at which the current/next window opens. */
  opensAt: number;
  /** UTC ms at which the current/next window closes. */
  closesAt: number;
  /** True if `now` falls within [opensAt, closesAt]. */
  isOpen: boolean;
  /** True if the knockout cutoff has passed — trading frozen permanently. */
  knockoutCutoffPassed: boolean;
};

/**
 * Compute the trading-window state at a given moment.
 *
 * @param now             current time (UTC ms)
 * @param knockoutCutoff  first-R32-kickoff time (UTC ms), or null if not yet known
 */
export function computeWindowState(
  now: number,
  knockoutCutoff: number | null
): WindowState {
  if (knockoutCutoff !== null && now >= knockoutCutoff) {
    return {
      opensAt: 0,
      closesAt: 0,
      isOpen: false,
      knockoutCutoffPassed: true,
    };
  }

  const d = new Date(now);
  const dayOfWeek = d.getUTCDay();
  const todayStartUtc = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate()
  );

  // Days until next Tuesday (0 if today is Tuesday)
  const daysUntilTuesday = (WINDOW_DAY_OF_WEEK - dayOfWeek + 7) % 7;

  let opensAt: number;
  if (daysUntilTuesday === 0) {
    // It's Tuesday — window is open from start of day.
    opensAt = todayStartUtc;
  } else {
    opensAt = todayStartUtc + daysUntilTuesday * 24 * 60 * 60 * 1000;
  }
  // Close at 23:59:59.999 of the same Tuesday
  const closesAt = opensAt + 24 * 60 * 60 * 1000 - 1;

  const isOpen = now >= opensAt && now <= closesAt;

  // If the cutoff is between now and closesAt, clamp the close.
  const effectiveClose =
    knockoutCutoff !== null && knockoutCutoff < closesAt
      ? knockoutCutoff
      : closesAt;

  return {
    opensAt,
    closesAt: effectiveClose,
    isOpen: isOpen && (knockoutCutoff === null || now < knockoutCutoff),
    knockoutCutoffPassed: false,
  };
}

/** Throws if trading is not allowed right now. */
export function assertTradingAllowed(state: WindowState) {
  if (state.knockoutCutoffPassed) {
    throw new Error(
      "Trading is frozen — knockout stage has begun, no more roster mutations until the tournament ends."
    );
  }
  if (!state.isOpen) {
    const opensAt = new Date(state.opensAt).toISOString();
    throw new Error(
      `Trading window is closed. Next window opens ${opensAt} (Tuesday 00:00 UTC).`
    );
  }
}

/** Human-friendly ms-until-next-window, useful for UI countdowns. */
export function msUntilNextOpen(state: WindowState, now: number): number {
  if (state.isOpen) return 0;
  return Math.max(0, state.opensAt - now);
}

/**
 * Key for bucketing free-agent bids by window. YYYY-MM-DD of the Tuesday
 * the window opened, UTC. Stable across the 24h window so all bids land
 * in the same bucket regardless of when they were placed.
 */
export function windowKeyFor(opensAtMs: number): string {
  const d = new Date(opensAtMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
