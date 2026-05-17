-- ============================================================================
-- 022: Trades Lite — manager↔manager player swap with credit balancing
-- ============================================================================
--
-- Each proposer chooses one of their players and one of the recipient's
-- players (same position) + an optional credit transfer. Recipient
-- accepts/rejects. Capped at 2 ACCEPTED trades per manager per weekly
-- trading window. Locked once R32 starts.

do $$ begin
  create type trade_status as enum (
    'pending',
    'accepted',
    'rejected',
    'withdrawn',
    'expired'
  );
exception when duplicate_object then null; end $$;

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  window_key text not null,
  proposer_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  proposer_player_id uuid not null references real_players(id) on delete restrict,
  recipient_player_id uuid not null references real_players(id) on delete restrict,
  -- Signed credit transfer from proposer to recipient. Positive: proposer
  -- pays recipient. Negative: recipient pays proposer. Zero: even swap.
  credit_from_proposer integer not null default 0,
  status trade_status not null default 'pending',
  message text,                                  -- optional human note
  proposed_at timestamp with time zone not null default now(),
  decided_at timestamp with time zone,
  decision_message text,                         -- reason on reject/withdraw
  check (proposer_id <> recipient_id),
  check (proposer_player_id <> recipient_player_id)
);

create index if not exists trades_recipient_pending_idx
  on trades (recipient_id, status)
  where status = 'pending';

create index if not exists trades_proposer_idx on trades (proposer_id);

create index if not exists trades_window_idx on trades (window_key);

-- One pending proposal per (proposer, recipient, both player ids) pair
create unique index if not exists trades_pending_dedupe_uq
  on trades (window_key, proposer_id, recipient_id, proposer_player_id, recipient_player_id)
  where status = 'pending';

-- Realtime so the recipient sees new proposals + decisions land live
do $$ begin
  begin alter publication supabase_realtime add table trades;
    exception when duplicate_object then null; end;
end $$;
