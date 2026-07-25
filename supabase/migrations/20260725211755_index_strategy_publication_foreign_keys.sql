create index strategy_publications_version_user_idx
  on public.strategy_publications(strategy_version_id, user_id);
create index strategy_publications_backtest_user_idx
  on public.strategy_publications(backtest_job_id, user_id);
drop index if exists public.strategy_publications_backtest_idx;
