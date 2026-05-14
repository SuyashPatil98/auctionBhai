-- Rating-engine output tables. Mirrors lib/db/schema/rating.ts.
-- Safe to re-run.

do $$ begin
  create type rating_source as enum ('baseline', 'computed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type price_tier as enum ('superstar', 'star', 'starter', 'rotation', 'depth');
exception when duplicate_object then null; end $$;

create table if not exists player_ratings (
  id uuid primary key default gen_random_uuid(),
  real_player_id uuid not null references real_players(id) on delete cascade,
  as_of timestamp with time zone not null default now(),
  rating numeric(5,2) not null,
  form_rating numeric(5,2) not null,
  source rating_source not null,
  inputs jsonb
);

create index if not exists player_ratings_player_as_of_idx
  on player_ratings (real_player_id, as_of desc);

create table if not exists player_prices (
  real_player_id uuid primary key references real_players(id) on delete cascade,
  price integer not null,
  tier price_tier not null,
  expected_points numeric(6,2),
  expected_matches numeric(3,1),
  computed_at timestamp with time zone not null default now(),
  inputs jsonb
);

create table if not exists manager_ratings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  as_of timestamp with time zone not null default now(),
  elo numeric(6,1) not null,
  expected_points numeric(7,2),
  actual_points integer,
  luck_index numeric(5,2),
  skill_index numeric(5,2)
);

create index if not exists manager_ratings_profile_as_of_idx
  on manager_ratings (profile_id, as_of desc);
