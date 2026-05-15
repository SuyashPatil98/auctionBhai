/**
 * Factor registry for personal scouting ratings (Phase 4).
 *
 * Each entry declares: where the raw value lives, which direction is "good",
 * which position buckets it's most relevant for, and human-readable copy
 * for the UI. The compute-percentiles script reads this registry to know
 * what to fetch and how.
 *
 * Source of truth for factor IDs is the `rating_factor` enum in
 * lib/db/sql/013_personal_ratings.sql. Keep these in sync.
 */

import type { Bucket } from "@/lib/rating/buckets";

export type FactorId =
  | "season_goals"
  | "season_assists"
  | "goals_per_90"
  | "assists_per_90"
  | "xg_per_90"
  | "xag_per_90"
  | "minutes_played"
  // Defensive (new in 015)
  | "tackles_per_90"
  | "tackles_won_per_90"
  | "interceptions_per_90"
  | "blocks_per_90"
  | "clearances_per_90"
  | "recoveries_per_90"
  // Passing / creativity (new in 015)
  | "key_passes_per_90"
  | "progressive_passes_per_90"
  | "progressive_carries_per_90"
  | "pass_completion_pct"
  | "xa_per_90"
  | "touches_per_90"
  // Goalkeeping (new in 015)
  | "saves_per_90"
  | "save_pct"
  | "clean_sheets"
  | "clean_sheet_pct"
  | "goals_conceded_per_90"
  // Profile
  | "age"
  | "market_value_eur"
  | "international_caps"
  | "goals_per_cap"
  // WC pedigree
  | "wc_goals"
  | "wc_assists"
  | "wc_appearances"
  | "wc_tournaments"
  | "empirical_rating";

export type FactorCategory =
  | "attacking"
  | "defensive"
  | "passing"
  | "possession"
  | "goalkeeping"
  | "playing_time"
  | "profile"
  | "wc_pedigree"
  | "meta";

export type FactorDef = {
  id: FactorId;
  label: string;
  description: string;
  category: FactorCategory;
  /** "higher_better": top percentile = 1.0. "lower_better": gets inverted. */
  direction: "higher_better" | "lower_better";
  /**
   * Sub-position buckets this factor is most relevant for. Used by the UI
   * to surface relevant factors first; doesn't restrict the manager.
   */
  relevantBuckets: Bucket[];
  /**
   * Whether coverage is patchy (FBref / TM data isn't on every player).
   * Sparse factors get a UI badge so managers know low coverage is a risk.
   */
  sparse: boolean;
};

const ALL_FIELD_BUCKETS: Bucket[] = [
  "CB",
  "FB",
  "DM",
  "CM",
  "AM",
  "W",
  "ST",
  "DEF",
  "MID",
  "FWD",
];

export const FACTORS: Record<FactorId, FactorDef> = {
  // -------- Attacking (FBref season stats; ~40% coverage) --------
  season_goals: {
    id: "season_goals",
    label: "Goals (season)",
    description: "Total goals in the current league season.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["AM", "W", "ST", "FWD"],
    sparse: true,
  },
  season_assists: {
    id: "season_assists",
    label: "Assists (season)",
    description: "Total assists in the current league season.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "ST", "MID", "FWD"],
    sparse: true,
  },
  goals_per_90: {
    id: "goals_per_90",
    label: "Goals / 90",
    description: "Goals per 90 minutes — strike-rate.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["AM", "W", "ST", "FWD"],
    sparse: true,
  },
  assists_per_90: {
    id: "assists_per_90",
    label: "Assists / 90",
    description: "Assists per 90 minutes.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "MID"],
    sparse: true,
  },
  xg_per_90: {
    id: "xg_per_90",
    label: "xG / 90",
    description: "Expected goals per 90. Smoother signal than raw goals.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["AM", "W", "ST", "FWD"],
    sparse: true,
  },
  xag_per_90: {
    id: "xag_per_90",
    label: "xAG / 90",
    description: "Expected assisted goals per 90 — chance creation.",
    category: "attacking",
    direction: "higher_better",
    relevantBuckets: ["CM", "AM", "W", "MID"],
    sparse: true,
  },

  // -------- Defensive --------
  tackles_per_90: {
    id: "tackles_per_90",
    label: "Tackles / 90",
    description: "Total tackles per 90 minutes — defensive activity.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "CM", "DEF", "MID"],
    sparse: true,
  },
  tackles_won_per_90: {
    id: "tackles_won_per_90",
    label: "Tackles won / 90",
    description: "Tackles successfully won — success rate matters.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "CM", "DEF", "MID"],
    sparse: true,
  },
  interceptions_per_90: {
    id: "interceptions_per_90",
    label: "Interceptions / 90",
    description: "Reads the game and cuts out passes.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "CM", "DEF", "MID"],
    sparse: true,
  },
  blocks_per_90: {
    id: "blocks_per_90",
    label: "Blocks / 90",
    description: "Shots + passes blocked.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "DEF"],
    sparse: true,
  },
  clearances_per_90: {
    id: "clearances_per_90",
    label: "Clearances / 90",
    description: "Defensive clearances — last-ditch and aerial.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DEF"],
    sparse: true,
  },
  recoveries_per_90: {
    id: "recoveries_per_90",
    label: "Ball recoveries / 90",
    description: "Loose balls won back. High for energetic mids.",
    category: "defensive",
    direction: "higher_better",
    relevantBuckets: ["DM", "CM", "AM", "MID"],
    sparse: true,
  },

  // -------- Passing / creativity --------
  key_passes_per_90: {
    id: "key_passes_per_90",
    label: "Key passes / 90",
    description: "Passes that directly lead to a shot.",
    category: "passing",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "MID"],
    sparse: true,
  },
  progressive_passes_per_90: {
    id: "progressive_passes_per_90",
    label: "Progressive passes / 90",
    description: "Passes that move the ball meaningfully upfield.",
    category: "passing",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "CM", "AM", "DEF", "MID"],
    sparse: true,
  },
  progressive_carries_per_90: {
    id: "progressive_carries_per_90",
    label: "Progressive carries / 90",
    description: "Carries that push the ball into dangerous areas.",
    category: "passing",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "ST", "MID", "FWD"],
    sparse: true,
  },
  pass_completion_pct: {
    id: "pass_completion_pct",
    label: "Pass completion %",
    description: "Pass accuracy — ball-playing quality.",
    category: "passing",
    direction: "higher_better",
    relevantBuckets: ["GK", "CB", "FB", "DM", "CM", "AM", "DEF", "MID"],
    sparse: true,
  },
  xa_per_90: {
    id: "xa_per_90",
    label: "xA / 90",
    description: "Expected assists from each pass — chance creation quality.",
    category: "passing",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "MID"],
    sparse: true,
  },

  // -------- Possession --------
  touches_per_90: {
    id: "touches_per_90",
    label: "Touches / 90",
    description: "Ball involvement. High for deep-lying playmakers.",
    category: "possession",
    direction: "higher_better",
    relevantBuckets: ["CB", "FB", "DM", "CM", "AM", "DEF", "MID"],
    sparse: true,
  },

  // -------- Playing time --------
  minutes_played: {
    id: "minutes_played",
    label: "Minutes (season)",
    description: "League minutes — proxy for trust + fitness.",
    category: "playing_time",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: true,
  },

  // -------- Goalkeeping --------
  saves_per_90: {
    id: "saves_per_90",
    label: "Saves / 90",
    description: "Save volume — partially a function of team defense.",
    category: "goalkeeping",
    direction: "higher_better",
    relevantBuckets: ["GK"],
    sparse: true,
  },
  save_pct: {
    id: "save_pct",
    label: "Save %",
    description: "Save success rate — purer GK shot-stopping quality.",
    category: "goalkeeping",
    direction: "higher_better",
    relevantBuckets: ["GK"],
    sparse: true,
  },
  clean_sheets: {
    id: "clean_sheets",
    label: "Clean sheets",
    description: "Season total clean sheets.",
    category: "goalkeeping",
    direction: "higher_better",
    relevantBuckets: ["GK"],
    sparse: true,
  },
  clean_sheet_pct: {
    id: "clean_sheet_pct",
    label: "Clean sheet %",
    description: "Clean sheets per match played.",
    category: "goalkeeping",
    direction: "higher_better",
    relevantBuckets: ["GK"],
    sparse: true,
  },
  goals_conceded_per_90: {
    id: "goals_conceded_per_90",
    label: "Goals conceded / 90",
    description: "Fewer is better — inverted by the percentile engine.",
    category: "goalkeeping",
    direction: "lower_better",
    relevantBuckets: ["GK"],
    sparse: true,
  },

  // -------- Profile (player attributes; high coverage) --------
  age: {
    id: "age",
    label: "Age",
    description: "Younger players score higher (factor inverted).",
    category: "profile",
    direction: "lower_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: false,
  },
  market_value_eur: {
    id: "market_value_eur",
    label: "Market value",
    description: "Transfermarkt valuation. Strong consensus signal.",
    category: "profile",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: false,
  },
  international_caps: {
    id: "international_caps",
    label: "International caps",
    description: "Career national-team appearances.",
    category: "profile",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: false,
  },
  goals_per_cap: {
    id: "goals_per_cap",
    label: "Goals / cap",
    description: "International scoring efficiency.",
    category: "profile",
    direction: "higher_better",
    relevantBuckets: ["AM", "W", "ST", "FWD"],
    sparse: false,
  },

  // -------- WC pedigree (1998-2022; ~50 players covered) --------
  wc_goals: {
    id: "wc_goals",
    label: "WC goals",
    description: "Career goals scored at World Cups 1998-2022.",
    category: "wc_pedigree",
    direction: "higher_better",
    relevantBuckets: ["AM", "W", "ST", "FWD"],
    sparse: true,
  },
  wc_assists: {
    id: "wc_assists",
    label: "WC assists",
    description: "Career WC assists 1998-2022.",
    category: "wc_pedigree",
    direction: "higher_better",
    relevantBuckets: ["FB", "CM", "AM", "W", "MID"],
    sparse: true,
  },
  wc_appearances: {
    id: "wc_appearances",
    label: "WC appearances",
    description: "Total WC matches played 1998-2022.",
    category: "wc_pedigree",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: true,
  },
  wc_tournaments: {
    id: "wc_tournaments",
    label: "WC tournaments",
    description: "Number of World Cups played (1998-2022).",
    category: "wc_pedigree",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: true,
  },

  // -------- Meta --------
  empirical_rating: {
    id: "empirical_rating",
    label: "Consensus rating",
    description:
      "The canonical 4-layer empirical rating. Useful as a 'trust the model' anchor.",
    category: "meta",
    direction: "higher_better",
    relevantBuckets: ALL_FIELD_BUCKETS.concat(["GK"]),
    sparse: false,
  },
};

export const FACTORS_ARRAY: FactorDef[] = Object.values(FACTORS);

/**
 * Order factors with the most-relevant ones for the given bucket first.
 * The UI uses this to pin position-relevant factors to the top of the picker.
 */
export function factorsForBucket(bucket: Bucket): FactorDef[] {
  const relevant: FactorDef[] = [];
  const other: FactorDef[] = [];
  for (const f of FACTORS_ARRAY) {
    if (f.relevantBuckets.includes(bucket)) relevant.push(f);
    else other.push(f);
  }
  return [...relevant, ...other];
}
