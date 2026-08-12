# CryptoBot Labs deployment

- Production provider: Netlify.
- Netlify site: `cryptobot-labs` (`https://cryptobot-labs.netlify.app`).
- Do not publish this website with OpenAI Sites unless the user explicitly changes this preference.
- Build on Netlify with the checked-in `netlify.toml` command, which clears stale
  output, first validates the canonical HTTPS `PUBLIC_ORIGIN` and explicit
  `DEMO_MODE`, runs the webpack production build, and rejects Node-only trading
  sandbox dependencies in the Edge middleware bundle. A missing or unsafe
  origin must fail the build because strategy poster rendering cannot safely
  infer a production origin from the request `Host` header.
- Keep `.netlify/` local and ignored. Never commit Netlify authentication tokens.

## Cloud-run target migration gate

The cloud-run target exclusivity migration changes a live-trading safety
boundary. Apply database changes before deploying the matching application,
and preserve rollback compatibility with the trigger installed by the
migration.

1. Run `supabase migration list` against the linked production project and
   compare it with `supabase/production-migration-baseline.json`.
2. The pending sequence is `20260812061404_authorize_strategy_referrals` then
   `20260812090000_enforce_cloud_run_target_exclusivity`. If both are absent
   remotely, review `supabase db push --dry-run`, apply them in that order,
   verify the promoter grants, compatibility trigger, canonical unique index,
   and stop-fence function, and only then deploy the application.
3. If either pending timestamp already exists remotely, stop. Its recorded SQL
   may differ from the reviewed pending file. Compare the remote history and
   applied catalog objects before continuing. For any divergence, create a
   newer forward-only repair with `supabase migration new`, review and apply
   that repair, then resume the app deployment. Do not use `--include-all` or
   migration-history repair merely to force local filenames to match production.
4. Smoke-test both an old-writer insert (without explicit `market`/`symbol`)
   and rejection of equivalent aliases such as `BTC_USDT` and `CMT_BTCUSDT`
   before releasing traffic.
5. Run `pnpm db:preflight:website` with the formal Netlify bindings and
   `pnpm db:preflight:executor` with the AWS Secrets Manager runtime bindings.
   Both commands query catalog evidence rather than trusting migration-history
   filenames. They require non-null canonical `market`/`symbol` columns, the
   valid partial unique index, enabled compatibility trigger and functions,
   and the installed stop fence. The website check additionally requires the
   promoter table, trust constraints, RLS policy, and read-only Netlify grant.
   Any failure stops the release.
6. As a separate application smoke test, confirm a normal member cannot submit
   an arbitrary referral URL, an active approved promoter can activate only the
   server-owned URL, and disabling that promoter removes the public referral on
   the next request. Browser roles must never receive write access to
   `public.promoters`.

Formal Netlify builds run the website preflight automatically. Only the
hard-coded synthetic GitHub build origin is exempt because it has no database;
that exception additionally requires GitHub Actions runtime markers and cannot
apply to Netlify. Demo builds remain database-independent.

## Runtime database-role gate

- The website connection must resolve in PostgreSQL as both
  `current_user=cryptobot_netlify` and `session_user=cryptobot_netlify`.
- The executor connection must resolve as both
  `current_user=cryptobot_executor` and `session_user=cryptobot_executor`.
- For both identities, `rolsuper=false` and `rolbypassrls=false` are mandatory.
  A URL username is checked early, but the database catalog is authoritative;
  pooler usernames may contain a project suffix.
- The website validates identity before its first control-plane statement. The
  executor validates each independent database pool at startup, and `/readyz`
  cannot become ready until both identity checks and the complete schema fence
  pass. Never replace either URL with `postgres`, `service_role`, or an
  administrator connection to work around a failed check.

## Formal member-authentication gate

The current runtime accepts only Supabase's low-privilege
`sb_publishable_...` key format. A legacy JWT `anon` key, a `sb_secret_...`
key, or a malformed Auth origin fails the production build and all formal Auth
routes fail closed.

1. In Supabase, copy the current publishable key from the project's API keys
   page. Do not substitute the secret/service-role key or a legacy JWT `anon`
   key.
2. Set `SUPABASE_URL` to the origin-only HTTPS project URL and
   `SUPABASE_PUBLISHABLE_KEY` to that publishable key in Netlify's production
   environment. Keep both values out of committed files.
3. Run the deployment environment check with the production bindings, then
   smoke-test Google sign-in, Email Magic Link, `/api/auth/session`, strategy
   save, publication, Explore visibility, My Strategies, and sign-out on the
   staging deployment.
4. Stop the release if the project still exposes only a legacy `anon` JWT.
   Rotate to the publishable-key format first; never weaken the checker to make
   a stale credential pass.
