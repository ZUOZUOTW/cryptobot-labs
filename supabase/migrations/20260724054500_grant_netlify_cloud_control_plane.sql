grant select on table public.weex_connections to cryptobot_netlify;

grant select, insert, update on table public.cloud_strategy_runs to cryptobot_netlify;

comment on table public.cloud_strategy_runs is
  'Website-managed strategies continuously executed by the fixed-egress AWS executor. '
  'The Netlify control plane may create and manage user-scoped runs; the executor owns evaluation and order execution.';
