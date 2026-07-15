drop policy if exists deny_data_api on private.weex_oauth_states;
drop policy if exists deny_data_api on private.weex_credential_blobs;
drop policy if exists deny_data_api on private.executor_leases;
create policy deny_data_api on private.weex_oauth_states
  for all to anon, authenticated using (false) with check (false);
create policy deny_data_api on private.weex_credential_blobs
  for all to anon, authenticated using (false) with check (false);
create policy deny_data_api on private.executor_leases
  for all to anon, authenticated using (false) with check (false);
