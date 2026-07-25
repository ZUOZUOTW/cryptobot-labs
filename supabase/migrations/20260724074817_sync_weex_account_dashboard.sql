create table public.weex_account_snapshots (
  connection_id text primary key,
  user_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'error')),
  account_uid text,
  observed_at bigint,
  balances_json jsonb not null default '[]'::jsonb,
  positions_json jsonb not null default '[]'::jsonb,
  account_equity numeric(38, 18),
  available_equity numeric(38, 18),
  unrealized_pnl numeric(38, 18),
  trade_cursor_at bigint not null,
  consecutive_failures bigint not null default 0,
  last_error_code text,
  lease_owner text,
  lease_expires_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  constraint weex_account_snapshots_connection_user_fk
    foreign key (connection_id, user_id)
    references public.weex_connections(id, user_id) on delete cascade,
  constraint weex_account_snapshots_uid_format
    check (account_uid is null or account_uid ~ '^[0-9]{1,32}$'),
  constraint weex_account_snapshots_observed_positive
    check (observed_at is null or observed_at > 0),
  constraint weex_account_snapshots_balances_array
    check (jsonb_typeof(balances_json) = 'array'),
  constraint weex_account_snapshots_positions_array
    check (jsonb_typeof(positions_json) = 'array'),
  constraint weex_account_snapshots_equity_nonnegative
    check (account_equity is null or account_equity >= 0),
  constraint weex_account_snapshots_available_nonnegative
    check (available_equity is null or available_equity >= 0),
  constraint weex_account_snapshots_trade_cursor_positive
    check (trade_cursor_at > 0),
  constraint weex_account_snapshots_failures_nonnegative
    check (consecutive_failures >= 0),
  constraint weex_account_snapshots_error_code_format
    check (last_error_code is null or last_error_code ~ '^[a-z0-9_-]{1,64}$'),
  constraint weex_account_snapshots_lease_pair
    check ((lease_owner is null) = (lease_expires_at is null))
);

create index weex_account_snapshots_user_updated_idx
  on public.weex_account_snapshots(user_id, updated_at desc);
create index weex_account_snapshots_lease_idx
  on public.weex_account_snapshots(lease_expires_at)
  where lease_expires_at is not null;

create table public.weex_realized_pnl_ledger (
  connection_id text not null,
  user_id text not null,
  exchange_trade_id text not null,
  symbol text not null,
  realized_pnl numeric(38, 18) not null,
  commission numeric(38, 18) not null,
  commission_asset text not null,
  net_pnl numeric(38, 18) not null,
  traded_at bigint not null,
  inserted_at bigint not null,
  primary key (connection_id, exchange_trade_id),
  constraint weex_realized_pnl_connection_user_fk
    foreign key (connection_id, user_id)
    references public.weex_connections(id, user_id) on delete cascade,
  constraint weex_realized_pnl_trade_id_format
    check (exchange_trade_id ~ '^[0-9]{1,32}$'),
  constraint weex_realized_pnl_symbol_format
    check (symbol ~ '^[A-Z0-9_]{3,32}$'),
  constraint weex_realized_pnl_commission_nonnegative
    check (commission >= 0),
  constraint weex_realized_pnl_asset_format
    check (commission_asset ~ '^[A-Z0-9]{1,16}$'),
  constraint weex_realized_pnl_traded_positive
    check (traded_at > 0)
);

create index weex_realized_pnl_user_time_idx
  on public.weex_realized_pnl_ledger(user_id, traded_at, exchange_trade_id);

alter table public.weex_account_snapshots enable row level security;
alter table public.weex_realized_pnl_ledger enable row level security;

create policy deny_data_api on public.weex_account_snapshots
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy deny_data_api on public.weex_realized_pnl_ledger
  as restrictive for all to anon, authenticated using (false) with check (false);

create policy executor_runtime on public.weex_account_snapshots
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on public.weex_realized_pnl_ledger
  for all to cryptobot_executor using (true) with check (true);

revoke all on table public.weex_account_snapshots,
  public.weex_realized_pnl_ledger from public, anon, authenticated;

grant select, insert, update on table public.weex_account_snapshots
  to cryptobot_executor;
grant select, insert, update on table public.weex_realized_pnl_ledger
  to cryptobot_executor;

grant select on table public.weex_account_snapshots,
  public.weex_realized_pnl_ledger to cryptobot_netlify;

comment on table public.weex_account_snapshots is
  'Secret-free per-connection WEEX account projection synchronized independently of strategy runs by the fixed-egress executor.';
comment on table public.weex_realized_pnl_ledger is
  'Idempotent WEEX futures trade ledger used to derive auditable cumulative realized net PnL.';
comment on column public.weex_account_snapshots.trade_cursor_at is
  'Inclusive lower bound for the next bounded WEEX trade-history synchronization window.';
