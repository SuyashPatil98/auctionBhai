import {
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { realPlayers } from "./tournament";

/**
 * WC pedigree — aggregated player stats from World Cups 1998-2022.
 * Players with no entry are treated as 0 by the rating engine (correct
 * "no pedigree" signal). Schema matches `lib/db/sql/012_wc_pedigree.sql`.
 */
export const wcPedigree = pgTable(
  "wc_pedigree",
  {
    realPlayerId: uuid("real_player_id")
      .primaryKey()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    wcGoals: smallint("wc_goals").notNull().default(0),
    wcAssists: smallint("wc_assists").notNull().default(0),
    wcAppearances: smallint("wc_appearances").notNull().default(0),
    wcTournaments: smallint("wc_tournaments").notNull().default(0),
    source: text("source"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("wc_pedigree_goals_idx").on(t.wcGoals),
    index("wc_pedigree_apps_idx").on(t.wcAppearances),
  ]
);

export type WcPedigree = typeof wcPedigree.$inferSelect;
