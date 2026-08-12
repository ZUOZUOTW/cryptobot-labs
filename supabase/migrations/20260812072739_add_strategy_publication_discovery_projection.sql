-- Indexed, immutable public-discovery fields. The trigger keeps the migration
-- backward-compatible with the previous website release during rollout: old
-- writers may omit these columns, but cannot choose their values.
alter table public.strategy_publications
  add column discovery_market text not null default 'spot',
  add column discovery_timeframe text not null default '1h',
  add column discovery_risk text not null default '低',
  add column search_text text not null default '',
  add column discovery_total_return double precision not null default 0,
  add column discovery_max_drawdown double precision not null default 0,
  add column discovery_win_rate double precision not null default 0,
  add column discovery_stability double precision not null default 0,
  add column discovery_recommended double precision not null default 0;

create or replace function public.derive_strategy_publication_discovery_projection()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  config jsonb;
  metrics jsonb;
  strategy_name text;
  strategy_market text;
  strategy_symbol text;
  leverage_value double precision;
  return_value double precision;
  drawdown_value double precision;
  win_rate_value double precision;
  sharpe_value double precision;
  trade_count integer;
begin
  select v.config_json::jsonb, r.metrics_json::jsonb, s.name, s.market, s.symbol
  into strict config, metrics, strategy_name, strategy_market, strategy_symbol
  from public.strategy_versions v
  join public.strategies s on s.id = v.strategy_id and s.user_id = v.user_id
  join public.backtest_jobs j on j.id = new.backtest_job_id
    and j.user_id = new.user_id and j.strategy_version_id = v.id
    and j.status = 'succeeded' and j.evidence_level = 'historical'
  join public.backtest_results r on r.backtest_job_id = j.id and r.user_id = j.user_id
    and r.evidence_level = 'historical' and r.configuration_hash = v.config_hash
    and r.strategy_hash = v.config_hash
    and ((v.source_hash is null and r.script_hash is null) or r.script_hash = v.source_hash)
  join public.backtest_datasets d on d.backtest_job_id = j.id and d.user_id = j.user_id
    and d.id = r.dataset_id and d.complete = 1 and d.gaps_json = '[]'
  where v.id = new.strategy_version_id and v.user_id = new.user_id;

  leverage_value := (config->>'leverage')::double precision;
  return_value := (metrics->>'totalReturn')::double precision;
  drawdown_value := abs((metrics->>'maxDrawdown')::double precision);
  win_rate_value := (metrics->>'winRate')::double precision;
  sharpe_value := (metrics->>'sharpe')::double precision;
  trade_count := (metrics->>'trades')::integer;

  new.discovery_market := strategy_market;
  new.discovery_timeframe := config->>'timeframe';
  new.discovery_risk := case
    when leverage_value >= 10 or drawdown_value >= 0.25 then '高'
    when leverage_value >= 3 or drawdown_value >= 0.12 then '中'
    else '低'
  end;
  new.search_text := lower(concat_ws(' ', strategy_name, new.description, new.publisher_name, strategy_symbol));
  new.discovery_total_return := return_value;
  new.discovery_max_drawdown := drawdown_value;
  new.discovery_win_rate := win_rate_value;
  new.discovery_stability := greatest(0, least(100, 100 - drawdown_value * 100));
  new.discovery_recommended := new.discovery_stability + sharpe_value * 12
    - drawdown_value * 100 + least(trade_count, 100) / 20.0;
  return new;
exception
  when no_data_found then
    raise exception 'strategy publication discovery evidence is incomplete'
      using errcode = '23514';
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'strategy publication discovery metrics are invalid'
      using errcode = '23514';
end;
$$;

revoke all on function public.derive_strategy_publication_discovery_projection()
  from public, anon, authenticated, service_role, cryptobot_executor, cryptobot_netlify;
grant execute on function public.derive_strategy_publication_discovery_projection() to cryptobot_netlify;

create trigger strategy_publications_discovery_projection
before insert or update of strategy_version_id, backtest_job_id, description, publisher_name
on public.strategy_publications
for each row execute function public.derive_strategy_publication_discovery_projection();

-- Backfill through the same derivation contract used by future writes.
update public.strategy_publications
set description = description
where exists (
  select 1
  from public.strategy_versions v
  join public.backtest_jobs j on j.id = strategy_publications.backtest_job_id
    and j.user_id = strategy_publications.user_id and j.strategy_version_id = v.id
    and j.status = 'succeeded' and j.evidence_level = 'historical'
  join public.backtest_results r on r.backtest_job_id = j.id and r.user_id = j.user_id
    and r.evidence_level = 'historical' and r.configuration_hash = v.config_hash
    and r.strategy_hash = v.config_hash
    and ((v.source_hash is null and r.script_hash is null) or r.script_hash = v.source_hash)
  join public.backtest_datasets d on d.backtest_job_id = j.id and d.user_id = j.user_id
    and d.id = r.dataset_id and d.complete = 1 and d.gaps_json = '[]'
  where v.id = strategy_publications.strategy_version_id and v.user_id = strategy_publications.user_id
);

alter table public.strategy_publications
  add constraint strategy_publications_discovery_market
    check (discovery_market in ('spot', 'futures')),
  add constraint strategy_publications_discovery_timeframe
    check (char_length(discovery_timeframe) between 1 and 16),
  add constraint strategy_publications_discovery_risk
    check (discovery_risk in ('低', '中', '高')),
  add constraint strategy_publications_search_length
    check (char_length(search_text) between 0 and 700),
  add constraint strategy_publications_discovery_metrics
    check (
      discovery_total_return = discovery_total_return
      and discovery_max_drawdown = discovery_max_drawdown
      and discovery_win_rate = discovery_win_rate
      and discovery_stability = discovery_stability
      and discovery_recommended = discovery_recommended
      and discovery_max_drawdown >= 0
      and discovery_win_rate between 0 and 1
      and discovery_stability between 0 and 100
    );

create index strategy_publications_market_timeframe_idx
  on public.strategy_publications(discovery_market, discovery_timeframe, published_at desc, id desc);
create index strategy_publications_risk_published_idx
  on public.strategy_publications(discovery_risk, published_at desc, id desc);
create index strategy_publications_return_idx
  on public.strategy_publications(discovery_total_return desc, published_at desc, id desc);
create index strategy_publications_drawdown_idx
  on public.strategy_publications(discovery_max_drawdown, published_at desc, id desc);
create index strategy_publications_win_rate_idx
  on public.strategy_publications(discovery_win_rate desc, published_at desc, id desc);
create index strategy_publications_stability_idx
  on public.strategy_publications(discovery_stability desc, published_at desc, id desc);
create index strategy_publications_recommended_idx
  on public.strategy_publications(discovery_recommended desc, published_at desc, id desc);

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index strategy_publications_search_trgm_idx
  on public.strategy_publications using gin(search_text extensions.gin_trgm_ops);
