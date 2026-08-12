alter table public.cloud_strategy_runs
  add column if not exists market text,
  add column if not exists symbol text;

create or replace function private.synchronize_cloud_run_target()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  configured_market text;
  configured_symbol text;
  allowed_value jsonb;
  allowed_symbol text;
  canonical_allowed_symbol text;
  target_is_allowed boolean := false;
begin
  configured_market := new.config_json->>'market';
  configured_symbol := regexp_replace(
    regexp_replace(upper(btrim(new.config_json->>'symbol')), '^CMT_', ''),
    '[-/_]',
    '',
    'g'
  );

  if configured_market is null
    or configured_market not in ('spot', 'futures')
    or configured_symbol is null
    or configured_symbol !~ '^[A-Z0-9]{4,32}$'
  then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_runs_target_from_config_check',
      message = 'cloud run config contains invalid target metadata';
  end if;

  if jsonb_typeof(new.risk_json->'allowedSymbols') is distinct from 'array' then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_runs_risk_target_check',
      message = 'cloud run risk policy contains invalid allowed symbols';
  end if;

  if jsonb_array_length(new.risk_json->'allowedSymbols') not between 1 and 20 then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_runs_risk_target_check',
      message = 'cloud run risk policy contains invalid allowed symbols';
  end if;

  for allowed_value in
    select value from jsonb_array_elements(new.risk_json->'allowedSymbols')
  loop
    if jsonb_typeof(allowed_value) is distinct from 'string' then
      raise exception using
        errcode = '23514',
        constraint = 'cloud_runs_risk_target_check',
        message = 'cloud run risk policy contains invalid allowed symbols';
    end if;
    allowed_symbol := allowed_value #>> '{}';
    canonical_allowed_symbol := regexp_replace(
      regexp_replace(upper(btrim(allowed_symbol)), '^CMT_', ''),
      '[-/_]',
      '',
      'g'
    );
    if canonical_allowed_symbol is null or canonical_allowed_symbol !~ '^[A-Z0-9]{4,32}$' then
      raise exception using
        errcode = '23514',
        constraint = 'cloud_runs_risk_target_check',
        message = 'cloud run risk policy contains invalid allowed symbols';
    end if;
    target_is_allowed := target_is_allowed or canonical_allowed_symbol = configured_symbol;
  end loop;

  if not target_is_allowed then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_runs_risk_target_check',
      message = 'cloud run risk policy does not allow its configured target';
  end if;

  -- Derive only the indexed identity from the immutable evidence snapshots.
  -- Mutating config_json would break its configuration_hash/backtest binding;
  -- mutating risk_json would silently change the authorized risk snapshot.
  new.market := configured_market;
  new.symbol := configured_symbol;
  return new;
end;
$$;

revoke all on function private.synchronize_cloud_run_target()
  from public, anon, authenticated, service_role, cryptobot_netlify, cryptobot_executor;

drop trigger if exists cloud_runs_synchronize_target on public.cloud_strategy_runs;

create trigger cloud_runs_synchronize_target
before insert or update of config_json, risk_json
on public.cloud_strategy_runs
for each row execute function private.synchronize_cloud_run_target();

update public.cloud_strategy_runs
set config_json = config_json,
    risk_json = risk_json;

do $exclusivity_preflight$
begin
  if exists (
    select 1 from public.cloud_strategy_runs
    where market is null or market not in ('spot', 'futures')
      or symbol is null or symbol !~ '^[A-Z0-9]{4,32}$'
  ) then
    raise exception using
      errcode = '23514',
      message = 'cloud run target exclusivity migration blocked by invalid target metadata',
      hint = 'Repair cloud_strategy_runs config_json market/symbol values before retrying this migration.';
  end if;

  if exists (
    select 1 from public.cloud_strategy_runs
    where state <> 'stopped'
    group by user_id, connection_id, market, symbol
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'cloud_runs_nonterminal_target_uidx',
      message = 'cloud run target exclusivity migration blocked by duplicate non-stopped runs',
      hint = 'Audit duplicate WEEX account targets and explicitly stop all but one run before retrying this migration.';
  end if;
end
$exclusivity_preflight$;

alter table public.cloud_strategy_runs
  drop constraint if exists cloud_runs_market_check,
  drop constraint if exists cloud_runs_symbol_format,
  drop constraint if exists cloud_runs_target_from_config_check;

alter table public.cloud_strategy_runs
  alter column market set not null,
  alter column symbol set not null,
  add constraint cloud_runs_market_check check (market in ('spot', 'futures')),
  add constraint cloud_runs_symbol_format check (symbol ~ '^[A-Z0-9]{4,32}$'),
  add constraint cloud_runs_target_from_config_check check (
    market = config_json->>'market'
    and symbol = regexp_replace(
      regexp_replace(upper(btrim(config_json->>'symbol')), '^CMT_', ''),
      '[-/_]',
      '',
      'g'
    )
  );

create unique index if not exists cloud_runs_nonterminal_target_uidx
  on public.cloud_strategy_runs(user_id, connection_id, market, symbol)
  where state <> 'stopped';

comment on index public.cloud_runs_nonterminal_target_uidx is
  'A canonical WEEX account target may be controlled by only one non-stopped cloud strategy run.';

comment on function private.synchronize_cloud_run_target() is
  'Derives canonical target columns without mutating hash-bound config or authorized risk snapshots, and validates risk target consistency.';

create or replace function private.reject_cloud_run_stop_with_unsettled_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'stopped'
    and old.state <> 'stopped'
    and exists (
      select 1
      from private.cloud_order_intents order_intent
      where order_intent.run_id = old.id
        and (
          order_intent.status in ('claimed', 'unknown')
          or (
            order_intent.status = 'acknowledged'
            and coalesce(order_intent.error_code, '') not in (
              'exchange_order_filled',
              'exchange_order_cancelled_partially_filled'
            )
          )
          or order_intent.candle_close_at > coalesce(old.last_candle_at, -1)
        )
    )
  then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_run_stop_order_in_flight',
      message = 'cloud run cannot stop while authoritative order settlement is pending';
  end if;
  return new;
end;
$$;

revoke all on function private.reject_cloud_run_stop_with_unsettled_order()
  from public, anon, authenticated, service_role, cryptobot_executor, cryptobot_netlify;

drop trigger if exists cloud_runs_reject_unsettled_stop on public.cloud_strategy_runs;
create trigger cloud_runs_reject_unsettled_stop
before update of state on public.cloud_strategy_runs
for each row execute function private.reject_cloud_run_stop_with_unsettled_order();

-- Stopping is the point where the target uniqueness fence is released. Keep
-- that transition in the database so the website cannot race an executor
-- submission or inspect private order evidence directly. The run-row lock
-- serializes with the executor's pre-submit `for update of r,o` lock: a submit
-- that crossed the boundary becomes visible before this check, while a submit
-- that arrives after a successful stop observes a non-running run and aborts.
create or replace function private.stop_cloud_strategy_run(
  requested_user_id text,
  requested_run_id text,
  requested_version bigint,
  requested_stopped_at bigint
)
returns setof public.cloud_strategy_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.cloud_strategy_runs%rowtype;
begin
  select run.*
  into target
  from public.cloud_strategy_runs run
  where run.user_id = requested_user_id
    and run.id = requested_run_id
    and run.version = requested_version
    and run.state <> 'stopped'
  for update;

  if not found then
    return;
  end if;

  if exists (
    select 1
    from private.cloud_order_intents order_intent
    where order_intent.run_id = target.id
      and (
        order_intent.status in ('claimed', 'unknown')
        or (
          order_intent.status = 'acknowledged'
          and coalesce(order_intent.error_code, '') not in (
            'exchange_order_filled',
            'exchange_order_cancelled_partially_filled'
          )
        )
        or order_intent.candle_close_at > coalesce(target.last_candle_at, -1)
      )
  ) then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_run_stop_order_in_flight',
      message = 'cloud run cannot stop while authoritative order settlement is pending';
  end if;

  return query
  update public.cloud_strategy_runs run
  set state = 'stopped',
      version = run.version + 1,
      updated_at = requested_stopped_at,
      stopped_at = requested_stopped_at,
      lease_owner = null,
      lease_expires_at = null
  where run.user_id = requested_user_id
    and run.id = requested_run_id
    and run.version = requested_version
    and run.state <> 'stopped'
  returning run.*;
end;
$$;

revoke all on function private.stop_cloud_strategy_run(text, text, bigint, bigint)
  from public, anon, authenticated, service_role, cryptobot_executor, cryptobot_netlify;
grant usage on schema private to cryptobot_netlify;
grant execute on function private.stop_cloud_strategy_run(text, text, bigint, bigint)
  to cryptobot_netlify;

comment on function private.stop_cloud_strategy_run(text, text, bigint, bigint) is
  'Atomically refuses to release a cloud-run target until every possibly submitted order has authoritative terminal evidence recorded by the executor.';
comment on function private.reject_cloud_run_stop_with_unsettled_order() is
  'Defends every writer against releasing a cloud-run target while possibly submitted order evidence remains nonterminal.';
comment on role cryptobot_netlify is
  'NOBYPASSRLS website runtime role with an explicit public control-plane allowlist and execute-only access to audited private control-plane gateways.';
