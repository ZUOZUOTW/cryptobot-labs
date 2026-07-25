do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'cryptobot_executor') then
    create role cryptobot_executor
      login
      nosuperuser
      nocreatedb
      nocreaterole
      noreplication
      nobypassrls
      connection limit 10;
  end if;
end
$$;

alter role cryptobot_executor set statement_timeout = '15s';
alter role cryptobot_executor set lock_timeout = '5s';
alter role cryptobot_executor set idle_in_transaction_session_timeout = '15s';

grant connect on database postgres to cryptobot_executor;
grant usage on schema public, private to cryptobot_executor;

grant select, insert, update
  on table public.executor_shards, public.weex_connections
  to cryptobot_executor;

grant select, insert, update
  on table private.weex_oauth_handoffs,
           private.weex_oauth_states,
           private.weex_credential_blobs
  to cryptobot_executor;

create policy executor_runtime on public.executor_shards
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on public.weex_connections
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on private.weex_oauth_handoffs
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on private.weex_oauth_states
  for all to cryptobot_executor using (true) with check (true);
create policy executor_runtime on private.weex_credential_blobs
  for all to cryptobot_executor using (true) with check (true);

comment on role cryptobot_executor is
  'Least-privilege runtime role for the fixed-egress CryptoBot Labs executor.';
