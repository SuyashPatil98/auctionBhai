-- ============================================================================
-- 019: relax manager_lineups cardinality CHECKs
-- ============================================================================
--
-- Originally the table enforced cardinality(starter_ids)=11 and
-- cardinality(bench_ids)=4 via CHECK constraints. That's right for the WC
-- (11 starters + 4 bench = 15-of-20 squad) but locks us out of:
--
--   - test fixtures with smaller lineups (e.g. the UCL dry-run idea, where
--     each fantasy team is only 5 players)
--   - any future formats with different roster shapes
--
-- We're moving cardinality validation to the server action — it consults
-- the formation picker + fixture.is_test_fixture (when introduced) to
-- determine what's valid. CHECK still enforces captain != vice since that
-- invariant is universal.

alter table manager_lineups drop constraint if exists starter_count_chk;
alter table manager_lineups drop constraint if exists bench_count_chk;

-- captain_vice_distinct_chk stays — it's a true invariant, not a format rule.
