alter table public.cloud_strategy_runs
  add column if not exists market text,
  add column if not exists symbol text;

-- Preserve only the secret-free, authoritative order snapshot returned by
-- WEEX reconciliation. Submission claims and ambiguous outcomes deliberately
-- leave this column null; null is not reinterpreted as rejected or filled.
alter table private.cloud_order_intents
  add column if not exists exchange_evidence_json jsonb;

create or replace function private.is_valid_cloud_order_evidence(evidence jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  fill_item jsonb;
begin
  if evidence is null then
    return true;
  end if;

  if jsonb_typeof(evidence) is distinct from 'object' then
    return false;
  end if;

  if not evidence ?& array[
      'schemaVersion','provider','observedAt','clientOrderId','exchangeOrderId',
      'symbol','side','quantity','status','cumulativeFilledQuantity'
    ]
    or exists (
      select 1
      from jsonb_object_keys(evidence) as evidence_keys(evidence_key)
      where evidence_keys.evidence_key not in (
        'schemaVersion','provider','observedAt','clientOrderId','exchangeOrderId',
        'symbol','side','quantity','status','cumulativeFilledQuantity',
        'averageFillPrice','fees','fills'
      )
    )
    or evidence->'schemaVersion' <> '1'::jsonb
    or jsonb_typeof(evidence->'provider') is distinct from 'string'
    or evidence->>'provider' <> 'weex'
    or jsonb_typeof(evidence->'observedAt') is distinct from 'number'
    or coalesce(evidence->>'observedAt','') !~ '^(0|[1-9][0-9]{0,15})$'
    or jsonb_typeof(evidence->'clientOrderId') is distinct from 'string'
    or coalesce(evidence->>'clientOrderId','') !~ '^[A-Za-z0-9._:-]{1,128}$'
    or jsonb_typeof(evidence->'exchangeOrderId') is distinct from 'string'
    or coalesce(evidence->>'exchangeOrderId','') !~ '^[A-Za-z0-9._:-]{1,128}$'
    or jsonb_typeof(evidence->'symbol') is distinct from 'string'
    or coalesce(evidence->>'symbol','') !~ '^[A-Z0-9_]{3,32}$'
    or jsonb_typeof(evidence->'side') is distinct from 'string'
    or evidence->>'side' not in ('buy','sell')
    or jsonb_typeof(evidence->'quantity') is distinct from 'string'
    or coalesce(evidence->>'quantity','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
    or jsonb_typeof(evidence->'status') is distinct from 'string'
    or evidence->>'status' not in ('NEW','PARTIALLY_FILLED','FILLED','CANCELED','REJECTED')
    or jsonb_typeof(evidence->'cumulativeFilledQuantity') is distinct from 'string'
    or coalesce(evidence->>'cumulativeFilledQuantity','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
    or (evidence ? 'averageFillPrice' and (
      jsonb_typeof(evidence->'averageFillPrice') is distinct from 'string'
      or coalesce(evidence->>'averageFillPrice','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
    ))
    or (evidence ? 'fees' and (
      jsonb_typeof(evidence->'fees') is distinct from 'string'
      or coalesce(evidence->>'fees','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
    ))
  then
    return false;
  end if;

  -- Preserve the same quantity/status invariant enforced by the WEEX parser.
  -- A structurally valid JSON envelope must not be promoted to authoritative
  -- evidence when its material fill state is impossible.
  if (evidence->>'quantity')::numeric <= 0
    or (evidence->>'cumulativeFilledQuantity')::numeric > (evidence->>'quantity')::numeric
    or (evidence->>'status' in ('NEW','REJECTED')
      and (evidence->>'cumulativeFilledQuantity')::numeric <> 0)
    or (evidence->>'status' = 'PARTIALLY_FILLED'
      and ((evidence->>'cumulativeFilledQuantity')::numeric <= 0
        or (evidence->>'cumulativeFilledQuantity')::numeric >= (evidence->>'quantity')::numeric))
    or (evidence->>'status' = 'FILLED'
      and (evidence->>'cumulativeFilledQuantity')::numeric <> (evidence->>'quantity')::numeric)
  then
    return false;
  end if;

  if evidence ? 'fills' then
    if jsonb_typeof(evidence->'fills') is distinct from 'array' then
      return false;
    end if;
    if jsonb_array_length(evidence->'fills') > 100 then
      return false;
    end if;
  end if;

  for fill_item in
    select fill_values.value
    from jsonb_array_elements(coalesce(evidence->'fills','[]'::jsonb)) as fill_values(value)
  loop
    if jsonb_typeof(fill_item) is distinct from 'object' then
      return false;
    end if;
    if not fill_item ?& array['exchangeFillId','price','quantity','fee','feeCurrency','filledAt']
      or exists (
        select 1
        from jsonb_object_keys(fill_item) as fill_keys(fill_key)
        where fill_keys.fill_key not in (
          'exchangeFillId','price','quantity','fee','feeCurrency','realizedPnl','filledAt'
        )
      )
      or jsonb_typeof(fill_item->'exchangeFillId') is distinct from 'string'
      or coalesce(fill_item->>'exchangeFillId','') !~ '^[A-Za-z0-9._:-]{1,128}$'
      or jsonb_typeof(fill_item->'price') is distinct from 'string'
      or coalesce(fill_item->>'price','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
      or jsonb_typeof(fill_item->'quantity') is distinct from 'string'
      or coalesce(fill_item->>'quantity','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
      or jsonb_typeof(fill_item->'fee') is distinct from 'string'
      or coalesce(fill_item->>'fee','') !~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
      or jsonb_typeof(fill_item->'feeCurrency') is distinct from 'string'
      or coalesce(fill_item->>'feeCurrency','') !~ '^[A-Z0-9]{1,16}$'
      or (fill_item ? 'realizedPnl' and (
        jsonb_typeof(fill_item->'realizedPnl') is distinct from 'string'
        or coalesce(fill_item->>'realizedPnl','') !~ '^-?(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
      ))
      or jsonb_typeof(fill_item->'filledAt') is distinct from 'number'
      or coalesce(fill_item->>'filledAt','') !~ '^(0|[1-9][0-9]{0,15})$'
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function private.is_valid_cloud_order_evidence(jsonb)
  from public, anon, authenticated, service_role, cryptobot_netlify, cryptobot_executor;
grant execute on function private.is_valid_cloud_order_evidence(jsonb)
  to cryptobot_executor;

alter table private.cloud_order_intents
  drop constraint if exists cloud_order_exchange_evidence_valid;
alter table private.cloud_order_intents
  add constraint cloud_order_exchange_evidence_valid
    check (
      private.is_valid_cloud_order_evidence(exchange_evidence_json)
      and coalesce((
        exchange_evidence_json is null
        or (
          exchange_evidence_json->>'clientOrderId' is not distinct from client_order_id
          and exchange_evidence_json->>'exchangeOrderId' is not distinct from exchange_order_id
        )
      )
      and (
        (exchange_evidence_json is not null and status = 'acknowledged' and error_code = 'exchange_order_filled'
          and exchange_evidence_json->>'status' = 'FILLED'
          and exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
        or (exchange_evidence_json is not null and status = 'acknowledged' and error_code = 'exchange_order_cancelled_partially_filled'
          and exchange_evidence_json->>'status' = 'CANCELED'
          and exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
        or (exchange_evidence_json is not null and status = 'acknowledged' and error_code = 'exchange_order_partially_filled'
          and exchange_evidence_json->>'status' = 'PARTIALLY_FILLED'
          and exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
        or (exchange_evidence_json is not null and status = 'acknowledged' and error_code = 'exchange_order_open'
          and exchange_evidence_json->>'status' = 'NEW'
          and exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
        or (exchange_evidence_json is not null and status = 'rejected' and error_code = 'exchange_order_cancelled'
          and exchange_evidence_json->>'status' = 'CANCELED'
          and exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
        or (exchange_evidence_json is not null and status = 'rejected' and error_code = 'exchange_order_rejected'
          and exchange_evidence_json->>'status' = 'REJECTED'
          and exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
        -- Legacy and in-flight rows may not have a provider snapshot. They
        -- remain valid data, but the stop fence below never treats an
        -- acknowledged terminal code without matching evidence as settled.
        or exchange_evidence_json is null
      ), false)
    );

comment on column private.cloud_order_intents.exchange_evidence_json is
  'Secret-free WEEX order/fill snapshot persisted only after an authoritative lookup; null means no provider snapshot is proven.';
comment on function private.is_valid_cloud_order_evidence(jsonb) is
  'Validates the exact secret-free WEEX order/fill evidence envelope written by the executor; legacy null snapshots remain quarantined by the stop fence until reconciled.';

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
          or not coalesce((
            order_intent.status = 'risk-rejected'
            or (order_intent.status = 'rejected'
              and order_intent.exchange_evidence_json is null)
            or (order_intent.status = 'acknowledged'
              and order_intent.error_code = 'exchange_order_filled'
              and order_intent.exchange_evidence_json->>'status' = 'FILLED'
              and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
            or (order_intent.status = 'acknowledged'
              and order_intent.error_code = 'exchange_order_cancelled_partially_filled'
              and order_intent.exchange_evidence_json->>'status' = 'CANCELED'
              and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
            or (order_intent.status = 'rejected'
              and order_intent.error_code = 'exchange_order_cancelled'
              and order_intent.exchange_evidence_json->>'status' = 'CANCELED'
              and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
            or (order_intent.status = 'rejected'
              and order_intent.error_code = 'exchange_order_rejected'
              and order_intent.exchange_evidence_json->>'status' = 'REJECTED'
              and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
          ), false)
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
        or not coalesce((
          order_intent.status = 'risk-rejected'
          or (order_intent.status = 'rejected'
            and order_intent.exchange_evidence_json is null)
          or (order_intent.status = 'acknowledged'
            and order_intent.error_code = 'exchange_order_filled'
            and order_intent.exchange_evidence_json->>'status' = 'FILLED'
            and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
          or (order_intent.status = 'acknowledged'
            and order_intent.error_code = 'exchange_order_cancelled_partially_filled'
            and order_intent.exchange_evidence_json->>'status' = 'CANCELED'
            and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' !~ '^0(?:\.0+)?$')
          or (order_intent.status = 'rejected'
            and order_intent.error_code = 'exchange_order_cancelled'
            and order_intent.exchange_evidence_json->>'status' = 'CANCELED'
            and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
          or (order_intent.status = 'rejected'
            and order_intent.error_code = 'exchange_order_rejected'
            and order_intent.exchange_evidence_json->>'status' = 'REJECTED'
            and order_intent.exchange_evidence_json->>'cumulativeFilledQuantity' ~ '^0(?:\.0+)?$')
        ), false)
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

-- The website receives a deliberately narrow projection instead of SELECT on
-- private.cloud_order_intents. Ownership is joined through the run row, raw
-- signals/intents never leave the database, and only validator-approved fill
-- evidence is returned.
create or replace function private.list_cloud_run_order_evidence(
  requested_user_id text,
  requested_run_id text,
  requested_limit integer
)
returns table (
  run_id text,
  candle_close_at bigint,
  created_at bigint,
  updated_at bigint,
  lifecycle_status text,
  evidence_level text,
  error_code text,
  client_order_id text,
  exchange_order_id text,
  symbol text,
  side text,
  quantity text,
  requested_price text,
  provider_status text,
  cumulative_filled_quantity text,
  average_fill_price text,
  fees text,
  fills_json jsonb,
  evidence_observed_at bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if requested_user_id is null
    or requested_run_id is null
    or requested_limit is null
    or requested_limit not between 1 and 50
  then
    return;
  end if;

  return query
  select
    order_intent.run_id,
    order_intent.candle_close_at,
    order_intent.created_at,
    order_intent.updated_at,
    order_intent.status,
    case
      when order_intent.exchange_evidence_json is not null then 'authoritative'
      when order_intent.status = 'unknown' then 'uncertain'
      when order_intent.status in ('claimed','acknowledged') then 'pending'
      else 'control-plane'
    end,
    case when coalesce(order_intent.error_code,'') ~ '^[a-z0-9_-]{1,64}$'
      then order_intent.error_code else null end,
    case when coalesce(order_intent.client_order_id,'') ~ '^[A-Za-z0-9._:-]{1,128}$'
      then order_intent.client_order_id else null end,
    case when coalesce(order_intent.exchange_order_id,'') ~ '^[A-Za-z0-9._:-]{1,128}$'
      then order_intent.exchange_order_id else null end,
    case
      when coalesce(order_intent.exchange_evidence_json->>'symbol','') ~ '^[A-Z0-9_]{3,32}$'
        then order_intent.exchange_evidence_json->>'symbol'
      when coalesce(order_intent.intent_json->>'symbol','') ~ '^[A-Z0-9_]{3,32}$'
        then order_intent.intent_json->>'symbol'
      else run.symbol
    end,
    case
      when order_intent.exchange_evidence_json->>'side' in ('buy','sell')
        then order_intent.exchange_evidence_json->>'side'
      when order_intent.intent_json->>'side' in ('buy','sell')
        then order_intent.intent_json->>'side'
      else null
    end,
    case
      when coalesce(order_intent.exchange_evidence_json->>'quantity','')
        ~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
        then order_intent.exchange_evidence_json->>'quantity'
      when coalesce(order_intent.intent_json->>'quantity','')
        ~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
        then order_intent.intent_json->>'quantity'
      else null
    end,
    case when coalesce(order_intent.intent_json->>'price','')
      ~ '^(0|[1-9][0-9]{0,23})(\.[0-9]{1,18})?$'
      then order_intent.intent_json->>'price' else null end,
    order_intent.exchange_evidence_json->>'status',
    order_intent.exchange_evidence_json->>'cumulativeFilledQuantity',
    order_intent.exchange_evidence_json->>'averageFillPrice',
    order_intent.exchange_evidence_json->>'fees',
    coalesce(order_intent.exchange_evidence_json->'fills','[]'::jsonb),
    case when coalesce(order_intent.exchange_evidence_json->>'observedAt','')
      ~ '^(0|[1-9][0-9]{0,15})$'
      then (order_intent.exchange_evidence_json->>'observedAt')::bigint else null end
  from private.cloud_order_intents order_intent
  join public.cloud_strategy_runs run
    on run.id = order_intent.run_id
   and run.user_id = requested_user_id
  where order_intent.run_id = requested_run_id
  order by order_intent.candle_close_at desc, order_intent.created_at desc
  limit requested_limit;
end;
$$;

revoke all on function private.list_cloud_run_order_evidence(text, text, integer)
  from public, anon, authenticated, service_role, cryptobot_executor, cryptobot_netlify;
grant execute on function private.list_cloud_run_order_evidence(text, text, integer)
  to cryptobot_netlify;

comment on function private.list_cloud_run_order_evidence(text, text, integer) is
  'Returns an owner-scoped, secret-free order/fill projection to the trusted website runtime without granting private-table access.';

comment on function private.stop_cloud_strategy_run(text, text, bigint, bigint) is
  'Atomically refuses to release a cloud-run target until every possibly submitted order has authoritative terminal evidence recorded by the executor.';
comment on function private.reject_cloud_run_stop_with_unsettled_order() is
  'Defends every writer against releasing a cloud-run target while possibly submitted order evidence remains nonterminal.';
comment on role cryptobot_netlify is
  'NOBYPASSRLS website runtime role with an explicit public control-plane allowlist and execute-only access to audited private control-plane gateways.';
