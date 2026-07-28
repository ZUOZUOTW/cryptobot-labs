alter table public.weex_connections
  add column credential_source text not null default 'manual';

alter table public.weex_connections
  add constraint weex_connections_credential_source_check
  check (credential_source in ('manual', 'oauth'));

update public.weex_connections as connection
set credential_source = 'oauth'
where exists (
  select 1
  from private.weex_oauth_states as state
  where state.connection_id = connection.id
    and state.user_id = connection.user_id
    and state.status = 'success'
    and state.updated_at >= coalesce(connection.verified_at, 0)
);

comment on column public.weex_connections.credential_source is
  'Secret-free origin of the active or pending WEEX credential: manual API entry or WEEX OAuth.';
