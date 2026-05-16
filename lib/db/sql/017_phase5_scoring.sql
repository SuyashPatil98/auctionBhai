-- ============================================================================
-- 017: Phase 5 — lineups, MOTM votes, matchday scoring
-- ============================================================================
--
-- Adds the data spine for matchday scoring:
--
--   manager_lineups   one per (manager × matchday): formation, XI, bench,
--                     captain, vice. Auto-filled from the prior matchday if
--                     the manager doesn't set one before first kickoff of the
--                     window.
--
--   fixture_stewards  one steward per fixture, auto-assigned round-robin
--                     across league members. Stewards enter stats post-FT.
--
--   motm_votes        one vote per (fixture × voter). Self-vote allowed.
--                     Window opens after stats are finalized, closes after
--                     24h or once every member has voted.
--
--   matchday_scores   one per (manager × matchday). Computed snapshot —
--                     idempotent, replayable from lineups + stats + votes.
--
-- Schema additions:
--   - player_match_stats.pen_saves       (GK-specific scoring input)
--   - fixtures.stats_finalized_at        (steward submitted final stats)
--   - fixtures.motm_resolved_at          (MOTM vote window closed)

-- ----------------------------------------------------------------------------
-- player_match_stats: pen_saves column
-- ----------------------------------------------------------------------------

alter table player_match_stats
  add column if not exists pen_saves smallint not null default 0;

-- ----------------------------------------------------------------------------
-- fixtures: lifecycle timestamps for stat entry + MOTM resolution
-- ----------------------------------------------------------------------------

alter table fixtures
  add column if not exists stats_finalized_at timestamp with time zone,
  add column if not exists motm_resolved_at   timestamp with time zone;

-- ----------------------------------------------------------------------------
-- manager_lineups
-- ----------------------------------------------------------------------------
--
-- starter_ids / bench_ids are uuid arrays referencing real_players(id).
-- Referential integrity is enforced in the server action (validate against
-- the manager's roster), not by FK — Postgres doesn't support FK on array
-- elements without trigger gymnastics, and for 4 friends this is fine.

create table if not exists manager_lineups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  matchday smallint not null,
  formation text not null,                            -- "4-3-3" etc.
  starter_ids uuid[] not null,                        -- exactly 11
  bench_ids   uuid[] not null,                        -- exactly 4, in order
  captain_id  uuid not null references real_players(id) on delete restrict,
  vice_id     uuid not null references real_players(id) on delete restrict,
  is_auto_filled boolean not null default false,      -- carried over from prior MD
  locked_at timestamp with time zone,                 -- when first fixture of MD kicked off
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (profile_id, matchday),
  check (cardinality(starter_ids) = 11),
  check (cardinality(bench_ids)   = 4),
  check (captain_id <> vice_id)
);

create index if not exists manager_lineups_matchday_idx on manager_lineups (matchday);

-- ----------------------------------------------------------------------------
-- fixture_stewards
-- ----------------------------------------------------------------------------
--
-- Single steward per fixture (kept simple — if a steward is unavailable,
-- commissioner reassigns via direct UPDATE / admin tool). Stewards are
-- assigned round-robin by a script that sorts fixtures by kickoff_at and
-- league members by profile id, then walks the list.

create table if not exists fixture_stewards (
  fixture_id uuid primary key references fixtures(id) on delete cascade,
  steward_profile_id uuid not null references profiles(id) on delete restrict,
  assigned_at timestamp with time zone not null default now(),
  reassigned_at timestamp with time zone,
  notes text
);

create index if not exists fixture_stewards_steward_idx
  on fixture_stewards (steward_profile_id);

-- ----------------------------------------------------------------------------
-- motm_votes
-- ----------------------------------------------------------------------------
--
-- Self-votes allowed (decided 2026-05-16). Candidate must be a player who
-- featured in the fixture — enforced in the server action by checking
-- fixture_lineups or player_match_stats.minutes > 0.

create table if not exists motm_votes (
  fixture_id uuid not null references fixtures(id) on delete cascade,
  voter_profile_id uuid not null references profiles(id) on delete cascade,
  candidate_real_player_id uuid not null references real_players(id) on delete restrict,
  voted_at timestamp with time zone not null default now(),
  primary key (fixture_id, voter_profile_id)
);

create index if not exists motm_votes_candidate_idx
  on motm_votes (candidate_real_player_id);

-- ----------------------------------------------------------------------------
-- matchday_scores
-- ----------------------------------------------------------------------------
--
-- Computed snapshot of points awarded to each manager per matchday. The
-- breakdown jsonb stores per-player rows so the UI can render the same
-- reporter-style chips used elsewhere. Recomputable from lineups + stats +
-- votes via lib/scoring/matchday.ts (pure function).
--
-- points is numeric(6,1) — vice promotion's ×1.5 multiplier produces .5
-- values that we don't want to lose to integer rounding.

create table if not exists matchday_scores (
  profile_id uuid not null references profiles(id) on delete cascade,
  matchday smallint not null,
  points numeric(6,1) not null,
  breakdown jsonb not null,                           -- per-player rows
  captain_played boolean not null,                    -- false → vice was promoted
  computed_at timestamp with time zone not null default now(),
  primary key (profile_id, matchday)
);

create index if not exists matchday_scores_matchday_idx on matchday_scores (matchday);

-- ----------------------------------------------------------------------------
-- Realtime publication — push lineup/score changes to clients live
-- ----------------------------------------------------------------------------

do $$ begin
  begin alter publication supabase_realtime add table manager_lineups;
    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table motm_votes;
    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table matchday_scores;
    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table fixture_stewards;
    exception when duplicate_object then null; end;
end $$;
