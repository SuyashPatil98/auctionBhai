-- ============================================================================
-- 018: profile timezone pin
-- ============================================================================
--
-- Optional IANA timezone (e.g. "Europe/London") to pin kickoff display in.
-- NULL means "use the browser's detected timezone." Edited on /account.
--
-- We don't validate the string in SQL — Postgres has no IANA registry and
-- Intl.DateTimeFormat is the authority. The server action validates against
-- a known list before writing.

alter table profiles
  add column if not exists timezone text;
