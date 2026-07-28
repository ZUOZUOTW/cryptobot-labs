create table public.executor_shards (
  id text primary key,
  name text not null,
  region text not null,
  egress_ip inet not null unique,
  status text not null check (status in ('provisioning', 'ready', 'draining', 'offline')),
  last_seen_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  constraint executor_shards_id_format check (id ~ '^exec_[A-Za-z0-9_-]{16,64}$'),
  constraint executor_shards_name_length check (length(name) between 1 and 80),
  constraint executor_shards_region_length check (length(region) between 1 and 64)
);

create table public.weex_connections (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  executor_shard_id text references public.executor_shards(id),
  provider text not null default 'weex' check (provider = 'weex'),
  status text not null check (status in ('pending', 'processing', 'active', 'reauthorization_required', 'revoked', 'error')),
  masked_api_key_suffix text,
  permissions_json jsonb not null default '{}'::jsonb,
  withdrawal_access_absent boolean not null default false,
  verified_at bigint,
  revoked_at bigint,
  version bigint not null default 1 check (version > 0),
  created_at bigint not null,
  updated_at bigint not null,
  constraint weex_connections_id_format check (id ~ '^conn_[A-Za-z0-9_-]{16,64}$'),
  constraint weex_connections_masked_suffix check (
    masked_api_key_suffix is null or length(masked_api_key_suffix) between 4 and 12
  ),
  constraint weex_connections_permissions_object check (jsonb_typeof(permissions_json) = 'object'),
  unique (id, user_id)
);

create index weex_connections_user_status_idx on public.weex_connections(user_id, status);
create index weex_connections_executor_status_idx on public.weex_connections(executor_shard_id, status)
  where executor_shard_id is not null;

create table private.weex_oauth_states (
  id text primary key,
  connection_id text not null,
  user_id text not null,
  state_hash text not null unique,
  session_hash text not null,
  redirect_uri text not null,
  promoter_slug text,
  kms_key_id text not null,
  encrypted_data_key bytea not null,
  initialization_vector bytea not null,
  code_verifier_ciphertext bytea not null,
  encryption_context_json jsonb not null,
  status text not null default 'init' check (status in ('init', 'processing', 'success', 'failed')),
  error_code text,
  expires_at bigint not null,
  consumed_at bigint,
  created_at bigint not null,
  updated_at bigint not null,
  constraint weex_oauth_states_connection_user_fk foreign key (connection_id, user_id)
    references public.weex_connections(id, user_id) on delete cascade,
  constraint weex_oauth_states_id_format check (id ~ '^woauth_[A-Za-z0-9_-]{16,64}$'),
  constraint weex_oauth_states_state_hash check (state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint weex_oauth_states_session_hash check (session_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint weex_oauth_states_https_redirect check (redirect_uri ~ '^https://'),
  constraint weex_oauth_states_iv_length check (octet_length(initialization_vector) = 12),
  constraint weex_oauth_states_ciphertext_length check (octet_length(code_verifier_ciphertext) >= 17),
  constraint weex_oauth_states_context_object check (jsonb_typeof(encryption_context_json) = 'object'),
  constraint weex_oauth_states_expiry check (expires_at > created_at and expires_at <= created_at + 600000),
  constraint weex_oauth_states_consumption check (
    (status = 'init' and consumed_at is null) or (status <> 'init' and consumed_at is not null)
  )
);

create index weex_oauth_states_expiry_idx on private.weex_oauth_states(expires_at)
  where status = 'init';
create index weex_oauth_states_connection_idx on private.weex_oauth_states(connection_id, created_at desc);

create table private.weex_credential_blobs (
  connection_id text primary key,
  user_id text not null,
  kms_key_id text not null,
  encrypted_data_key bytea not null,
  initialization_vector bytea not null,
  credential_ciphertext bytea not null,
  encryption_context_json jsonb not null,
  credential_version bigint not null default 1 check (credential_version > 0),
  created_at bigint not null,
  rotated_at bigint,
  updated_at bigint not null,
  constraint weex_credential_blobs_connection_user_fk foreign key (connection_id, user_id)
    references public.weex_connections(id, user_id) on delete cascade,
  constraint weex_credential_blobs_iv_length check (octet_length(initialization_vector) = 12),
  constraint weex_credential_blobs_ciphertext_length check (octet_length(credential_ciphertext) >= 17),
  constraint weex_credential_blobs_context_object check (jsonb_typeof(encryption_context_json) = 'object')
);

create table private.executor_leases (
  deployment_id text primary key references public.deployments(id) on delete cascade,
  executor_shard_id text not null references public.executor_shards(id),
  connection_id text not null references public.weex_connections(id),
  lease_token_hash text not null,
  fencing_token bigint not null check (fencing_token > 0),
  acquired_at bigint not null,
  expires_at bigint not null,
  renewed_at bigint not null,
  constraint executor_leases_token_hash check (lease_token_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint executor_leases_expiry check (expires_at > acquired_at)
);

create index executor_leases_shard_expiry_idx on private.executor_leases(executor_shard_id, expires_at);

alter table public.executor_shards enable row level security;
alter table public.weex_connections enable row level security;

create policy deny_data_api on public.executor_shards for all to anon, authenticated using (false) with check (false);
create policy deny_data_api on public.weex_connections for all to anon, authenticated using (false) with check (false);

revoke all on table public.executor_shards, public.weex_connections from anon, authenticated;
revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.consume_weex_oauth_state(p_state_hash text, p_now bigint)
returns setof private.weex_oauth_states
language sql
security invoker
set search_path = ''
as $$
  update private.weex_oauth_states
     set status = 'processing', consumed_at = p_now, updated_at = p_now
   where state_hash = p_state_hash
     and status = 'init'
     and consumed_at is null
     and expires_at > p_now
  returning *;
$$;

revoke all on function private.consume_weex_oauth_state(text, bigint) from public, anon, authenticated;
grant execute on function private.consume_weex_oauth_state(text, bigint) to service_role;

comment on table public.weex_connections is 'Safe WEEX connection projection; never stores API secrets or OAuth tokens.';
comment on table private.weex_oauth_states is 'Single-use OAuth state and encrypted PKCE verifier. Direct backend database access only.';
comment on table private.weex_credential_blobs is 'KMS envelope-encrypted WEEX credentials. Plaintext is forbidden.';
comment on table private.executor_leases is 'Fenced leases preventing concurrent cloud executors from controlling one deployment.';
