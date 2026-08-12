create table public.promoters (
  user_id text primary key
    references public.users(id)
    on delete cascade,
  slug text not null,
  role text not null,
  status text not null,
  weex_referral_url text,
  approved_at bigint,
  updated_at bigint not null,
  constraint promoters_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  constraint promoters_role
    check (role in ('kol', 'bd')),
  constraint promoters_status
    check (status in ('pending', 'active', 'disabled')),
  constraint promoters_weex_url
    check (
      weex_referral_url is null
      or (
        char_length(weex_referral_url) between 12 and 2048
        and lower(weex_referral_url) ~ '^https://([a-z0-9-]+\.)*weex\.com(/|\?|$)'
        and weex_referral_url !~ '[@#]'
      )
    ),
  constraint promoters_active_approval
    check (
      status <> 'active'
      or (weex_referral_url is not null and approved_at is not null)
    ),
  constraint promoters_timestamps
    check (
      updated_at >= 0
      and (approved_at is null or approved_at between 0 and updated_at)
    )
);

create unique index promoters_slug_uidx
  on public.promoters(slug);
create index promoters_status_role_idx
  on public.promoters(status, role);

alter table public.promoters enable row level security;
revoke all on table public.promoters
  from public, anon, authenticated, service_role, cryptobot_executor;
grant select on table public.promoters to cryptobot_netlify;
create policy netlify_server_runtime on public.promoters
  for select to cryptobot_netlify
  using (true);

comment on table public.promoters is
  'Server-owned approval records for KOL and BD strategy referral links; browser identity metadata is never authoritative.';
comment on column public.promoters.weex_referral_url is
  'Administrator-approved HTTPS WEEX referral URL used only while the promoter remains active.';
comment on column public.strategy_publications.weex_referral_url is
  'Referral opt-in marker populated atomically from the current server-approved active promoter URL; never trust a browser-supplied URL.';
