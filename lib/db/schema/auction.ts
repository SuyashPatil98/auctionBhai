import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./auth";
import { leagues } from "./league";
import { realPlayers } from "./tournament";

// ============================================================================
// Enums
// ============================================================================

export const draftStatusEnum = pgEnum("draft_status", [
  "scheduled", // configured, not yet started
  "live", // active — bidders connected, lots being nominated/bid
  "paused", // commissioner paused (bathroom break etc.)
  "complete", // every manager filled their roster
]);

export const lotStatusEnum = pgEnum("lot_status", [
  "nominating", // nominator has the floor, must pick a player (timer N s)
  "open", // bidding active
  "closing", // anti-snipe window
  "sold", // resolved → winner takes player
  "passed", // nomination expired with zero bids
  "voided", // commissioner cancelled (audit-logged)
]);

export const rosterAcquisitionEnum = pgEnum("roster_acquisition", [
  "auction",
  "free_agent",
  "trade",
]);

// ============================================================================
// drafts — one row per league's draft event
// ============================================================================

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  leagueId: uuid("league_id")
    .notNull()
    .references(() => leagues.id, { onDelete: "cascade" }),
  status: draftStatusEnum("status").notNull().default("scheduled"),

  // Auction parameters — kept on the draft itself so rules can't shift
  // mid-event by editing the league row.
  budgetPerManager: integer("budget_per_manager").notNull().default(200),
  rosterSize: smallint("roster_size").notNull().default(20),
  rosterRequirements: jsonb("roster_requirements")
    .$type<Record<string, number>>()
    .notNull()
    .default({ GK: 2, DEF: 6, MID: 7, FWD: 5 }),
  minBid: smallint("min_bid").notNull().default(1),
  incrementRules: jsonb("increment_rules")
    .$type<Array<{ threshold: number; inc: number }>>()
    .notNull()
    .default([
      { threshold: 0, inc: 1 },
      { threshold: 50, inc: 5 },
    ]),

  // Timing
  nominateSeconds: smallint("nominate_seconds").notNull().default(30),
  bidSeconds: smallint("bid_seconds").notNull().default(20),
  antisnipeTriggerSeconds: smallint("antisnipe_trigger_seconds")
    .notNull()
    .default(10),
  antisnipeExtendSeconds: smallint("antisnipe_extend_seconds")
    .notNull()
    .default(15),

  // State pointers
  currentNominatorProfileId: uuid("current_nominator_profile_id").references(
    () => profiles.id,
    { onDelete: "set null" }
  ),
  currentLotId: uuid("current_lot_id"), // FK declared after auctionLots below
  nextLotNumber: integer("next_lot_number").notNull().default(1),

  // Lifecycle
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Draft = typeof drafts.$inferSelect;

// ============================================================================
// auction_lots — one row per player put up for bid
// ============================================================================

export const auctionLots = pgTable(
  "auction_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    lotNumber: integer("lot_number").notNull(),

    nominatedBy: uuid("nominated_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),

    openingBid: integer("opening_bid").notNull(),
    currentBid: integer("current_bid").notNull(),
    currentBidderId: uuid("current_bidder_id").references(() => profiles.id, {
      onDelete: "set null",
    }),

    status: lotStatusEnum("status").notNull().default("nominating"),
    closesAt: timestamp("closes_at", { withTimezone: true }),

    nominatedAt: timestamp("nominated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    voidReason: text("void_reason"),
  },
  (t) => [
    uniqueIndex("auction_lots_draft_lot_num_idx").on(t.draftId, t.lotNumber),
    // Prevent the same player from being on two open lots in the same draft.
    // Voided lots are exempt so a commissioner re-nomination works.
    uniqueIndex("auction_lots_draft_player_idx")
      .on(t.draftId, t.realPlayerId)
      .where(sql`status <> 'voided'`),
    index("auction_lots_status_idx").on(t.draftId, t.status),
    index("auction_lots_closes_at_idx").on(t.closesAt),
  ]
);

export type AuctionLot = typeof auctionLots.$inferSelect;

// ============================================================================
// auction_bids — every bid ever submitted (audit trail)
// ============================================================================

export const auctionBids = pgTable(
  "auction_bids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lotId: uuid("lot_id")
      .notNull()
      .references(() => auctionLots.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    amount: integer("amount").notNull(),
    isProxyGenerated: boolean("is_proxy_generated").notNull().default(false),
    accepted: boolean("accepted").notNull(),
    rejectionReason: text("rejection_reason"),
    placedAt: timestamp("placed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("auction_bids_lot_placed_idx").on(t.lotId, t.placedAt),
    index("auction_bids_profile_idx").on(t.profileId),
  ]
);

export type AuctionBid = typeof auctionBids.$inferSelect;

// ============================================================================
// proxy_bids — max-bid intents, one per (lot, profile)
// ============================================================================

export const proxyBids = pgTable(
  "proxy_bids",
  {
    lotId: uuid("lot_id")
      .notNull()
      .references(() => auctionLots.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    maxAmount: integer("max_amount").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.lotId, t.profileId] })]
);

export type ProxyBid = typeof proxyBids.$inferSelect;

// ============================================================================
// manager_budgets — cached running totals, trigger-maintained
// ============================================================================

export const managerBudgets = pgTable(
  "manager_budgets",
  {
    draftId: uuid("draft_id")
      .notNull()
      .references(() => drafts.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    spent: integer("spent").notNull().default(0),
    committed: integer("committed").notNull().default(0),
    slotsFilled: smallint("slots_filled").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.draftId, t.profileId] })]
);

export type ManagerBudget = typeof managerBudgets.$inferSelect;

// ============================================================================
// rosters — the surviving record of which manager owns which player
// ============================================================================

export const rosters = pgTable(
  "rosters",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    acquiredVia: rosterAcquisitionEnum("acquired_via").notNull(),
    acquiredAmount: integer("acquired_amount"), // null for free agent / trade
    acquiredAt: timestamp("acquired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    droppedAt: timestamp("dropped_at", { withTimezone: true }),
  },
  (t) => [
    // Exclusive ownership invariant: at any one time, a player is on at most
    // one manager's *active* roster within a league.
    uniqueIndex("rosters_active_unique_idx")
      .on(t.leagueId, t.realPlayerId)
      .where(sql`dropped_at is null`),
    index("rosters_profile_idx").on(t.leagueId, t.profileId),
  ]
);

export type Roster = typeof rosters.$inferSelect;
