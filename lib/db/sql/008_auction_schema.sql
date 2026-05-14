-- Auction draft schema (Phase 3.1).
-- Mirrors lib/db/schema/auction.ts.

-- enums ----------------------------------------------------------------

do $$ begin
  create type draft_status as enum ('scheduled','live','paused','complete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lot_status as enum (
    'nominating','open','closing','sold','passed','voided'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type roster_acquisition as enum ('auction','free_agent','trade');
exception when duplicate_object then null; end $$;

-- drafts ---------------------------------------------------------------

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  status draft_status not null default 'scheduled',

  budget_per_manager integer not null default 200,
  roster_size smallint not null default 20,
  roster_requirements jsonb not null default '{"GK":2,"DEF":6,"MID":7,"FWD":5}',
  min_bid smallint not null default 1,
  increment_rules jsonb not null default '[{"threshold":0,"inc":1},{"threshold":50,"inc":5}]',

  nominate_seconds smallint not null default 30,
  bid_seconds smallint not null default 20,
  antisnipe_trigger_seconds smallint not null default 10,
  antisnipe_extend_seconds smallint not null default 15,

  current_nominator_profile_id uuid references profiles(id) on delete set null,
  current_lot_id uuid,
  next_lot_number integer not null default 1,

  paused_at timestamp with time zone,
  scheduled_for timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

-- auction_lots ---------------------------------------------------------

create table if not exists auction_lots (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references drafts(id) on delete cascade,
  lot_number integer not null,

  nominated_by uuid not null references profiles(id) on delete restrict,
  real_player_id uuid not null references real_players(id) on delete restrict,

  opening_bid integer not null,
  current_bid integer not null,
  current_bidder_id uuid references profiles(id) on delete set null,

  status lot_status not null default 'nominating',
  closes_at timestamp with time zone,

  nominated_at timestamp with time zone not null default now(),
  sold_at timestamp with time zone,
  void_reason text
);

create unique index if not exists auction_lots_draft_lot_num_idx
  on auction_lots (draft_id, lot_number);

-- Same player can only have one non-voided lot per draft.
create unique index if not exists auction_lots_draft_player_idx
  on auction_lots (draft_id, real_player_id)
  where status <> 'voided';

create index if not exists auction_lots_status_idx
  on auction_lots (draft_id, status);
create index if not exists auction_lots_closes_at_idx
  on auction_lots (closes_at);

-- Now FK drafts.current_lot_id → auction_lots.id (circular dep handled
-- by adding it AFTER auction_lots exists).
do $$ begin
  alter table drafts
    add constraint drafts_current_lot_fk
    foreign key (current_lot_id) references auction_lots(id) on delete set null;
exception when duplicate_object then null; end $$;

-- auction_bids ---------------------------------------------------------

create table if not exists auction_bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references auction_lots(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete restrict,
  amount integer not null,
  is_proxy_generated boolean not null default false,
  accepted boolean not null,
  rejection_reason text,
  placed_at timestamp with time zone not null default now()
);

create index if not exists auction_bids_lot_placed_idx
  on auction_bids (lot_id, placed_at);
create index if not exists auction_bids_profile_idx
  on auction_bids (profile_id);

-- proxy_bids -----------------------------------------------------------

create table if not exists proxy_bids (
  lot_id uuid not null references auction_lots(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  max_amount integer not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (lot_id, profile_id)
);

-- manager_budgets ------------------------------------------------------

create table if not exists manager_budgets (
  draft_id uuid not null references drafts(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  spent integer not null default 0,
  committed integer not null default 0,
  slots_filled smallint not null default 0,
  updated_at timestamp with time zone not null default now(),
  primary key (draft_id, profile_id)
);

-- rosters --------------------------------------------------------------

create table if not exists rosters (
  league_id uuid not null references leagues(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  real_player_id uuid not null references real_players(id) on delete restrict,
  acquired_via roster_acquisition not null,
  acquired_amount integer,
  acquired_at timestamp with time zone not null default now(),
  dropped_at timestamp with time zone
);

-- Exclusive ownership invariant: a player belongs to at most one active
-- roster per league at any moment.
create unique index if not exists rosters_active_unique_idx
  on rosters (league_id, real_player_id)
  where dropped_at is null;

create index if not exists rosters_profile_idx
  on rosters (league_id, profile_id);

-- ======================================================================
-- Triggers
-- ======================================================================

-- When a lot transitions to 'sold', materialize the roster row + bump
-- the manager's spent/slotsFilled counters in manager_budgets.
create or replace function public.handle_lot_sold()
returns trigger
language plpgsql
as $$
declare
  v_league_id uuid;
begin
  -- Only react on the actual transition into 'sold'
  if (new.status = 'sold' and (old.status is null or old.status <> 'sold')) then
    select d.league_id into v_league_id from drafts d where d.id = new.draft_id;

    -- 1. Insert roster row. Partial unique index handles double-fire.
    insert into rosters (league_id, profile_id, real_player_id, acquired_via, acquired_amount)
    values (v_league_id, new.current_bidder_id, new.real_player_id, 'auction', new.current_bid)
    on conflict do nothing;

    -- 2. Bump manager_budgets (upsert)
    insert into manager_budgets (draft_id, profile_id, spent, slots_filled)
    values (new.draft_id, new.current_bidder_id, new.current_bid, 1)
    on conflict (draft_id, profile_id) do update
      set spent = manager_budgets.spent + excluded.spent,
          slots_filled = manager_budgets.slots_filled + 1,
          updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists on_lot_sold on auction_lots;
create trigger on_lot_sold
  after update of status on auction_lots
  for each row
  execute function public.handle_lot_sold();
