import {
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./auth";
import { realPlayers } from "./tournament";

export const ratingSourceEnum = pgEnum("rating_source", [
  "baseline",
  "computed",
]);

export const priceTierEnum = pgEnum("price_tier", [
  "superstar",
  "star",
  "starter",
  "rotation",
  "depth",
]);

/**
 * Time-series of per-player ratings. The latest row per real_player_id is
 * the current rating; older rows are kept for audit + form trend lines.
 */
export const playerRatings = pgTable(
  "player_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
    rating: numeric("rating", { precision: 5, scale: 2 }).notNull(),
    formRating: numeric("form_rating", { precision: 5, scale: 2 }).notNull(),
    source: ratingSourceEnum("source").notNull(),
    inputs: jsonb("inputs").$type<Record<string, unknown>>(),
  },
  (t) => [
    index("player_ratings_player_as_of_idx").on(t.realPlayerId, t.asOf.desc()),
  ]
);

/**
 * Pre-draft auction price for each player. One row per player; recomputed
 * from the latest rating + national-team bracket projection.
 */
export const playerPrices = pgTable("player_prices", {
  realPlayerId: uuid("real_player_id")
    .primaryKey()
    .references(() => realPlayers.id, { onDelete: "cascade" }),
  price: integer("price").notNull(),
  tier: priceTierEnum("tier").notNull(),
  expectedPoints: numeric("expected_points", { precision: 6, scale: 2 }),
  expectedMatches: numeric("expected_matches", { precision: 3, scale: 1 }),
  computedAt: timestamp("computed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  inputs: jsonb("inputs").$type<Record<string, unknown>>(),
});

/**
 * Manager Elo + skill-vs-luck decomposition. Computed nightly during the
 * tournament. Hidden from managers in-flight; revealed on the awards page.
 */
export const managerRatings = pgTable(
  "manager_ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    asOf: timestamp("as_of", { withTimezone: true }).notNull().defaultNow(),
    elo: numeric("elo", { precision: 6, scale: 1 }).notNull(),
    expectedPoints: numeric("expected_points", { precision: 7, scale: 2 }),
    actualPoints: integer("actual_points"),
    luckIndex: numeric("luck_index", { precision: 5, scale: 2 }),
    skillIndex: numeric("skill_index", { precision: 5, scale: 2 }),
  },
  (t) => [
    index("manager_ratings_profile_as_of_idx").on(t.profileId, t.asOf.desc()),
  ]
);

export type PlayerRating = typeof playerRatings.$inferSelect;
export type NewPlayerRating = typeof playerRatings.$inferInsert;
export type PlayerPrice = typeof playerPrices.$inferSelect;
export type ManagerRating = typeof managerRatings.$inferSelect;
