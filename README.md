# CryptoBot Labs

A WEEX-only strategy discovery, historical backtesting, and automated-execution product deployed as a
Next.js application on Netlify. Exchange credentials remain in the encrypted execution boundary; the
website stores only masked permission evidence and version-fenced control commands.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
pnpm install
pnpm run dev
pnpm test
pnpm run lint
pnpm run build
```

## Included Shape

- edit site code under `app/`
- Netlify production uses the server-side Supabase Postgres binding; no OpenAI Sites project binding is kept in this repository
- `netlify.toml` defines the formal production build and static-asset caching
- `db/schema.ts` defines the control-plane data model
- `examples/d1/` contains an optional D1-compatible example surface for repository tests
- `drizzle.config.ts` supports local migration generation when needed

## Useful Commands

- `pnpm run dev`: start local development
- `pnpm test`: run the Vitest suite
- `pnpm run lint`: run ESLint
- `pnpm run build`: verify the same Next.js production output used by Netlify
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

Automated validation must not place real-money orders. Public downloads require signed platform artifacts, checksums,
an SBOM, and release verification. Real-money acceptance additionally requires explicit authorisation and the manual
smoke-test checklist; missing certificates or test credentials must never weaken these gates.

## Learn More

- [Next.js Documentation](https://nextjs.org/docs)
- [Netlify Next.js Documentation](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
