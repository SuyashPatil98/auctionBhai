import {
  boolean,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./auth";
import { realPlayers } from "./tournament";

/**
 * Mirrors lib/db/sql/013_personal_ratings.sql. Source of truth for the
 * enums/tables is the SQL file; this gives us typed Drizzle access.
 */

export const ratingFactorEnum = pgEnum("rating_factor", [
  "season_goals",
  "season_assists",
  "goals_per_90",
  "assists_per_90",
  "xg_per_90",
  "xag_per_90",
  "minutes_played",
  "age",
  "market_value_eur",
  "international_caps",
  "goals_per_cap",
  "wc_goals",
  "wc_assists",
  "wc_appearances",
  "wc_tournaments",
  "empirical_rating",
  // Added in migration 015
  "tackles_per_90",
  "tackles_won_per_90",
  "interceptions_per_90",
  "blocks_per_90",
  "clearances_per_90",
  "recoveries_per_90",
  "key_passes_per_90",
  "progressive_passes_per_90",
  "progressive_carries_per_90",
  "pass_completion_pct",
  "xa_per_90",
  "touches_per_90",
  "saves_per_90",
  "save_pct",
  "clean_sheets",
  "clean_sheet_pct",
  "goals_conceded_per_90",
]);

export const factorImportanceEnum = pgEnum("factor_importance", [
  "important",
  "standard",
]);

export const ratingProfiles = pgTable(
  "rating_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("rating_profiles_manager_idx").on(t.managerId)]
);

export const ratingProfileFactors = pgTable(
  "rating_profile_factors",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => ratingProfiles.id, { onDelete: "cascade" }),
    factorId: ratingFactorEnum("factor_id").notNull(),
    importance: factorImportanceEnum("importance").notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.factorId] })]
);

export const personalRatings = pgTable(
  "personal_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managerId: uuid("manager_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    sourceProfileId: uuid("source_profile_id").references(
      () => ratingProfiles.id,
      { onDelete: "set null" }
    ),
    overrides: jsonb("overrides").$type<
      Array<{ factor_id: string; importance: "important" | "standard" }>
    >(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    coverageCount: smallint("coverage_count").notNull(),
    totalFactors: smallint("total_factors").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("personal_ratings_manager_player_uq").on(
      t.managerId,
      t.realPlayerId
    ),
    index("personal_ratings_player_idx").on(t.realPlayerId),
    index("personal_ratings_manager_idx").on(t.managerId),
  ]
);

export const playerFactorPercentiles = pgTable(
  "player_factor_percentiles",
  {
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    factorId: ratingFactorEnum("factor_id").notNull(),
    positionBucket: text("position_bucket").notNull(),
    percentile: numeric("percentile", { precision: 5, scale: 4 }).notNull(),
    hasData: boolean("has_data").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.realPlayerId, t.factorId] }),
    index("pfp_factor_idx").on(t.factorId, t.positionBucket),
  ]
);

export type RatingProfile = typeof ratingProfiles.$inferSelect;
export type RatingProfileFactor = typeof ratingProfileFactors.$inferSelect;
export type PersonalRating = typeof personalRatings.$inferSelect;
export type PlayerFactorPercentile = typeof playerFactorPercentiles.$inferSelect;
