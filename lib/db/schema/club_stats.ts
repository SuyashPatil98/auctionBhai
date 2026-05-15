import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { realPlayers } from "./tournament";

/**
 * Per-player per-season club stats, sourced from FBref (via the
 * hubertsidorowicz/football-players-stats Kaggle dataset). One row per
 * (player, season) covering all matches in the Big-5 European leagues
 * for that season.
 *
 * We only insert rows for players we successfully fuzzy-match against
 * our `real_players` (WC squad). Unmatched FBref rows are silently
 * dropped — they're not WC players we care about.
 */
export const playerClubStats = pgTable(
  "player_club_stats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),

    source: text("source").notNull(), // "fbref"
    season: text("season").notNull(), // "2025-2026"
    competition: text("competition"), // "Big 5 European Leagues" (FBref aggregates)
    squad: text("squad"), // current/last club for the season

    // Playing time
    matchesPlayed: integer("matches_played"),
    starts: integer("starts"),
    minutes: integer("minutes"),

    // Production
    goals: integer("goals"),
    assists: integer("assists"),
    nonPenaltyGoals: integer("non_penalty_goals"),
    penalties: integer("penalties"),
    penaltyAttempts: integer("penalty_attempts"),

    // Advanced (xG = expected goals; xAG = expected assisted goals)
    xg: numeric("xg", { precision: 6, scale: 2 }),
    xag: numeric("xag", { precision: 6, scale: 2 }),
    npxg: numeric("npxg", { precision: 6, scale: 2 }),

    // Per 90
    goalsPer90: numeric("goals_per_90", { precision: 5, scale: 2 }),
    assistsPer90: numeric("assists_per_90", { precision: 5, scale: 2 }),
    xgPer90: numeric("xg_per_90", { precision: 5, scale: 2 }),
    xagPer90: numeric("xag_per_90", { precision: 5, scale: 2 }),

    // Discipline
    yellowCards: integer("yellow_cards"),
    redCards: integer("red_cards"),

    // Defensive
    tackles: integer("tackles"),
    tacklesWon: integer("tackles_won"),
    interceptions: integer("interceptions"),
    blocks: integer("blocks"),
    clearances: integer("clearances"),
    errors: integer("errors"),
    recoveries: integer("recoveries"),

    // Passing / creativity
    keyPasses: integer("key_passes"),
    progressivePasses: integer("progressive_passes"),
    progressiveCarries: integer("progressive_carries"),
    passCompletionPct: numeric("pass_completion_pct", { precision: 5, scale: 2 }),
    expectedAssists: numeric("expected_assists", { precision: 6, scale: 2 }),
    passesIntoBox: integer("passes_into_box"),

    // Possession
    touches: integer("touches"),
    carries: integer("carries"),
    progressiveRuns: integer("progressive_runs"),
    miscontrols: integer("miscontrols"),
    dispossessed: integer("dispossessed"),

    // Goalkeeping
    goalsAgainst: integer("goals_against"),
    saves: integer("saves"),
    savePct: numeric("save_pct", { precision: 5, scale: 2 }),
    cleanSheets: integer("clean_sheets"),
    cleanSheetPct: numeric("clean_sheet_pct", { precision: 5, scale: 2 }),
    penaltiesFaced: integer("penalties_faced"),
    penaltySaves: integer("penalty_saves"),

    // Provenance
    matchConfidence: text("match_confidence"), // high|medium|low
    fbrefName: text("fbref_name"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("player_club_stats_player_idx").on(t.realPlayerId),
    index("player_club_stats_season_idx").on(t.season),
  ]
);

export type PlayerClubStat = typeof playerClubStats.$inferSelect;

/**
 * Cache of Gemini Layer 3 research per player. Prevents re-spending the
 * API budget when we re-run compute:ratings. Refreshed by passing
 * --with-ai which forces a re-call.
 *
 * One row per player. Versioned by `prompt_version` so we can invalidate
 * the cache when we change the prompt.
 */
export const geminiResearch = pgTable(
  "gemini_research",
  {
    realPlayerId: uuid("real_player_id")
      .primaryKey()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    model: text("model").notNull(), // e.g. "gemini-2.5-flash-lite"
    promptVersion: text("prompt_version").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    confidence: text("confidence").notNull(), // high|medium|low
    reasoning: text("reasoning"),
    researchedAt: timestamp("researched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  }
);

export type GeminiResearch = typeof geminiResearch.$inferSelect;
