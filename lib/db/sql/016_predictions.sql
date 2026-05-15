-- ============================================================================
-- 016: score predictions — a side game on top of the auction league
-- ============================================================================
--
-- Each manager can predict the score of every WC fixture. Predictions lock
-- at kickoff (enforced in the server action — the row is still mutable in
-- SQL, but the API refuses).
--
-- Scoring (FPL-style, 3 tiers):
--   exact score                       → 3 points
--   correct outcome + goal difference → 2 points
--   correct outcome only              → 1 point
--   otherwise                         → 0 points
--
-- points_awarded is nullable: NULL means the fixture hasn't been scored
-- yet (no final score recorded, or post-fixture scoring hasn't run).

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  fixture_id uuid not null references fixtures(id) on delete cascade,
  home_score smallint not null,
  away_score smallint not null,
  points_awarded smallint,                       -- null until scored
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (profile_id, fixture_id)
);

create index if not exists predictions_profile_idx on predictions (profile_id);
create index if not exists predictions_fixture_idx on predictions (fixture_id);

-- Realtime so the leaderboard updates live for everyone as predictions
-- get scored.
do $$ begin
  begin
    alter publication supabase_realtime add table predictions;
  exception when duplicate_object then null; end;
end $$;
