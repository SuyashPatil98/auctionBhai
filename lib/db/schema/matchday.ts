import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
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
import { realPlayers } from "./tournament";
import { fixtures } from "./fixtures";

/**
 * Phase 5 — matchday scoring spine. Mirrors lib/db/sql/017_phase5_scoring.sql.
 *
 * - manager_lineups   per-manager XI + bench + captain/vice per matchday
 * - fixture_stewards  who is responsible for entering stats on each fixture
 * - motm_votes        peer-vote MOTM, self-vote allowed
 * - matchday_scores   computed snapshot, idempotent recompute via
 *                     lib/scoring/matchday.ts
 */

export const managerLineups = pgTable(
  "manager_lineups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchday: smallint("matchday").notNull(),
    formation: text("formation").notNull(),
    starterIds: uuid("starter_ids").array().notNull(),
    benchIds: uuid("bench_ids").array().notNull(),
    captainId: uuid("captain_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    viceId: uuid("vice_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    isAutoFilled: boolean("is_auto_filled").notNull().default(false),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("manager_lineups_profile_md_uq").on(t.profileId, t.matchday),
    index("manager_lineups_matchday_idx").on(t.matchday),
    check("starter_count_chk", sql`cardinality(${t.starterIds}) = 11`),
    check("bench_count_chk", sql`cardinality(${t.benchIds}) = 4`),
    check("captain_vice_distinct_chk", sql`${t.captainId} <> ${t.viceId}`),
  ]
);

export const fixtureStewards = pgTable(
  "fixture_stewards",
  {
    fixtureId: uuid("fixture_id")
      .primaryKey()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    stewardProfileId: uuid("steward_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reassignedAt: timestamp("reassigned_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => [index("fixture_stewards_steward_idx").on(t.stewardProfileId)]
);

export const motmVotes = pgTable(
  "motm_votes",
  {
    fixtureId: uuid("fixture_id")
      .notNull()
      .references(() => fixtures.id, { onDelete: "cascade" }),
    voterProfileId: uuid("voter_profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    candidateRealPlayerId: uuid("candidate_real_player_id")
      .notNull()
      .references(() => realPlayers.id, { onDelete: "restrict" }),
    votedAt: timestamp("voted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fixtureId, t.voterProfileId] }),
    index("motm_votes_candidate_idx").on(t.candidateRealPlayerId),
  ]
);

export const matchdayScores = pgTable(
  "matchday_scores",
  {
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    matchday: smallint("matchday").notNull(),
    points: numeric("points", { precision: 6, scale: 1 }).notNull(),
    breakdown: jsonb("breakdown").notNull(),
    captainPlayed: boolean("captain_played").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.matchday] }),
    index("matchday_scores_matchday_idx").on(t.matchday),
  ]
);

export type ManagerLineup = typeof managerLineups.$inferSelect;
export type FixtureSteward = typeof fixtureStewards.$inferSelect;
export type MotmVote = typeof motmVotes.$inferSelect;
export type MatchdayScore = typeof matchdayScores.$inferSelect;
