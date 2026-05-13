import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { profiles } from "./auth";

export const aiSearchCache = pgTable(
  "ai_search_cache",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queryHash: text("query_hash").notNull(),
    queryText: text("query_text").notNull(),
    intent: jsonb("intent").$type<Record<string, unknown>>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("ai_search_cache_hash_idx").on(t.queryHash),
    index("ai_search_cache_expires_idx").on(t.expiresAt),
  ]
);

export const aiSearchLog = pgTable(
  "ai_search_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    queryText: text("query_text").notNull(),
    intent: jsonb("intent").$type<Record<string, unknown>>(),
    resultCount: integer("result_count"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_search_log_profile_idx").on(t.profileId, t.createdAt)]
);

export type AiSearchCache = typeof aiSearchCache.$inferSelect;
export type AiSearchLog = typeof aiSearchLog.$inferSelect;
