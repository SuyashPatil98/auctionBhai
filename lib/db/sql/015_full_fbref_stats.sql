-- ============================================================================
-- 015: extend player_club_stats with full FBref schema + add factors
-- ============================================================================
--
-- The wider hubertsidorowicz CSV (102 columns) brings defensive, possession,
-- passing, and goalkeeping stats we previously hardcoded to NULL. Schema
-- changes here mirror what `import:fbref` will now populate.
--
-- Existing columns we already store and will now actually fill:
--   xg, xag, npxg, xg_per_90, xag_per_90
--
-- New columns added below.

-- ----------------------------------------------------------------------------
-- Defensive
-- ----------------------------------------------------------------------------
alter table player_club_stats
  add column if not exists tackles integer,
  add column if not exists tackles_won integer,
  add column if not exists interceptions integer,
  add column if not exists blocks integer,
  add column if not exists clearances integer,
  add column if not exists errors integer,
  add column if not exists recoveries integer;

-- ----------------------------------------------------------------------------
-- Passing / creativity
-- ----------------------------------------------------------------------------
alter table player_club_stats
  add column if not exists key_passes integer,
  add column if not exists progressive_passes integer,
  add column if not exists progressive_carries integer,
  add column if not exists pass_completion_pct numeric(5, 2),
  add column if not exists expected_assists numeric(6, 2),
  add column if not exists passes_into_box integer;

-- ----------------------------------------------------------------------------
-- Possession
-- ----------------------------------------------------------------------------
alter table player_club_stats
  add column if not exists touches integer,
  add column if not exists carries integer,
  add column if not exists progressive_runs integer,
  add column if not exists miscontrols integer,
  add column if not exists dispossessed integer;

-- ----------------------------------------------------------------------------
-- Goalkeeping
-- ----------------------------------------------------------------------------
alter table player_club_stats
  add column if not exists goals_against integer,
  add column if not exists saves integer,
  add column if not exists save_pct numeric(5, 2),
  add column if not exists clean_sheets integer,
  add column if not exists clean_sheet_pct numeric(5, 2),
  add column if not exists penalties_faced integer,
  add column if not exists penalty_saves integer;

-- ----------------------------------------------------------------------------
-- Extend the rating_factor enum with new factor IDs. Enum values can only
-- be APPENDED in Postgres, so order matters less than uniqueness.
-- ----------------------------------------------------------------------------
do $$ begin
  alter type rating_factor add value if not exists 'tackles_per_90';
  alter type rating_factor add value if not exists 'tackles_won_per_90';
  alter type rating_factor add value if not exists 'interceptions_per_90';
  alter type rating_factor add value if not exists 'blocks_per_90';
  alter type rating_factor add value if not exists 'clearances_per_90';
  alter type rating_factor add value if not exists 'recoveries_per_90';
  alter type rating_factor add value if not exists 'key_passes_per_90';
  alter type rating_factor add value if not exists 'progressive_passes_per_90';
  alter type rating_factor add value if not exists 'progressive_carries_per_90';
  alter type rating_factor add value if not exists 'pass_completion_pct';
  alter type rating_factor add value if not exists 'xa_per_90';
  alter type rating_factor add value if not exists 'touches_per_90';
  alter type rating_factor add value if not exists 'saves_per_90';
  alter type rating_factor add value if not exists 'save_pct';
  alter type rating_factor add value if not exists 'clean_sheets';
  alter type rating_factor add value if not exists 'clean_sheet_pct';
  alter type rating_factor add value if not exists 'goals_conceded_per_90';
exception when invalid_text_representation then null; end $$;
