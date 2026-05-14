-- Enable Supabase Realtime on the auction tables so client-side
-- subscriptions get postgres_changes events.
--
-- Tables added to the supabase_realtime publication are streamed to
-- subscribed clients with row-level events (INSERT/UPDATE/DELETE).

do $$
begin
  -- ADD TABLE is idempotent only if the table isn't already in the
  -- publication. We wrap each in EXCEPTION to make the script
  -- safely re-runnable.
  begin
    alter publication supabase_realtime add table auction_lots;
  exception when duplicate_object then null; end;

  begin
    alter publication supabase_realtime add table auction_bids;
  exception when duplicate_object then null; end;

  begin
    alter publication supabase_realtime add table drafts;
  exception when duplicate_object then null; end;

  begin
    alter publication supabase_realtime add table manager_budgets;
  exception when duplicate_object then null; end;

  begin
    alter publication supabase_realtime add table rosters;
  exception when duplicate_object then null; end;

  begin
    alter publication supabase_realtime add table proxy_bids;
  exception when duplicate_object then null; end;
end $$;
