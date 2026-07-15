create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

do $policy_lockdown$
declare
  table_name text;
begin
  foreach table_name in array array[
    'audit_events', 'backtest_datasets', 'backtest_jobs', 'backtest_request_keys', 'backtest_results',
    'command_acknowledgements', 'commands', 'deployments', 'device_bootstraps', 'device_connections',
    'device_credentials', 'device_nonces', 'devices', 'fills', 'orders', 'pairing_codes',
    'position_snapshots', 'risk_policies', 'run_heartbeats', 'strategies', 'strategy_save_keys',
    'strategy_versions', 'users'
  ]
  loop
    execute format('drop policy if exists deny_data_api on public.%I', table_name);
    execute format(
      'create policy deny_data_api on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',
      table_name
    );
  end loop;
end
$policy_lockdown$;
