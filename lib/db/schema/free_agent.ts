import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./auth";
import { realPlayers } from "./tournament";

/**
 * Free-agent sealed-bid auction.
 *
 * Mirrors lib/db/sql/021_free_agent_bids.sql.
 *
 * - free_agent_bids        one row per (window, player, bidder)
 * - free_agent_resolutions one row per (window, player) once resolved
 *
 * window_key is the Tuesday date in YYYY-MM-DD (UTC) — buckets bids by
 * trading window without needing a separate "lots" table.
 */

export const freeAgentBids = pgTable(
  "free_agent_bids",
  {
    windowKey: text("window_key").notNull(),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.windowKey, t.realPlayerId, t.profileId] }),
    check("amount_positive_chk", sql`${t.amount} >= 1`),
    index("fab_window_player_idx").on(t.windowKey, t.realPlayerId),
    index("fab_window_bidder_idx").on(t.windowKey, t.profileId),
  ]
);

export const freeAgentResolutions = pgTable(
  "free_agent_resolutions",
  {
    windowKey: text("window_key").notNull(),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    winnerProfileId: uuid("winner_profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    winningAmount: integer("winning_amount"),
    biddersCount: smallint("bidders_count").notNull().default(0),
    resolvedAt: timestamp("resolved_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.windowKey, t.realPlayerId] }),
    index("far_window_winner_idx").on(t.windowKey, t.winnerProfileId),
  ]
);

export type FreeAgentBid = typeof freeAgentBids.$inferSelect;
export type FreeAgentResolution = typeof freeAgentResolutions.$inferSelect;
