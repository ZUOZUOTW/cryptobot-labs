create index cloud_runs_connection_user_idx
  on public.cloud_strategy_runs(connection_id, user_id);

create index cloud_runs_strategy_user_idx
  on public.cloud_strategy_runs(strategy_version_id, user_id);
