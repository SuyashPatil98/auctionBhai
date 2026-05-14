-- Staging table for the dcaribou/transfermarkt-datasets snapshot.
-- Mirrors lib/db/schema/transfermarkt.ts; safe to re-run.

create table if not exists transfermarkt_players (
  tm_player_id integer primary key,
  name text not null,
  country_of_citizenship text,
  date_of_birth date,
  position text,
  sub_position text,
  current_club_name text,
  current_club_domestic_competition_id text,
  market_value_eur bigint,
  highest_market_value_eur bigint,
  international_caps integer,
  international_goals integer,
  image_url text,
  raw jsonb,
  imported_at timestamp with time zone not null default now()
);

create index if not exists tm_players_name_idx
  on transfermarkt_players (name);
create index if not exists tm_players_citizenship_idx
  on transfermarkt_players (country_of_citizenship);
create index if not exists tm_players_dob_idx
  on transfermarkt_players (date_of_birth);
