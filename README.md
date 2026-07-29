# CryptoBot Labs

An open-source, WEEX-only strategy discovery, historical backtesting, and
automated-execution platform. The web control plane runs on Next.js/Netlify;
the fixed-egress AWS Executor validates and encrypts exchange credentials; the
desktop Agent provides a user-controlled execution option.

Exchange credentials remain inside the encrypted execution boundary. The
website stores only masked permission evidence and version-fenced control
commands. The codebase deliberately contains no withdrawal or asset-transfer
request path.

> Automated trading can lose the full allocated balance. This software is not
> investment advice and does not guarantee strategy performance, uptime, order
> execution, or liquidation protection.

## Prerequisites

- Node.js `>=22.23.1`
- pnpm `11.9.0` (the repository and CI pin this exact version)

## Quick Start

```bash
cp .env.example .env.local
pnpm install
pnpm run dev
pnpm test
pnpm run lint
pnpm run build
```

The example environment starts in safe demo mode and uses only synthetic
identifiers. Never copy production credentials into a local file committed to
Git.

## Included Shape

- edit site code under `app/`
- Netlify production uses the server-side Supabase Postgres binding; no OpenAI Sites project binding is kept in this repository
- `netlify.toml` defines the formal production build and static-asset caching
- `db/schema.ts` defines the control-plane data model
- `examples/d1/` contains an optional D1-compatible example surface for repository tests
- `drizzle.config.ts` supports local migration generation when needed
- `apps/executor/` contains the fixed-egress, KMS-backed cloud execution boundary
- `apps/agent/` contains the signed desktop Agent
- `packages/weex-client/` and `packages/trading-core/` contain exchange and deterministic trading primitives

## WEEX order attribution

CryptoBot Labs is registered with WEEX Broker ID `WEEX111162`. Every new Spot,
Futures, and Futures Demo order created by this project must carry a unique
`newClientOrderId` in the form
`b-WEEX111162-<22-character deterministic suffix>`. The order path fails
closed when this attribution is absent or exceeds WEEX's 36-character limit.
Legacy `cb_` order IDs remain lookup/cancellation-compatible only for safe
rollout reconciliation.

Do not substitute a Broker UID, account UID, API key, or other private
identifier into an order ID.

## Useful Commands

- `pnpm run dev`: start local development
- `pnpm test`: run the Vitest suite
- `pnpm run lint`: run ESLint
- `pnpm run build`: verify the same Next.js production output used by Netlify
- `pnpm run licenses:check`: reject unreviewed production dependency licenses
- `pnpm run db:generate`: generate Drizzle migrations after schema changes

## Formal member authentication

During WEEX review, the formal site uses Supabase Auth with Google OAuth and Email Magic Link. Auth transactions use PKCE plus a
10-minute signed HttpOnly state cookie. Access and refresh tokens remain in `Secure`, `HttpOnly`, `SameSite=Lax`
cookies, and server API identity is accepted only after the Supabase Auth `/user` endpoint validates the access token.
Copy `.env.example` into the deployment secret manager and set `DEMO_MODE=false`; missing or malformed values fail
closed. Only the Supabase publishable key may be used for this flow—never expose a secret or `service_role` key.

Before enabling Google, add the site's exact `/auth/callback` URL to the Supabase redirect allow-list and configure
the Google provider in Supabase. Live trading remains hard-disabled independently of successful member login.

`WEEX_AUTH_STAGE` controls the reviewed rollout as one atomic state: `transition` keeps the current login and
manual API connection while WEEX OAuth is disabled; `dual` adds approved WEEX OAuth without removing the fallback;
`oauth-only` removes the legacy login and manual credential endpoint. Production must remain `transition` until the
WEEX application is approved. The web layer additionally keeps `oauth-only` fail-closed until a stable WEEX
user-identity callback is implemented.

## Desktop Agent releases

Pull requests build clearly labelled unsigned internal-test artifacts for macOS and Windows. Public `agent-v*`
releases fail closed unless platform signing inputs are present, then create hardened, signed installers with
SHA-256 checksums and a CycloneDX SBOM. Never publish artifacts from `apps/agent/out` manually; the website download
manifest may only be updated from a release that passes `scripts/verify-agent-artifact.mjs --public`.
Set the repository Actions variable `CBL_CONTROL_PLANE_ORIGIN` to the deployed HTTPS site origin before creating an
`agent-v*` tag; public packaging fails closed when this origin or platform signing inputs are missing.

## Security and operations gates

- [Live trading threat model](docs/security/live-trading-threat-model.md)
- [WEEX credential handling](docs/security/credential-handling.md)
- [Desktop Agent release checklist](docs/operations/agent-release-checklist.md)
- [Live execution smoke-test checklist](docs/operations/live-smoke-test-checklist.md)
- [Security reporting policy](SECURITY.md)
- [Open-source publication audit](docs/security/open-source-audit.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Automated validation must not place real-money orders. Public downloads require signed platform artifacts, checksums,
an SBOM, and release verification. Real-money acceptance additionally requires explicit authorisation and the manual
smoke-test checklist; missing certificates or test credentials must never weaken these gates.

## Contributing and support

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request and
[SUPPORT.md](SUPPORT.md) before opening an issue. Never post a real API key,
token, session, database URL, private order record, or production
infrastructure identifier. Suspected vulnerabilities must use the private
process in [SECURITY.md](SECURITY.md).

CryptoBot Labs uses WEEX APIs and a registered Broker ID. WEEX names and marks
belong to their respective owner; this repository does not grant rights to
third-party trademarks.

## License and brand

CryptoBot Labs software, documentation, and configuration are licensed under
the [Apache License 2.0](LICENSE). Preserve the attribution in [NOTICE](NOTICE)
and the applicable notices in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The CryptoBot Labs names, logos, application icons, mascots, and other files
listed in [BRAND_ASSETS.md](BRAND_ASSETS.md) are not licensed under
Apache-2.0. See [TRADEMARKS.md](TRADEMARKS.md) before distributing a fork or
modified build.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Netlify Next.js Documentation](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
