alter table public.cloud_strategy_runs
  add column risk_utc_day text,
  add column day_start_equity numeric(38, 18),
  add constraint cloud_runs_risk_utc_day_format
    check (risk_utc_day is null or risk_utc_day ~ '^\d{4}-\d{2}-\d{2}$'),
  add constraint cloud_runs_day_start_equity_positive
    check (day_start_equity is null or day_start_equity > 0),
  add constraint cloud_runs_daily_equity_pair
    check ((risk_utc_day is null) = (day_start_equity is null));

comment on column public.cloud_strategy_runs.risk_utc_day is
  'UTC day associated with the persisted start-of-day equity risk checkpoint.';
comment on column public.cloud_strategy_runs.day_start_equity is
  'First observed positive account equity for the run on risk_utc_day; used by daily-loss controls.';
