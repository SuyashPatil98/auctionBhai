-- Extensions needed by the rating engine.
--
-- pg_trgm: trigram similarity for fuzzy player-name matching when joining
-- our real_players against the transfermarkt_players staging table.
--
-- unaccent: strips accents at query time (e.g. "Vinícius" → "Vinicius").
-- We don't include it in indexes — its default form is not IMMUTABLE on
-- Supabase. Apply unaccent in the matching query instead.

create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- Trigram indexes on lowercased names. The trigram match handles accent
-- variation acceptably without unaccent (overlapping trigrams still cluster
-- accented and un-accented variants together).
create index if not exists tm_players_name_trgm_idx
  on transfermarkt_players
  using gin (lower(name) gin_trgm_ops);

create index if not exists real_players_name_trgm_idx
  on real_players
  using gin (lower(full_name) gin_trgm_ops);
