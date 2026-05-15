-- ============================================================================
-- 012: WC pedigree — aggregated player stats from World Cups 1998-2022
-- ============================================================================
--
-- One row per WC-pedigreed player. Players with no WC history are absent
-- from this table; a left join produces NULLs which the rating engine
-- treats as 0 (correct signal — "no pedigree" should mean low percentile).
--
-- Aggregates intentionally span 7 tournaments (1998, 2002, 2006, 2010,
-- 2014, 2018, 2022). Per-tournament breakdown is out of scope for now —
-- managers care about volume + frequency, not specific tournament splits.

create table if not exists wc_pedigree (
  real_player_id uuid primary key
    references real_players(id) on delete cascade,
  wc_goals smallint not null default 0,
  wc_assists smallint not null default 0,
  wc_appearances smallint not null default 0,
  wc_tournaments smallint not null default 0,
  source text,                 -- where the numbers came from (manual, wikipedia, etc.)
  updated_at timestamp with time zone not null default now()
);

create index if not exists wc_pedigree_goals_idx on wc_pedigree (wc_goals desc);
create index if not exists wc_pedigree_apps_idx on wc_pedigree (wc_appearances desc);
