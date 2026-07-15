alter table private.weex_oauth_states enable row level security;
alter table private.weex_credential_blobs enable row level security;
alter table private.executor_leases enable row level security;

create index if not exists weex_oauth_states_connection_user_idx
  on private.weex_oauth_states(connection_id, user_id);
create index if not exists weex_credential_blobs_connection_user_idx
  on private.weex_credential_blobs(connection_id, user_id);
create index if not exists executor_leases_connection_idx
  on private.executor_leases(connection_id);
