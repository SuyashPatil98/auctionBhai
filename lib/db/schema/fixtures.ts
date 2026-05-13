import {
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import {
  fixtureSideEnum,
  fixtureStageEnum,
  fixtureStatusEnum,
  matchEventSourceEnum,
  matchEventTypeEnum,
} from "./_enums";
import { countries, realPlayers, tournaments } from "./tournament";

export const fixtures = pgTable(
  "fixtures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id, { onDelete: "cascade" }),
    externalId: text("external_id").unique(),
    kickoffAt: timestamp("kickoff_at", { withTimezone: true }).notNull(),
    stage: fixtureStageEnum("stage").notNull(),
    matchday: smallint("matchday").notNull(),
    homeCountryId: uuid("home_country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "restrict" }),
    awayCountryId: uuid("away_country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "restrict" }),
    homeScore: smallint("home_score"),
    awayScore: smallint("away_score"),
    status: fixtureStatusEnum("status").notNull().default("scheduled"),
    venue: text("venue"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("fixtures_kickoff_idx").on(t.kickoffAt),
    index("fixtures_status_idx").on(t.status),
    index("fixtures_matchday_idx").on(t.matchday),
  ]
);

export const fixtureLineups = pgTable(
  "fixture_lineups",
  {
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    side: fixtureSideEnum("side").notNull(),
    isStarter: boolean("is_starter").notNull(),
    shirtPosition: text("shirt_position"),
    minutesPlayed: smallint("minutes_played"),
  },
  (t) => [primaryKey({ columns: [t.fixtureId, t.realPlayerId] })]
);

export const matchEvents = pgTable(
  "match_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    assistPlayerId: uuid("assist_player_id").references(() => realPlayers.id, {
      onDelete: "set null",
    }),
    minute: smallint("minute").notNull(),
    addedTime: smallint("added_time").notNull().default(0),
    type: matchEventTypeEnum("type").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    source: matchEventSourceEnum("source").notNull().default("api"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("match_events_fixture_minute_idx").on(t.fixtureId, t.minute),
    index("match_events_player_idx").on(t.realPlayerId),
  ]
);

export const playerMatchStats = pgTable(
  "player_match_stats",
  {
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    realPlayerId: uuid("real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "cascade" }),
    minutes: smallint("minutes").notNull().default(0),
    goals: smallint("goals").notNull().default(0),
    assists: smallint("assists").notNull().default(0),
    cleanSheet: boolean("clean_sheet").notNull().default(false),
    goalsConceded: smallint("goals_conceded").notNull().default(0),
    pensMissed: smallint("pens_missed").notNull().default(0),
    yellows: smallint("yellows").notNull().default(0),
    reds: smallint("reds").notNull().default(0),
    ownGoals: smallint("own_goals").notNull().default(0),
    motmVoteWinner: boolean("motm_vote_winner").notNull().default(false),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.fixtureId, t.realPlayerId] })]
);

export type Fixture = typeof fixtures.$inferSelect;
export type FixtureLineup = typeof fixtureLineups.$inferSelect;
export type MatchEvent = typeof matchEvents.$inferSelect;
export type PlayerMatchStat = typeof playerMatchStats.$inferSelect;
