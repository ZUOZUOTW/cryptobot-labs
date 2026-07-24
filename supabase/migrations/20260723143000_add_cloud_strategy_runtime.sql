create table public.cloud_strategy_runs (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  connection_id text not null,
  executor_shard_id text not null references public.executor_shards(id),
  strategy_version_id text not null,
  name text not null,
  mode text not null default 'futures-demo' check (mode in ('futures-demo', 'live')),
  state text not null default 'running' check (state in ('running', 'paused', 'stopped', 'error')),
  config_json jsonb not null,
  risk_json jsonb not null,
  configuration_hash text not null,
  version bigint not null default 1 check (version > 0),
  last_candle_at bigint,
  last_evaluated_at bigint,
  last_signal_json jsonb,
  last_error_code text,
  consecutive_failures bigint not null default 0 check (consecutive_failures >= 0),
  lease_owner text,
  lease_expires_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  started_at bigint not null,
  stopped_at bigint,
  constraint cloud_runs_connection_user_fk foreign key (connection_id, user_id)
    references public.weex_connections(id, user_id),
  constraint cloud_runs_strategy_user_fk foreign key (strategy_version_id, user_id)
    references public.strategy_versions(id, user_id),
  constraint cloud_runs_id_format check (id ~ '^crun_[A-Za-z0-9_-]{16,64}$'),
  constraint cloud_runs_name_length check (length(name) between 1 and 100),
  constraint cloud_runs_hash_format check (configuration_hash ~ '^[a-f0-9]{64}$'),
  constraint cloud_runs_config_object check (jsonb_typeof(config_json) = 'object'),
  constraint cloud_runs_risk_object check (jsonb_typeof(risk_json) = 'object'),
  constraint cloud_runs_signal_object check (last_signal_json is null or jsonb_typeof(last_signal_json) = 'object')
);

create index cloud_runs_user_created_idx on public.cloud_strategy_runs(user_id, created_at desc);
create index cloud_runs_executor_state_idx on public.cloud_strategy_runs(executor_shard_id, state, updated_at)
  where state = 'running';

create table private.cloud_order_intents (
  run_id text not null references public.cloud_strategy_runs(id) on delete cascade,
  candle_close_at bigint not null,
  client_order_id text not null,
  signal_json jsonb not null,
  intent_json jsonb,
  status text not null check (status in ('claimed', 'risk-rejected', 'acknowledged', 'rejected', 'unknown')),
  exchange_order_id text,
  error_code text,
  created_at bigint not null,
  updated_at bigint not null,
  primary key (run_id, candle_close_at),
  unique (client_order_id),
  constraint cloud_order_client_id_format check (client_order_id ~ '^cb_[A-Za-z0-9_-]{32}$'),
  constraint cloud_order_signal_object check (jsonb_typeof(signal_json) = 'object'),
  constraint cloud_order_intent_object check (intent_json is null or jsonb_typeof(intent_json) = 'object')
);

create index cloud_orders_run_created_idx on private.cloud_order_intents(run_id, created_at desc);

alter table public.cloud_strategy_runs enable row level security;
alter table private.cloud_order_intents enable row level security;
create policy deny_data_api on public.cloud_strategy_runs
  for all to anon, authenticated using (false) with check (false);
create policy deny_data_api on private.cloud_order_intents
  for all to anon, authenticated using (false) with check (false);
revoke all on table public.cloud_strategy_runs from anon, authenticated;
revoke all on table private.cloud_order_intents from public, anon, authenticated;

grant select, insert, update on table public.cloud_strategy_runs to cryptobot_executor;
grant select, insert, update on table private.cloud_order_intents to cryptobot_executor;
create policy executor_runtime on public.cloud_strategy_runs
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on private.cloud_order_intents
  for all to cryptobot_executor using (true) with check (true);

comment on table public.cloud_strategy_runs is
  'Website-managed strategies continuously executed by the fixed-egress AWS executor.';
comment on table private.cloud_order_intents is
  'Durable per-candle idempotency and exchange submission evidence for cloud strategy runs.';
