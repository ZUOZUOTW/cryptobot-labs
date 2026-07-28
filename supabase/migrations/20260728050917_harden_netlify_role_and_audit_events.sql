-- The website connects directly through the Supabase transaction pooler. Keep
-- that login role constrained to the public control-plane projection and make
-- RLS mandatory, even if a future grant is accidentally widened.
-- Supabase's managed postgres role cannot toggle SUPERUSER or REPLICATION.
-- Fail closed if either invariant has ever been violated, then remove the
-- elevated attributes that the project administrator is allowed to manage.
do $netlify_role_invariants$
begin
  if exists (
    select 1
    from pg_roles
    where rolname = 'cryptobot_netlify'
      and (rolsuper or rolreplication)
  ) then
    raise exception 'cryptobot_netlify must not be SUPERUSER or REPLICATION';
  end if;
end
$netlify_role_invariants$;

alter role cryptobot_netlify
  nocreatedb
  nocreaterole
  nobypassrls
  connection limit 20;

alter role cryptobot_netlify set statement_timeout = '15s';
alter role cryptobot_netlify set lock_timeout = '5s';
alter role cryptobot_netlify set idle_in_transaction_session_timeout = '15s';

revoke all on schema private from cryptobot_netlify;
revoke all on all tables in schema private from cryptobot_netlify;
revoke all on all sequences in schema private from cryptobot_netlify;
revoke all on all functions in schema private from cryptobot_netlify;

revoke all on schema public from cryptobot_netlify;
revoke all on all tables in schema public from cryptobot_netlify;
revoke all on all sequences in schema public from cryptobot_netlify;
revoke all on all functions in schema public from cryptobot_netlify;

grant connect on database postgres to cryptobot_netlify;
grant usage on schema public to cryptobot_netlify;

grant select on table
  public.users,
  public.devices,
  public.device_credentials,
  public.device_connections,
  public.pairing_codes,
  public.device_bootstraps,
  public.device_nonces,
  public.strategies,
  public.strategy_versions,
  public.strategy_save_keys,
  public.backtest_jobs,
  public.backtest_request_keys,
  public.backtest_datasets,
  public.backtest_results,
  public.deployments,
  public.risk_policies,
  public.run_heartbeats,
  public.position_snapshots,
  public.orders,
  public.fills,
  public.commands,
  public.command_acknowledgements,
  public.audit_events,
  public.weex_connections,
  public.cloud_strategy_runs,
  public.weex_account_snapshots,
  public.weex_realized_pnl_ledger,
  public.strategy_publications
to cryptobot_netlify;

grant insert on table
  public.users,
  public.devices,
  public.device_credentials,
  public.device_connections,
  public.pairing_codes,
  public.device_bootstraps,
  public.device_nonces,
  public.strategies,
  public.strategy_versions,
  public.strategy_save_keys,
  public.backtest_jobs,
  public.backtest_request_keys,
  public.backtest_datasets,
  public.backtest_results,
  public.deployments,
  public.risk_policies,
  public.run_heartbeats,
  public.position_snapshots,
  public.orders,
  public.fills,
  public.commands,
  public.command_acknowledgements,
  public.audit_events,
  public.cloud_strategy_runs,
  public.strategy_publications
to cryptobot_netlify;

grant update on table
  public.users,
  public.devices,
  public.device_credentials,
  public.device_connections,
  public.pairing_codes,
  public.device_bootstraps,
  public.backtest_jobs,
  public.deployments,
  public.risk_policies,
  public.orders,
  public.commands,
  public.cloud_strategy_runs,
  public.strategy_publications
to cryptobot_netlify;

grant delete on table
  public.device_nonces,
  public.position_snapshots
to cryptobot_netlify;

-- These policies make NOBYPASSRLS effective. Tenant predicates remain in the
-- server repositories; the database role is never exposed to browsers.
do $netlify_policies$
declare
  table_name text;
begin
  foreach table_name in array array[
    'users', 'devices', 'device_credentials', 'device_connections',
    'pairing_codes', 'device_bootstraps', 'device_nonces', 'strategies',
    'strategy_versions', 'strategy_save_keys', 'backtest_jobs',
    'backtest_request_keys', 'backtest_datasets', 'backtest_results',
    'deployments', 'risk_policies', 'run_heartbeats', 'position_snapshots',
    'orders', 'fills', 'commands', 'command_acknowledgements', 'audit_events',
    'weex_connections', 'cloud_strategy_runs', 'weex_account_snapshots',
    'weex_realized_pnl_ledger', 'strategy_publications'
  ]
  loop
    execute format('drop policy if exists netlify_server_runtime on public.%I', table_name);
    execute format(
      'create policy netlify_server_runtime on public.%I for all to cryptobot_netlify using (true) with check (true)',
      table_name
    );
  end loop;
end
$netlify_policies$;

-- The application ledger is append-only in every runtime, not only in the
-- local SQLite implementation. Only the database owner may perform retention
-- or repair work after intentionally disabling the trigger.
create or replace function private.reject_audit_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'audit_events are append-only';
end;
$$;

revoke all on function private.reject_audit_event_mutation() from public;
revoke update, delete, truncate on table public.audit_events
  from public, anon, authenticated, service_role, cryptobot_netlify, cryptobot_executor;

drop trigger if exists audit_events_prevent_update_or_delete on public.audit_events;
create trigger audit_events_prevent_update_or_delete
before update or delete on public.audit_events
for each row execute function private.reject_audit_event_mutation();

drop trigger if exists audit_events_prevent_truncate on public.audit_events;
create trigger audit_events_prevent_truncate
before truncate on public.audit_events
for each statement execute function private.reject_audit_event_mutation();

comment on role cryptobot_netlify is
  'NOBYPASSRLS website runtime role with an explicit public control-plane allowlist and no private-schema access.';
comment on function private.reject_audit_event_mutation() is
  'Rejects UPDATE, DELETE, and TRUNCATE so application audit evidence remains append-only.';
