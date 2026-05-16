/**
 * football-data.org v4 client.
 *
 * Free tier: 10 requests/minute. Sends API key via X-Auth-Token header.
 * Reads rate-limit hints from response headers and self-throttles to avoid
 * 429s. Retries once on 429 after the server-suggested wait.
 *
 * Docs: https://www.football-data.org/documentation/api
 */

const BASE = "https://api.football-data.org/v4";

// In-memory rate-limit state. Per-process, which is fine for a single
// dev box and for serverless functions where each invocation gets its
// own state (we don't share across functions — the API itself enforces
// the real limit; this just keeps us polite within a single batch).
const state = {
  remaining: 10,
  /** Unix ms when the minute window resets. Null = unknown. */
  resetAt: null as number | null,
};

const SAFETY_HEADROOM = 1; // start backing off when only N requests are left in the window

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class FootballDataError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string
  ) {
    super(message);
    this.name = "FootballDataError";
  }
}

async function selfThrottle() {
  if (state.remaining > SAFETY_HEADROOM) return;
  if (state.resetAt === null) return;
  const waitMs = Math.max(0, state.resetAt - Date.now());
  if (waitMs > 0) {
    await sleep(waitMs + 250); // small buffer so we don't race the server
  }
}

function readRateLimit(res: Response) {
  // Header names per football-data docs.
  const remaining = res.headers.get("X-Requests-Available-Minute");
  const resetSec = res.headers.get("X-RequestCounter-Reset");

  if (remaining !== null) {
    const n = Number.parseInt(remaining, 10);
    if (Number.isFinite(n)) state.remaining = n;
  }
  if (resetSec !== null) {
    const n = Number.parseInt(resetSec, 10);
    if (Number.isFinite(n) && n > 0) {
      state.resetAt = Date.now() + n * 1000;
    }
  }
}

export async function fdFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FOOTBALL_DATA_API_KEY is not set. Get one at https://www.football-data.org/client/register and add it to .env.local"
    );
  }

  await selfThrottle();

  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Auth-Token": apiKey,
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  readRateLimit(res);

  if (res.status === 429) {
    const waitMs = state.resetAt
      ? Math.max(0, state.resetAt - Date.now()) + 500
      : 60_000;
    await sleep(waitMs);
    // One retry.
    const retry = await fetch(url, {
      ...init,
      headers: {
        "X-Auth-Token": apiKey,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
    });
    readRateLimit(retry);
    if (!retry.ok) {
      throw new FootballDataError(
        retry.status,
        `${retry.status} ${retry.statusText} (after retry)`,
        await retry.text()
      );
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    throw new FootballDataError(
      res.status,
      `${res.status} ${res.statusText}`,
      await res.text()
    );
  }

  return (await res.json()) as T;
}

// ---------- typed shapes (minimal — we only use fields we need) ----------

export type Competition = {
  id: number;
  name: string;
  code: string;
  type: string;
  emblem?: string;
  plan?: string; // "TIER_ONE" | "TIER_TWO" | "TIER_THREE" | "TIER_FOUR"
  currentSeason?: {
    id: number;
    startDate: string;
    endDate: string;
    currentMatchday: number | null;
  };
  area?: { id: number; name: string; code: string };
};

export type Team = {
  id: number;
  name: string;
  shortName?: string;
  tla?: string;
  crest?: string;
  area?: { id: number; name: string; code: string };
  squad?: Player[];
  coach?: { id: number; name: string };
};

export type Player = {
  id: number;
  name: string;
  position?: string; // e.g. "Goalkeeper", "Defence", "Midfield", "Offence"
  dateOfBirth?: string;
  nationality?: string;
  shirtNumber?: number;
};

export type Match = {
  id: number;
  utcDate: string;
  status: string; // SCHEDULED, LIVE, IN_PLAY, PAUSED, FINISHED, POSTPONED, CANCELED
  matchday: number | null;
  stage: string; // GROUP_STAGE, LAST_16, QUARTER_FINALS, SEMI_FINALS, FINAL, ...
  group?: string;
  homeTeam: { id: number; name: string; tla?: string; crest?: string };
  awayTeam: { id: number; name: string; tla?: string; crest?: string };
  score: {
    winner: string | null;
    duration: string;
    fullTime: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
  };
  venue?: string;
};

// ---------- endpoint helpers ----------

export async function listCompetitions() {
  return fdFetch<{ count: number; competitions: Competition[] }>(
    "/competitions"
  );
}

export async function getCompetition(idOrCode: string | number) {
  return fdFetch<Competition>(`/competitions/${idOrCode}`);
}

export async function getCompetitionTeams(idOrCode: string | number) {
  return fdFetch<{ count: number; teams: Team[] }>(
    `/competitions/${idOrCode}/teams`
  );
}

export async function getCompetitionMatches(
  idOrCode: string | number,
  query?: { matchday?: number; status?: string; stage?: string }
) {
  const qs = query
    ? "?" +
      new URLSearchParams(
        Object.entries(query).reduce<Record<string, string>>(
          (acc, [k, v]) => (v != null ? ((acc[k] = String(v)), acc) : acc),
          {}
        )
      ).toString()
    : "";
  return fdFetch<{ count: number; matches: Match[] }>(
    `/competitions/${idOrCode}/matches${qs}`
  );
}

export async function getTeam(id: number) {
  return fdFetch<Team>(`/teams/${id}`);
}

// Single-match detailed view — includes lineups, goals, bookings, subs.
// Only populated post-match (status FINISHED). Pre-match returns scheduled
// teams + venue but no player-level data.

export type MatchEventScorer = {
  id: number;
  name: string;
};

export type MatchDetail = Match & {
  homeTeam: Match["homeTeam"] & {
    coach?: { id: number; name: string };
    lineup?: Array<{ id: number; name: string; position?: string; shirtNumber?: number }>;
    bench?: Array<{ id: number; name: string; position?: string; shirtNumber?: number }>;
  };
  awayTeam: Match["awayTeam"] & {
    coach?: { id: number; name: string };
    lineup?: Array<{ id: number; name: string; position?: string; shirtNumber?: number }>;
    bench?: Array<{ id: number; name: string; position?: string; shirtNumber?: number }>;
  };
  goals?: Array<{
    minute: number;
    injuryTime?: number | null;
    type: "REGULAR" | "OWN" | "PENALTY";
    team: { id: number };
    scorer: MatchEventScorer;
    assist?: MatchEventScorer | null;
  }>;
  bookings?: Array<{
    minute: number;
    team: { id: number };
    player: MatchEventScorer;
    card: "YELLOW" | "RED" | "YELLOW_RED";
  }>;
  substitutions?: Array<{
    minute: number;
    team: { id: number };
    playerOut: MatchEventScorer;
    playerIn: MatchEventScorer;
  }>;
};

export async function getMatch(id: number) {
  return fdFetch<MatchDetail>(`/matches/${id}`);
}

export function rateLimitSnapshot() {
  return {
    remaining: state.remaining,
    resetAt: state.resetAt,
  };
}
