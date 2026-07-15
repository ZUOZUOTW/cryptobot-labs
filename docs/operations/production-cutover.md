# Production cutover gates

`DEMO_MODE` and `LIVE_TRADING_ENABLED` remain fail-closed until every gate below is evidenced.

## Completed foundations

- Netlify production `PUBLIC_ORIGIN=https://www.cryptobotlabs.app`, Supabase URL/publishable key, signed Auth cookie secret, and the remote Functions/Runtime `DEMO_MODE=false` binding are configured.
- Supabase Auth routes use PKCE and short-lived signed state.
- Supabase Data API access is deny-all for the server-owned control plane.
- WEEX OAuth signing, PKCE generation, exact-body token exchange, create-api parsing, and secret-safe containers have tests.
- Netlify-to-executor OAuth handoff is HMAC-signed, expires after 60 seconds, stores only session/nonce hashes, and is delivered server-to-server rather than through a browser URL.
- The fixed-IP executor now implements OAuth start/callback, single-use state consumption, encrypted PKCE persistence, KMS-encrypted credential persistence, and a safe public connection-status projection; missing WEEX credentials return 503 and never weaken Live gates.
- KMS envelope format uses AES-256-GCM with connection/user encryption context and clears plaintext data keys.
- Supabase contains safe WEEX connection projections plus private OAuth state, credential blob, and fenced executor lease tables.
- Public privacy, terms, risk, and affiliate disclosure routes exist.
- AWS production base infrastructure is applied in account `148905583129`, region `ap-northeast-1`: EC2 `i-089afdd187c2cd0d8`, fixed egress `35.73.141.178`, rotating KMS key, KMS-backed Secrets Manager container, least-privilege instance role, encrypted gp3 volume, and SSM-only administration.
- Terraform state is stored in the private, encrypted, versioned S3 bucket `cryptobot-labs-terraform-state-148905583129`; the production security group has no ingress until origin TLS is installed.
- AWS account-level monthly cost budget `cryptobot-labs-production-monthly` is set to `USD 300`, with alerts at 80% actual spend, 100% actual spend, and 100% forecasted spend. The notification address is stored only in AWS Budgets, not source control.
- The official AWS KMS SDK is pinned, the production KMS adapter is compiled, and its focused tests pass.
- The executor reads `AWSCURRENT` directly from the KMS-backed Secrets Manager container using its instance role; no runtime secret file is required on EC2.
- `www.cryptobotlabs.app` is the Netlify primary domain with active Let’s Encrypt TLS; the apex redirects to `www`, and Cloudflare authority serves both DNS records.
- Supabase OAuth/control-plane migrations are applied. The `cryptobot_executor` runtime role is login-enabled, NOBYPASSRLS, SCRAM-protected, connection-limited, and uses the TLS Session Pooler at `aws-1-ap-northeast-2.pooler.supabase.com:5432`.
- Supabase security advisors report no findings. Performance advisors contain only informational unused-index notices from the newly provisioned workload and one Auth connection-allocation notice; no index is removed before production query evidence exists.
- The signed executor release is installed through SSM. Caddy serves a valid Let’s Encrypt certificate for `api.cryptobotlabs.app`, Cloudflare DNS resolves to fixed IP `35.73.141.178`, and Terraform exposes only HTTPS/443 inbound (`1 added, 0 changed, 0 destroyed`).
- Public `/healthz` and `/readyz` checks pass. KMS, fixed egress, database, and credential-envelope checks are ready while `oauthEnabled=false` and `liveTradingEnabled=false` remain intentional.
- Netlify production deploy `6a56457e179fbb0a75a7b50c` includes the Executor origin, secret-scoped handoff configuration, production Auth bindings, and the Supabase opaque refresh-token compatibility fix. The Next.js production build, TypeScript validation, 45 page routes, Functions, and Edge Function packaging passed; external smoke tests return HTTP 200 for the homepage, Auth, Connections, Executor health, and Executor readiness. The apex resolves to `www`; demo mode is disabled while all Live gates remain fail-closed.
- Supabase Auth now uses the production Site URL `https://www.cryptobotlabs.app` and the exact redirect allow-list entry `https://www.cryptobotlabs.app/auth/callback`; no wildcard production redirect is enabled.
- The Google OAuth web client is configured with the exact production origin and Supabase callback, its secret is stored in Supabase Auth, and the Google provider is enabled. The external OAuth app is published as `In production` rather than limited to test users. A production-browser smoke test completed Google account selection, PKCE callback, authenticated `/connections` rendering, Supabase session creation, same-origin sign-out, remote revoke attempt, and deterministic local cookie clearing on 2026-07-14.

## External gates still required

- Receive WEEX `clientId`/secret; confirm callback behavior and prove the resulting API key has no withdrawal permission.
- Have qualified counsel approve the operating entity, jurisdiction, contact details, privacy retention, terms, and risk text.

## Mandatory verification before live

1. Google sign-in, callback, authenticated identity, sign-out, and local session-clearing smoke tests pass; callback replay rejection and explicit remote-revocation evidence remain required.
2. WEEX OAuth state expiry, concurrent callback, token/create-api failure, relink, revoke, and no-secret-log tests.
3. KMS GenerateDataKey/Decrypt, wrong-context rejection, rotation, scheduled deletion, backup and recovery tests.
4. Fixed egress IP observation from the executor and WEEX allow-list confirmation.
5. Executor lease/fencing, restart recovery, order reconciliation, API timeout, unknown-order and emergency-stop tests.
6. Load and failover tests with `LIVE_TRADING_ENABLED=false`.
7. Authorized account Paper soak, then operator-approved minimum-size spot live order; futures live remains disabled until separately approved.
8. Audit evidence records the approver, exact strategy/risk hashes, timestamps, order/fill reconciliation, and successful credential revocation.
