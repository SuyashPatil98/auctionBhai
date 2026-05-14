import {
  boolean,
  char,
  date,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { positionEnum } from "./_enums";

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").unique(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const countries = pgTable("countries", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").unique(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(), // ISO 3166-1 alpha-3
  flagUrl: text("flag_url"),
  groupLetter: char("group_letter", { length: 1 }),
  eliminatedAt: timestamp("eliminated_at", { withTimezone: true }),
  // Team-strength prior, used by the bracket Monte Carlo. Higher = stronger.
  elo: numeric("elo", { precision: 6, scale: 1 }),
  // Output of the simulator: expected games played in WC 2026.
  // 3.0 = group-stage exit, up to ~7.5 for heavy favorites.
  expectedMatches: numeric("expected_matches", { precision: 3, scale: 2 }),
  expectedMatchesUpdatedAt: timestamp("expected_matches_updated_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const realPlayers = pgTable("real_players", {
  id: uuid("id").primaryKey().defaultRandom(),
  countryId: uuid("country_id")
    .notNull()
    .references(() => countries.id, { onDelete: "restrict" }),
  externalId: text("external_id").unique(),
  fullName: text("full_name").notNull(),
  displayName: text("display_name").notNull(),
  position: positionEnum("position").notNull(),
  shirtNumber: smallint("shirt_number"),
  dob: date("dob"),
  photoUrl: text("photo_url"),
  club: text("club"),
  isActive: boolean("is_active").notNull().default(true),
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Tournament = typeof tournaments.$inferSelect;
export type Country = typeof countries.$inferSelect;
export type RealPlayer = typeof realPlayers.$inferSelect;
