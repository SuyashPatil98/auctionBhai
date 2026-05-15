-- ============================================================================
-- 011: opt-out (pass) feature + timer recalibration
-- ============================================================================
--
-- 1. New table `auction_lot_passes` — records "manager X passed on lot Y."
--    Composite PK on (lot_id, profile_id) so each manager can pass at most
--    once per lot. Used to early-close lots once everyone-not-leading has
--    passed.
--
-- 2. Update auction-timer defaults from 20s/10s/15s to 45s/15s/15s, and
--    apply to the existing scheduled draft row.

-- ----------------------------------------------------------------------------
-- auction_lot_passes
-- ----------------------------------------------------------------------------

create table if not exists auction_lot_passes (
  lot_id uuid not null references auction_lots(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  passed_at timestamp with time zone not null default now(),
  primary key (lot_id, profile_id)
);

create index if not exists auction_lot_passes_lot_idx
  on auction_lot_passes (lot_id);

-- Realtime publication: managers should see passes appear live so the
-- "passed" badges update without polling. PK exists (composite) so default
-- replica identity is fine here (no rosters-style bug).
do $$
begin
  begin
    alter publication supabase_realtime add table auction_lot_passes;
  exception when duplicate_object then null; end;
end $$;

-- ----------------------------------------------------------------------------
-- Timer defaults
-- ----------------------------------------------------------------------------

alter table drafts alter column bid_seconds set default 45;
alter table drafts alter column antisnipe_trigger_seconds set default 15;
-- antisnipe_extend_seconds stays at 15 (already correct)

-- Apply new timers to any existing scheduled drafts (won't touch a live one,
-- to avoid changing the rules mid-auction).
update drafts
   set bid_seconds = 45,
       antisnipe_trigger_seconds = 15,
       antisnipe_extend_seconds = 15
 where status = 'scheduled';
