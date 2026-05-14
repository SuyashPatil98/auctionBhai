-- player_club_stats: per-player per-season FBref data.
-- gemini_research:   cached Layer 3 output so re-runs are cheap.

create table if not exists player_club_stats (
  id uuid primary key default gen_random_uuid(),
  real_player_id uuid not null references real_players(id) on delete cascade,

  source text not null,
  season text not null,
  competition text,
  squad text,

  matches_played integer,
  starts integer,
  minutes integer,

  goals integer,
  assists integer,
  non_penalty_goals integer,
  penalties integer,
  penalty_attempts integer,

  xg numeric(6,2),
  xag numeric(6,2),
  npxg numeric(6,2),

  goals_per_90 numeric(5,2),
  assists_per_90 numeric(5,2),
  xg_per_90 numeric(5,2),
  xag_per_90 numeric(5,2),

  yellow_cards integer,
  red_cards integer,

  match_confidence text,
  fbref_name text,
  raw jsonb,
  imported_at timestamp with time zone not null default now()
);

create index if not exists player_club_stats_player_idx
  on player_club_stats (real_player_id);
create index if not exists player_club_stats_season_idx
  on player_club_stats (season);

create table if not exists gemini_research (
  real_player_id uuid primary key references real_players(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  score numeric(5,2) not null,
  confidence text not null,
  reasoning text,
  researched_at timestamp with time zone not null default now()
);
