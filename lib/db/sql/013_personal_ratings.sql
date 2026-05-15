-- ============================================================================
-- 013: personal scouting ratings — schema for Phase 4
-- ============================================================================
--
-- Four tables + two enums supporting per-manager personalized ratings.
-- Each manager configures saved "rating profiles" (factor + importance
-- combos); applying a profile to a player produces a `personal_ratings` row
-- via the weighted-geometric-mean formula in lib/personal-rating/compute.ts.
--
-- `player_factor_percentiles` is a materialized table: for every player +
-- factor, the percentile rank within that player's position bucket. The
-- compute engine joins against this; recomputed via `pnpm compute:percentiles`
-- whenever upstream data refreshes.

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

do $$ begin
  create type rating_factor as enum (
    -- Attacking (FBref season stats)
    'season_goals',
    'season_assists',
    'goals_per_90',
    'assists_per_90',
    'xg_per_90',
    'xag_per_90',
    'minutes_played',
    -- Profile (player attributes)
    'age',                  -- direction: lower better (inverted by compute)
    'market_value_eur',
    'international_caps',
    'goals_per_cap',
    -- WC pedigree (1998-2022)
    'wc_goals',
    'wc_assists',
    'wc_appearances',
    'wc_tournaments',
    -- Meta
    'empirical_rating'      -- the canonical rating itself, as a meta-factor
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type factor_importance as enum ('important', 'standard');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- rating_profiles — each manager's saved formulas
-- ----------------------------------------------------------------------------

create table if not exists rating_profiles (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  -- Set when the draft transitions from 'scheduled' to 'live'. Read-only
  -- after this. Cleared if draft is reset (commissioner action).
  locked_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index if not exists rating_profiles_manager_idx
  on rating_profiles (manager_id);

-- ----------------------------------------------------------------------------
-- rating_profile_factors — factor + importance per profile
-- ----------------------------------------------------------------------------

create table if not exists rating_profile_factors (
  profile_id uuid not null references rating_profiles(id) on delete cascade,
  factor_id rating_factor not null,
  importance factor_importance not null,
  primary key (profile_id, factor_id)
);

-- ----------------------------------------------------------------------------
-- personal_ratings — one row per (manager, player) where the manager has
-- explicitly rated this player. Absence = "not on this manager's list".
-- ----------------------------------------------------------------------------

create table if not exists personal_ratings (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references profiles(id) on delete cascade,
  real_player_id uuid not null references real_players(id) on delete cascade,
  -- Which profile produced this rating. NULL means custom per-player weights
  -- without a profile (rare).
  source_profile_id uuid references rating_profiles(id) on delete set null,
  -- Per-player factor overrides on top of the profile.
  -- Shape: [{ factor_id: 'goals_per_90', importance: 'important' }, ...].
  overrides jsonb,
  score numeric(5, 2) not null,
  -- Diagnostic: how many factors actually had data for this player vs total.
  -- Helps the UI show "low coverage" badges.
  coverage_count smallint not null,
  total_factors smallint not null,
  computed_at timestamp with time zone not null default now(),
  unique (manager_id, real_player_id)
);

create index if not exists personal_ratings_player_idx
  on personal_ratings (real_player_id);
create index if not exists personal_ratings_manager_idx
  on personal_ratings (manager_id);

-- Realtime publication so other managers see each other's ratings live.
-- PK is `id` (uuid), so default replica identity works fine.
do $$ begin
  begin
    alter publication supabase_realtime add table personal_ratings;
  exception when duplicate_object then null; end;
end $$;

-- ----------------------------------------------------------------------------
-- player_factor_percentiles — materialized: percentile per player per factor,
-- scoped to position bucket.
-- ----------------------------------------------------------------------------

create table if not exists player_factor_percentiles (
  real_player_id uuid not null references real_players(id) on delete cascade,
  factor_id rating_factor not null,
  position_bucket text not null, -- GK/CB/FB/DM/CM/AM/W/ST or fallback DEF/MID/FWD
  percentile numeric(5, 4) not null, -- 0.0000 to 1.0000
  has_data boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  primary key (real_player_id, factor_id)
);

create index if not exists pfp_factor_idx
  on player_factor_percentiles (factor_id, position_bucket);
