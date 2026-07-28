alter table public.cloud_strategy_runs
  add column account_asset text,
  add column account_observed_at bigint,
  add column account_equity numeric(38, 18),
  add column available_equity numeric(38, 18),
  add column unrealized_pnl numeric(38, 18),
  add column positions_json jsonb not null default '[]'::jsonb,
  add column evaluation_count bigint not null default 0,
  add column signal_count bigint not null default 0,
  add constraint cloud_runs_account_asset_format
    check (account_asset is null or account_asset ~ '^[A-Z0-9]{2,16}$'),
  add constraint cloud_runs_account_observed_positive
    check (account_observed_at is null or account_observed_at > 0),
  add constraint cloud_runs_account_equity_nonnegative
    check (account_equity is null or account_equity >= 0),
  add constraint cloud_runs_available_equity_nonnegative
    check (available_equity is null or available_equity >= 0),
  add constraint cloud_runs_positions_array
    check (jsonb_typeof(positions_json) = 'array'),
  add constraint cloud_runs_evaluation_count_nonnegative
    check (evaluation_count >= 0),
  add constraint cloud_runs_signal_count_nonnegative
    check (signal_count >= 0 and signal_count <= evaluation_count);

comment on column public.cloud_strategy_runs.account_observed_at is
  'WEEX account snapshot observation time supplied by the fixed-egress executor.';
comment on column public.cloud_strategy_runs.positions_json is
  'Latest secret-free WEEX position snapshot; never contains API credentials.';
comment on column public.cloud_strategy_runs.evaluation_count is
  'Number of completed candle evaluations for this cloud strategy run.';
comment on column public.cloud_strategy_runs.signal_count is
  'Number of completed evaluations whose normalized strategy action was not hold.';
