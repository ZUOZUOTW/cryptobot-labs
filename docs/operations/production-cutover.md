# Production cutover gates

`DEMO_MODE` and `LIVE_TRADING_ENABLED` remain fail-closed until every gate below is evidenced.

> Ownership-handoff status (2026-08-12): a GET-only Netlify audit found that
> `SUPABASE_DATABASE_URL` and `EXECUTOR_HANDOFF_SECRET` are absent from the
> current site environment. Historical deployment evidence below does not
> supersede current runtime state. A new formal deploy is blocked until the
> WEEX-controlled owners provision both values, pass the redacted remote
> preflight in `netlify-weex-handoff.md`, and re-run the database readiness
> gate. No secret value or Netlify resource ID is stored in this repository.

## Completed foundations

- The Netlify production contract requires `PUBLIC_ORIGIN=https://www.cryptobotlabs.app`, an origin-only HTTPS Supabase URL, current `sb_publishable_...` key, signed Auth cookie secret, and `DEMO_MODE=false`. A legacy JWT `anon` key or `sb_secret_...` key is not an accepted substitute. Current external readiness is governed by the ownership-handoff status above.
- Supabase Auth routes use PKCE and short-lived signed state.
- Supabase Data API access is deny-all for the server-owned control plane.
- WEEX OAuth signing, PKCE generation, exact-body token exchange, create-api parsing, and secret-safe containers have tests.
- Netlify-to-executor OAuth handoff is HMAC-signed, expires after 60 seconds, stores only session/nonce hashes, and is delivered server-to-server rather than through a browser URL.
- The fixed-IP executor now implements OAuth start/callback, single-use state consumption, encrypted PKCE persistence, KMS-encrypted credential persistence, and a safe public connection-status projection; missing WEEX credentials return 503 and never weaken Live gates.
- KMS envelope format uses AES-256-GCM with connection/user encryption context and clears plaintext data keys.
- Supabase contains safe WEEX connection projections plus private OAuth state, credential blob, and fenced executor lease tables.
- Public privacy, terms, risk, and affiliate disclosure routes exist.
- Private deployment evidence confirms the production AWS account, region, executor instance, reserved egress IP, rotating KMS key, KMS-backed Secrets Manager container, least-privilege instance role, encrypted gp3 volume, and SSM-only administration. Concrete resource identifiers stay outside the public repository.
- Terraform state is stored in a private, encrypted, versioned S3 backend whose account-specific name is supplied at bootstrap time; the production security group has no ingress until origin TLS is installed.
- AWS account-level monthly cost budget `cryptobot-labs-production-monthly` is set to `USD 300`, with alerts at 80% actual spend, 100% actual spend, and 100% forecasted spend. The notification address is stored only in AWS Budgets, not source control.
- The official AWS KMS SDK is pinned, the production KMS adapter is compiled, and its focused tests pass.
- The executor reads `AWSCURRENT` directly from the KMS-backed Secrets Manager container using its instance role; no runtime secret file is required on EC2.
- `www.cryptobotlabs.app` is the Netlify primary domain with active Let’s Encrypt TLS; the apex redirects to `www`, and Cloudflare authority serves both DNS records.
- The confirmed Supabase OAuth/control-plane migration prefix through `20260728164403` is applied. The `cryptobot_executor` runtime role is login-enabled, NOBYPASSRLS, SCRAM-protected, connection-limited, and uses the project-specific TLS Session Pooler recorded in the private deployment configuration. New August strategy-referral, discovery, and cloud-run safety migrations remain explicitly pending until the rollout gate below records remote evidence.
- The CryptoBot-controlled migration prefix previously had no Security Advisor finding. The 2026-08-12 shared-project inventory now reports a Nexus-owned SECURITY DEFINER warning; it must have a named owner, triage record, and explicit disposition before transfer. Performance findings remain review evidence rather than permission to remove an index.
- The signed executor release is installed through SSM. Caddy serves a valid certificate for `api.cryptobotlabs.app`, Cloudflare proxies the reserved executor origin, and Terraform exposes only HTTPS/443 from reviewed Cloudflare proxy ranges.
- Public `/healthz` and `/readyz` checks pass. KMS, fixed egress, database, and credential-envelope checks are ready while `oauthEnabled=false` and `liveTradingEnabled=false` remain intentional.
- Historical private deployment evidence covered the Executor origin, secret-scoped handoff configuration, production Auth bindings, opaque refresh-token handling, Next.js build, Functions/Edge packaging, and external smoke tests. The apex resolves to `www`; all Live gates remain fail-closed. Deploy IDs stay in private operational evidence, and the current external environment must still pass the ownership-handoff audit above.
- Supabase Auth now uses the production Site URL `https://www.cryptobotlabs.app` and the exact redirect allow-list entry `https://www.cryptobotlabs.app/auth/callback`; no wildcard production redirect is enabled.
- The Google OAuth web client is configured with the exact production origin and Supabase callback, its secret is stored in Supabase Auth, and the Google provider is enabled. The external OAuth app is published as `In production` rather than limited to test users. A production-browser smoke test completed Google account selection, PKCE callback, authenticated `/connections` rendering, Supabase session creation, same-origin sign-out, remote revoke attempt, and deterministic local cookie clearing on 2026-07-14.
- WEEX registered Broker ID `WEEX111162` for CryptoBot Labs. The separate Broker UID stays in private operations metadata and is never placed in an order ID. New Spot, Futures, and Futures Demo submissions fail closed unless their `newClientOrderId` uses the 35-character `b-WEEX111162-<22-character deterministic suffix>` format. Legacy `cb_` IDs remain queryable and cancellable for safe rollout reconciliation.
- This repository mirrors the confirmed CryptoBot prefix only. Production has 19 later, cross-product migration versions whose canonical SQL is not present here, so this checkout is not a complete production migration chain and must not run `db push`. Leaked Password Protection is enabled for the current Google/Email transition login.
- `WEEX_AUTH_STAGE=transition` is the production rollout state: Google/Email login and the KMS-encrypted manual API path remain available, while WEEX OAuth start is disabled even if credentials are pre-provisioned. `dual` and `oauth-only` require separate reviewed cutovers.

## Pending database rollout gate

The repository baseline currently marks these migrations as pending, not as
production evidence:

1. `20260812061404_authorize_strategy_referrals.sql`
2. `20260812072739_add_strategy_publication_discovery_projection.sql`
3. `20260812090000_enforce_cloud_run_target_exclusivity.sql`

Before deploying either the website or Executor:

1. Treat the known `22 local + 19 remote-only` production history as a P0 stop.
   Follow `docs/operations/supabase-weex-handoff.md`; an exact 22-version match
   is not a valid precondition.
2. Recover and review all 19 canonical remote entries (timestamp, name, SQL,
   normalized hash, owning product, reviewer), or use an approved isolated
   deployment chain that contains the complete 41-version history. `db pull`
   alone is insufficient. Do not use history repair or `--include-all`.
3. Only from that complete, approved chain may a deployer review a dry run and
   apply exactly the three pending migrations in timestamp order during the
   database maintenance window, before the new website or Executor artifact.
4. Re-run `supabase migration list` and verify all 44 versions plus the expected
   catalog objects. Promote pending entries locally only when this repository
   has become the reviewed canonical complete chain; otherwise preserve their
   pending status and record the isolated deployment manifest.
5. Run `node scripts/check-production-database-readiness.mjs website` with the
   website runtime role and `node scripts/check-production-database-readiness.mjs executor`
   with the Executor runtime role. Both checks must pass before application
   traffic is shifted.

Schema rollback is not an accepted recovery path after these migrations are
applied. Keep Live disabled, roll application traffic forward only, and add a
new CLI-generated corrective migration if a database defect is discovered.

## External gates still required

- Receive WEEX `clientId`/secret; confirm callback behavior and prove the resulting API key has no withdrawal permission.
- Have qualified counsel approve the operating entity, jurisdiction, contact details, privacy retention, terms, and risk text.

## Mandatory verification before live

1. Google sign-in, callback, authenticated identity, sign-out, and local session-clearing smoke tests pass; callback replay rejection and explicit remote-revocation evidence remain required.
2. WEEX OAuth state expiry, concurrent callback, token/create-api failure, relink, revoke, and no-secret-log tests.
3. KMS GenerateDataKey/Decrypt, wrong-context rejection, rotation, scheduled deletion, backup and recovery tests.
4. Fixed egress IP observation from the executor and WEEX allow-list confirmation.
5. Executor lease/fencing, restart recovery, order reconciliation, API timeout, unknown-order and emergency-stop tests.
6. Confirm every minimum-size Spot, Futures Demo, and separately approved Futures test order appears in WEEX Broker reporting under `WEEX111162`; stop the rollout if attribution is absent.
7. Load and failover tests with `LIVE_TRADING_ENABLED=false`.
8. Authorized account Paper soak, then operator-approved minimum-size spot live order; futures live remains disabled until separately approved.
9. Audit evidence records the approver, exact strategy/risk hashes, timestamps, Broker-attributed order ID, order/fill reconciliation, and successful credential revocation.

## Authentication rollout order

1. `transition`: keep Supabase Google/Email identity and manual API entry; reject WEEX OAuth start at both Netlify and the executor.
2. `dual`: only after WEEX approval, deploy the client credentials to AWS Secrets Manager and prove callback, no-withdrawal permissions, relink, revoke, and rollback behavior before changing the stage.
3. `oauth-only`: only after a stable WEEX-to-platform user identity contract and account migration are implemented. Legacy login and manual API entry are then rejected at both UI and API boundaries.

The safe `public.weex_connections` projection records `credential_source` as `manual` or `oauth`. Completion and
failure updates are fenced by that source so overlapping transition flows cannot overwrite one another.
