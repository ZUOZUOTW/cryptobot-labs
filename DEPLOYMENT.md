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
2. If `20260812090000` is absent remotely, review `supabase db push --dry-run`,
   apply the migration, verify the compatibility trigger and canonical unique
   index, and only then deploy the application.
3. If `20260812090000` is already present remotely, stop. Its recorded SQL may
   differ from this pending file. Create a newer forward-only repair with
   `supabase migration new`, review and apply that repair, then resume the app
   deployment. Do not use `--include-all` or migration-history repair merely to
   force local filenames to match production.
4. Smoke-test both an old-writer insert (without explicit `market`/`symbol`)
   and rejection of equivalent aliases such as `BTC_USDT` and `CMT_BTCUSDT`
   before releasing traffic.

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
