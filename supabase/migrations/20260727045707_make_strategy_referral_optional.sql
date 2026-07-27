alter table public.strategy_publications
  alter column weex_referral_url drop not null;

comment on column public.strategy_publications.weex_referral_url is
  'Optional publisher-supplied HTTPS WEEX registration URL; set separately while sharing and validated by the server before storage and rendering.';
