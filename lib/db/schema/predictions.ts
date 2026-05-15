import {
  index,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./auth";
import { fixtures } from "./fixtures";

/**
 * Score predictions — companion side-game. Each manager can predict the
 * score of every WC fixture; the prediction locks at kickoff. Scoring is
 * FPL-style, see lib/predictions/score.ts.
 *
 * Mirrors lib/db/sql/016_predictions.sql.
 */
export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    homeScore: smallint("home_score").notNull(),
    awayScore: smallint("away_score").notNull(),
    pointsAwarded: smallint("points_awarded"), // null until scored
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("predictions_profile_fixture_uq").on(t.profileId, t.fixtureId),
    index("predictions_profile_idx").on(t.profileId),
    index("predictions_fixture_idx").on(t.fixtureId),
  ]
);

export type Prediction = typeof predictions.$inferSelect;
