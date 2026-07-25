create table public.strategy_publications (
  id text primary key,
  user_id text not null,
  strategy_version_id text not null,
  backtest_job_id text not null,
  slug text not null,
  description text not null,
  publisher_name text not null,
  weex_referral_url text not null,
  published_at bigint not null,
  updated_at bigint not null,
  constraint strategy_publications_version_user_fk
    foreign key (strategy_version_id, user_id)
    references public.strategy_versions(id, user_id)
    on delete cascade,
  constraint strategy_publications_backtest_user_fk
    foreign key (backtest_job_id, user_id)
    references public.backtest_jobs(id, user_id)
    on delete cascade,
  constraint strategy_publications_slug_format
    check (slug ~ '^[a-z0-9][a-z0-9-]{7,79}$'),
  constraint strategy_publications_description_length
    check (char_length(description) between 20 and 400),
  constraint strategy_publications_publisher_length
    check (char_length(publisher_name) between 1 and 100),
  constraint strategy_publications_weex_url
    check (
      char_length(weex_referral_url) between 12 and 2048
      and lower(weex_referral_url) ~ '^https://([a-z0-9-]+\.)*weex\.com(/|\?|$)'
      and weex_referral_url !~ '[@#]'
    ),
  constraint strategy_publications_time_order
    check (published_at >= 0 and updated_at >= published_at)
);

create unique index strategy_publications_slug_uidx
  on public.strategy_publications(slug);
create unique index strategy_publications_version_uidx
  on public.strategy_publications(strategy_version_id);
create index strategy_publications_published_idx
  on public.strategy_publications(published_at desc);
create index strategy_publications_user_updated_idx
  on public.strategy_publications(user_id, updated_at desc);
create index strategy_publications_backtest_idx
  on public.strategy_publications(backtest_job_id);

alter table public.strategy_publications enable row level security;
revoke all on table public.strategy_publications from anon, authenticated;
create policy deny_data_api on public.strategy_publications
  as restrictive for all to anon, authenticated
  using (false) with check (false);
grant select, insert, update, delete on table public.strategy_publications to cryptobot_netlify;

comment on table public.strategy_publications is
  'Public strategy landing pages bound to an owned immutable version and a complete historical backtest.';
comment on column public.strategy_publications.weex_referral_url is
  'Publisher-supplied HTTPS WEEX registration URL; validated again by the server before storage and rendering.';
