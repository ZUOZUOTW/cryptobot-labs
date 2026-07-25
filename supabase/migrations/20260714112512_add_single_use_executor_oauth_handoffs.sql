create table if not exists private.weex_oauth_handoffs (
  nonce_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  action text not null check (action = 'connect'),
  expires_at bigint not null,
  consumed_at bigint not null,
  created_at bigint not null,
  constraint weex_oauth_handoffs_nonce_hash check (nonce_hash ~ '^[A-Za-z0-9_-]{43}$'),
  constraint weex_oauth_handoffs_expiry check (expires_at > created_at and expires_at <= created_at + 120000),
  constraint weex_oauth_handoffs_consumption check (consumed_at >= created_at and consumed_at < expires_at)
);

create index if not exists weex_oauth_handoffs_expiry_idx
  on private.weex_oauth_handoffs(expires_at);
create index if not exists weex_oauth_handoffs_user_idx
  on private.weex_oauth_handoffs(user_id);

alter table private.weex_oauth_handoffs enable row level security;
drop policy if exists deny_data_api on private.weex_oauth_handoffs;
create policy deny_data_api on private.weex_oauth_handoffs
  as restrictive for all to anon, authenticated using (false) with check (false);

revoke all on table private.weex_oauth_handoffs from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

do $constraint$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.weex_connections'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (user_id, provider)'
  ) then
    alter table public.weex_connections
      add constraint weex_connections_user_provider_key unique (user_id, provider);
  end if;
end
$constraint$;

comment on table private.weex_oauth_handoffs is
  'Hashes of short-lived, single-use Netlify to executor OAuth handoffs.';
