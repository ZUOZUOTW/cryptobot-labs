alter table public.cloud_strategy_runs
  add column market text,
  add column symbol text;

update public.cloud_strategy_runs
set market = config_json->>'market',
    symbol = config_json->>'symbol';

do $exclusivity_preflight$
begin
  if exists (
    select 1 from public.cloud_strategy_runs
    where market is null or market not in ('spot', 'futures')
      or symbol is null or symbol !~ '^[A-Z0-9_]{3,32}$'
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
  alter column market set not null,
  alter column symbol set not null,
  add constraint cloud_runs_market_check check (market in ('spot', 'futures')),
  add constraint cloud_runs_symbol_format check (symbol ~ '^[A-Z0-9_]{3,32}$');

create unique index cloud_runs_nonterminal_target_uidx
  on public.cloud_strategy_runs(user_id, connection_id, market, symbol)
  where state <> 'stopped';

comment on index public.cloud_runs_nonterminal_target_uidx is
  'A WEEX account target may be controlled by only one non-stopped cloud strategy run.';
