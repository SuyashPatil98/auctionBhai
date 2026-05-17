import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./auth";
import { realPlayers } from "./tournament";

/**
 * Trades Lite — manager↔manager swap with credit balancing.
 *
 * Mirrors lib/db/sql/022_trades.sql.
 */

export const tradeStatusEnum = pgEnum("trade_status", [
  "pending",
  "accepted",
  "rejected",
  "withdrawn",
  "expired",
]);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    windowKey: text("window_key").notNull(),
    proposerId: uuid("proposer_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    proposerPlayerId: uuid("proposer_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    recipientPlayerId: uuid("recipient_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    /** Signed. +N = proposer pays recipient. -N = recipient pays proposer. */
    creditFromProposer: integer("credit_from_proposer").notNull().default(0),
    status: tradeStatusEnum("status").notNull().default("pending"),
    message: text("message"),
    proposedAt: timestamp("proposed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionMessage: text("decision_message"),
  },
  (t) => [
    index("trades_recipient_pending_idx").on(t.recipientId, t.status),
    index("trades_proposer_idx").on(t.proposerId),
    index("trades_window_idx").on(t.windowKey),
    uniqueIndex("trades_pending_dedupe_uq")
      .on(
        t.windowKey,
        t.proposerId,
        t.recipientId,
        t.proposerPlayerId,
        t.recipientPlayerId
      )
      .where(sql`status = 'pending'`),
    check(
      "trade_distinct_parties_chk",
      sql`${t.proposerId} <> ${t.recipientId}`
    ),
    check(
      "trade_distinct_players_chk",
      sql`${t.proposerPlayerId} <> ${t.recipientPlayerId}`
    ),
  ]
);

export type Trade = typeof trades.$inferSelect;
