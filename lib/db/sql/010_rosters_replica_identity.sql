-- rosters has no primary key (composite uniqueness is enforced by a partial
-- unique index, not a PK). Without a replica identity, Postgres can't emit
-- DELETE events on tables included in a publication — every cascade or manual
-- delete that touches rosters fails with:
--   "cannot delete from table 'rosters' because it does not have a replica
--    identity and publishes deletes"
--
-- REPLICA IDENTITY FULL makes the WAL record carry the full old row. For a
-- 4-manager × 20-slot table, the overhead is trivial and it keeps the
-- supabase_realtime publication functional.

alter table rosters replica identity full;
