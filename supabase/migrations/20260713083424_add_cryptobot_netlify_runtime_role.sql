do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cryptobot_netlify') then
    create role cryptobot_netlify nologin bypassrls;
  end if;
end
$$;

alter role cryptobot_netlify nologin bypassrls;
grant connect on database postgres to cryptobot_netlify;
grant usage on schema public to cryptobot_netlify;
grant select, insert, update, delete on table
  public.audit_events,
  public.backtest_datasets,
  public.backtest_jobs,
  public.backtest_request_keys,
  public.backtest_results,
  public.command_acknowledgements,
  public.commands,
  public.deployments,
  public.device_bootstraps,
  public.device_connections,
  public.device_credentials,
  public.device_nonces,
  public.devices,
  public.fills,
  public.orders,
  public.pairing_codes,
  public.position_snapshots,
  public.risk_policies,
  public.run_heartbeats,
  public.strategies,
  public.strategy_versions,
  public.strategy_save_keys,
  public.users
  to cryptobot_netlify;
