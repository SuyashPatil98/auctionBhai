-- Per-country simulation inputs + outputs.
--   elo:               team strength prior, seeded from FIFA rank
--                      + recent international form
--   expected_matches:  E[games played in WC 2026] from the Monte Carlo
--                      simulator. 3.0 for group-stage exits, up to ~7.5 for
--                      heavy favorites
--   expected_matches_updated_at: when the sim last refreshed this

alter table countries
  add column if not exists elo numeric(6,1),
  add column if not exists expected_matches numeric(3,2),
  add column if not exists expected_matches_updated_at timestamp with time zone;
