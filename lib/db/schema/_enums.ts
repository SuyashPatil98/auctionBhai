import { pgEnum } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["member", "commissioner"]);

export const leagueFormatEnum = pgEnum("league_format", ["auction"]);
export const leagueStatusEnum = pgEnum("league_status", [
  "setup",
  "drafting",
  "active",
  "complete",
]);

export const positionEnum = pgEnum("position", ["GK", "DEF", "MID", "FWD"]);

export const fixtureStageEnum = pgEnum("fixture_stage", [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "third",
  "final",
]);

export const fixtureStatusEnum = pgEnum("fixture_status", [
  "scheduled",
  "live",
  "ht",
  "ft",
  "postponed",
  "cancelled",
]);

export const fixtureSideEnum = pgEnum("fixture_side", ["home", "away"]);

export const matchEventTypeEnum = pgEnum("match_event_type", [
  "goal",
  "own_goal",
  "pen_scored",
  "pen_missed",
  "yellow",
  "red",
  "sub_in",
  "sub_out",
]);

export const matchEventSourceEnum = pgEnum("match_event_source", [
  "api",
  "manual",
]);

export const ingestionKindEnum = pgEnum("ingestion_kind", [
  "fixtures",
  "squads",
  "results",
  "lineups",
  "stats",
]);

export const aiFeatureEnum = pgEnum("ai_feature", [
  "smart_search",
]);
