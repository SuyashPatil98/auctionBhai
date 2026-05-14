import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Staging table for the dcaribou/transfermarkt-datasets snapshot.
 * We import the full CSV (~37k players); only a slice are WC participants.
 *
 * Source is the natural Transfermarkt player_id, used as the primary key.
 * We re-import periodically (weekly is fine); upserts overwrite stale values.
 */
export const transfermarktPlayers = pgTable(
  "transfermarkt_players",
  {
    tmPlayerId: integer("tm_player_id").primaryKey(),
    name: text("name").notNull(),
    countryOfCitizenship: text("country_of_citizenship"),
    dateOfBirth: date("date_of_birth"),
    position: text("position"), // "Goalkeeper" | "Defender" | "Midfield" | "Attack"
    subPosition: text("sub_position"),
    currentClubName: text("current_club_name"),
    currentClubDomesticCompetitionId: text("current_club_domestic_competition_id"),
    marketValueEur: bigint("market_value_eur", { mode: "number" }),
    highestMarketValueEur: bigint("highest_market_value_eur", {
      mode: "number",
    }),
    internationalCaps: integer("international_caps"),
    internationalGoals: integer("international_goals"),
    imageUrl: text("image_url"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // For fuzzy joining with our real_players. Lowercased name lookup is the
    // common path; trigram support is enabled separately via SQL extension.
    index("tm_players_name_idx").on(t.name),
    index("tm_players_citizenship_idx").on(t.countryOfCitizenship),
    index("tm_players_dob_idx").on(t.dateOfBirth),
  ]
);

export type TransfermarktPlayer = typeof transfermarktPlayers.$inferSelect;
