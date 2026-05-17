-- ============================================================================
-- 020: bump default draft settings — 500 cr / 16-player squad / 2-5-5-4
-- ============================================================================
--
-- Per user direction: "make budget customizable, 16-player squad, 2/5/5/4
-- split." The drafts row is editable from /draft/admin going forward;
-- this migration sets the new defaults for any FUTURE drafts and aligns
-- the existing row (since prod hasn't actually auctioned yet).

alter table drafts alter column budget_per_manager set default 500;
alter table drafts alter column roster_size set default 16;
alter table drafts alter column roster_requirements set default '{"GK":2,"DEF":5,"MID":5,"FWD":4}'::jsonb;

-- Update the existing draft row (status='scheduled' = safe to mutate).
update drafts
   set budget_per_manager  = 500,
       roster_size         = 16,
       roster_requirements = '{"GK":2,"DEF":5,"MID":5,"FWD":4}'::jsonb
 where status = 'scheduled';
