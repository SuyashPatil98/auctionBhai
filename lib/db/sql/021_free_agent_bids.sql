-- ============================================================================
-- 021: free-agent sealed-bid auction tables
-- ============================================================================
--
-- 5.10: every Tuesday window, managers can place blind bids on any unowned
-- player. At window close, highest bid wins (earliest placed_at as
-- tiebreaker). Lazy model — no upfront "lot" rows, just bids keyed by
-- (window, player, bidder).
--
-- window_key is the Tuesday date in YYYY-MM-DD (UTC). Computed in code
-- from computeWindowState().opensAt so a bid lands in the right bucket.

create table if not exists free_agent_bids (
  window_key text not null,                   -- e.g. '2026-05-19'
  real_player_id uuid not null references real_players(id) on delete restrict,
  profile_id uuid not null references profiles(id) on delete cascade,
  amount integer not null check (amount >= 1),
  placed_at timestamp with time zone not null default now(),
  withdrawn_at timestamp with time zone,
  primary key (window_key, real_player_id, profile_id)
);

create index if not exists fab_window_player_idx
  on free_agent_bids (window_key, real_player_id)
  where withdrawn_at is null;

create index if not exists fab_window_bidder_idx
  on free_agent_bids (window_key, profile_id)
  where withdrawn_at is null;

-- Resolution log — one row per (window, player) once resolved. Lets us
-- show a results panel + skip already-resolved lots on a re-run.
create table if not exists free_agent_resolutions (
  window_key text not null,
  real_player_id uuid not null references real_players(id) on delete restrict,
  winner_profile_id uuid references profiles(id) on delete set null,
  winning_amount integer,                     -- null if no bids / nobody affordable
  bidders_count smallint not null default 0,
  resolved_at timestamp with time zone not null default now(),
  primary key (window_key, real_player_id)
);

create index if not exists far_window_winner_idx
  on free_agent_resolutions (window_key, winner_profile_id);

-- Realtime so bid counts and resolutions push live during the window
do $$ begin
  begin alter publication supabase_realtime add table free_agent_bids;
    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table free_agent_resolutions;
    exception when duplicate_object then null; end;
end $$;
