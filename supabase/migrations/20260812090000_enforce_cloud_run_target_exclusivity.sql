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
  canonical_allowed_symbols jsonb := '[]'::jsonb;
  target_is_allowed boolean := false;
begin
  configured_market := new.config_json->>'market';
  configured_symbol := regexp_replace(
    regexp_replace(upper(btrim(new.config_json->>'symbol')), '^CMT_', ''),
    '[/_-]',
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
      '[/_-]',
      '',
      'g'
    );
    if canonical_allowed_symbol is null or canonical_allowed_symbol !~ '^[A-Z0-9]{4,32}$' then
      raise exception using
        errcode = '23514',
        constraint = 'cloud_runs_risk_target_check',
        message = 'cloud run risk policy contains invalid allowed symbols';
    end if;
    if not canonical_allowed_symbols @> jsonb_build_array(canonical_allowed_symbol) then
      canonical_allowed_symbols := canonical_allowed_symbols || jsonb_build_array(canonical_allowed_symbol);
    end if;
    target_is_allowed := target_is_allowed or canonical_allowed_symbol = configured_symbol;
  end loop;

  if not target_is_allowed then
    raise exception using
      errcode = '23514',
      constraint = 'cloud_runs_risk_target_check',
      message = 'cloud run risk policy does not allow its configured target';
  end if;

  -- Always derive the indexed identity from immutable config_json. This keeps
  -- pre-migration writers compatible and prevents explicit-column bypasses.
  new.market := configured_market;
  new.symbol := configured_symbol;
  new.config_json := jsonb_set(new.config_json, '{symbol}', to_jsonb(configured_symbol), false);
  new.risk_json := jsonb_set(new.risk_json, '{allowedSymbols}', canonical_allowed_symbols, false);
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
      '[/_-]',
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
  'Derives canonical cloud-run target columns from config_json for old and new writers and validates risk target consistency.';
