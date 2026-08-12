# Netlify ownership handoff to WEEX

This runbook transfers the existing CryptoBot Labs Netlify project to a
WEEX-owned Netlify team without deploying, cloning, or recreating the site.
The transfer window is an ownership change, not an application or Next.js
adapter upgrade.

Never paste a Netlify token, environment value, project/account ID, deploy ID,
database URL, or handoff secret into Git, chat, an issue, or this runbook.
Record identifiers and approvals only in the private handoff evidence system.

## Current redacted inventory (read-only, 2026-08-12)

The source workstation has a valid user-scoped Netlify session, but no global
Netlify CLI binary and no `.netlify/state.json` link in either the repository
root or this worktree. That personal session and its token must not be handed
to WEEX. The authenticated, GET-only API audit found exactly one matching
project:

| Item | Redacted result |
| --- | --- |
| Project | `cryptobot-labs` |
| Git source | `https://github.com/ZUOZUOTW/cryptobot-labs`, production branch `main` |
| Primary domain | `www.cryptobotlabs.app`, Netlify TLS active |
| Framework/output | Next.js 16, `.next` |
| Published deployment | Present; deploy ID omitted |
| Project/account IDs | Present; values omitted |
| Domain aliases returned by project API | None |
| Forbidden AWS/WEEX execution secrets | None found |

The committed `netlify.toml` is the deployment authority. The dashboard's
stored build-command field still shows an older command without the current
environment, database-readiness, and Edge-bundle gates. Netlify's committed
configuration overrides dashboard build settings, but the first post-transfer
deploy log must prove that the committed command was actually used.

The redacted environment snapshot is committed separately in
`netlify-handoff-inventory.json`. It records names/scopes/contexts only, never
values. Two required production variables are currently absent and block a
formal deployment. A production publication read smoke check also currently
returns HTTP 503, consistent with the missing server-side database binding:

- `SUPABASE_DATABASE_URL`
- `EXECUTOR_HANDOFF_SECRET`

Do not fix these by copying secrets into a local `.env` file. The WEEX owners
must provision the destination-controlled values through Netlify's protected
environment-variable UI or approved secret automation. The database URL must
use the `cryptobot_netlify` runtime role. The handoff secret must be coordinated
with the Executor operator and must contain 32–512 bytes.

## Repository preflight

Use the pinned repository Node/pnpm versions, then run:

```bash
pnpm install --frozen-lockfile
pnpm handoff:netlify:preflight
pnpm test:deployment-env
pnpm test -- tests/netlify-build.test.ts tests/netlify-handoff.test.ts
```

The normal CI workflow also runs the repository preflight explicitly. It
validates the build contract, required variable names, secret boundaries,
ignored local link state, and the absence of Executor-only credentials.

An Owner can run the optional remote audit with a short-lived, least-privilege
token injected by an approved secret manager:

```bash
pnpm handoff:netlify:preflight --remote --site-name cryptobot-labs
```

`NETLIFY_AUTH_TOKEN` must already exist in that process environment. Do not put
it inline in shell history. Remote mode issues GET requests only and prints
public metadata, environment key names, scopes/contexts, and 12-character
one-way fingerprints. It never prints resource IDs, deploy IDs, variable
values, operator details, or API response bodies.

The remote preflight must fail until both missing variables are provisioned.
It validates production/all-context values in memory, including exact fixed
settings, canonical origins and IPv4, the restricted database role, current
publishable-key format, and secret byte lengths. Its findings are deliberately
generic and it discards all values before producing output. That failure is
intentional.

## Inputs WEEX must provide privately

Before scheduling the transfer, obtain:

1. WEEX destination Netlify team name, team slug, and account ID.
2. At least two WEEX-controlled Team Owners and one billing owner/contact.
3. Confirmation that the destination plan supports the source project's
   required features, build/runtime usage, protected variables, and traffic.
4. A WEEX-owned GitHub identity with access to the repository and permission
   to operate the Netlify Git integration.
5. A WEEX-owned, short-lived Netlify token for post-transfer read-only audit;
   never reuse the source operator's personal token.
6. Private values for every production environment variable in the contract
   below, with the database and Executor values supplied through their
   respective approved owners.
7. Named transfer operator, verifier, change window, rollback owner, and
   private evidence location.

The destination account ID is not derivable from this repository. It cannot be
guessed or safely inferred from the WEEX company name.

## Environment contract

All ten variables must have a `production` or `all` contextual value. Prefer a
production-only value for formal credentials. Build previews must use an
independent non-production binding set or fail closed; never expose production
database or handoff credentials to untrusted previews.

| Variable | Minimum Netlify scopes | Secret setting | Ownership note |
| --- | --- | --- | --- |
| `AUTH_COOKIE_SECRET` | Builds, Functions | Secret | Rotate after transfer; rotation signs out existing sessions |
| `DEMO_MODE` | Builds, Functions | Non-secret | Production is exactly `false` |
| `EXECUTOR_API_ORIGIN` | Builds, Functions | Non-secret | Distinct origin-only HTTPS URL |
| `EXECUTOR_HANDOFF_SECRET` | Builds, Functions | Secret | Rotate atomically with the Executor operator |
| `NEXT_PUBLIC_EXECUTOR_EGRESS_IP` | Builds | Non-secret/public by design | One fixed IPv4 address |
| `PUBLIC_ORIGIN` | Builds, Functions | Non-secret | `https://www.cryptobotlabs.app` |
| `SUPABASE_DATABASE_URL` | Builds, Functions | Secret | TLS pooler URL using `cryptobot_netlify` only |
| `SUPABASE_PUBLISHABLE_KEY` | Builds, Functions | Non-secret | Publishable key only; never secret/service role |
| `SUPABASE_URL` | Builds, Functions | Non-secret | Origin-only HTTPS URL |
| `WEEX_AUTH_STAGE` | Builds, Functions | Non-secret | Keep `transition` until separately approved |

The following must not exist in Netlify: AWS access keys, `AWS_KMS_KEY_ID`,
`LIVE_TRADING_ENABLED`, WEEX client/API/secret/passphrase values, or any KMS
plaintext. They belong to the Executor security boundary, not the web control
plane.

Netlify supports site-level and team-shared environment variables. A project
transfer does not make destination-team shared variables appear by magic.
Inspect each key in the UI, confirm whether its source is site or shared, and
create a destination-owned site binding when necessary. Never export values to
the repository or attach a plaintext `.env` file to the handoff.

## Transfer prerequisites

Netlify's current project-transfer rules require all of the following:

- The source operator is a Team Owner.
- Project transfers are allowed under **Team settings → Access & security →
  Transfer site settings**. Enterprise teams begin with outgoing transfers
  blocked by default.
- The same operator is already an Owner or Developer in the destination WEEX
  team. If the two teams have no shared Owner/Developer, contact Netlify
  Support instead of attempting a workaround.
- Project members who need continued access are invited to the destination
  team first; non-members lose project-dashboard access after transfer.
- Source and destination plans have been compared. Moving to a lower plan can
  remove feature configuration.
- The destination Git integration can read the repository and report deploy
  statuses. GitHub Enterprise Server or self-managed GitLab projects require
  Netlify Support; the current project uses GitHub.com.
- Billing and credit/usage alerts are owned by WEEX before the source billing
  owner leaves.

Official references:

- [Transfer a project](https://docs.netlify.com/manage/projects/transfer-project/)
- [Roles and permissions](https://docs.netlify.com/manage/accounts-and-billing/team-management/roles-and-permissions/)
- [Manage team members](https://docs.netlify.com/manage/accounts-and-billing/team-management/manage-team-members/)
- [Environment variables overview](https://docs.netlify.com/build/environment-variables/overview/)
- [Next.js on Netlify](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)

## Change-window procedure

### 1. Prepare without changing production

1. Freeze application deploys and record the exact Git SHA privately.
2. Run repository CI and the source-team remote audit.
3. Confirm the latest production deployment is healthy, but do not create a new
   deploy solely for the transfer.
4. Confirm WEEX membership, destination plan, billing, Git access, and team
   transfer setting.
5. Capture key names/scopes/contexts and fingerprints only. Do not capture
   secret values, resource IDs, logs containing tokens, or database URLs.
6. Keep the current source Team Owner in both teams through the verification
   window so the project can be transferred back if the platform transfer
   itself fails.

### 2. Transfer in the Netlify UI

The source Team Owner performs this external, auditable action:

1. Open **Project configuration → General → Project information**.
2. Select **Transfer project**.
3. Select the pre-approved WEEX destination team; verify its private account
   ID/slug against the change ticket before confirmation.
4. Read the plan/member/feature warnings and stop on any unexpected loss.
5. Confirm the transfer once. Do not create a duplicate project or detach the
   custom domain.

This repository intentionally contains no script that mutates project
ownership. Ownership transfer requires interactive Owner authority and review
of Netlify's live warnings.

### 3. Restore destination ownership boundaries

1. WEEX Owners confirm project visibility, member access, billing, Git link,
   production branch, build hooks, deploy notifications, sensitive-variable
   policy, and audit-log access.
2. Provision the two missing bindings and reconcile all other environment keys
   against the table above. Values must enter Netlify directly from the
   approved owners.
3. Rotate the destination Netlify automation token. Revoke the source token
   only after WEEX's token has passed the read-only audit.
4. Rotate `AUTH_COOKIE_SECRET`; document the expected sign-out event.
5. Rotate `EXECUTOR_HANDOFF_SECRET` in a coordinated maintenance step with the
   Executor owner. Never leave Netlify and the Executor on mismatched values.
6. Rotate/reissue the `cryptobot_netlify` database password through the
   database owner and replace the Netlify URL directly. Do not alter the role
   name or use a privileged role.
7. Run the remote preflight under the WEEX-owned token. Record only its
   redacted output and verify that the account fingerprint changed while the
   site fingerprint remained stable.

### 4. Verified deployment

Only after the database migrations/readiness gates are separately approved:

1. Trigger one Git-based Deploy Preview or controlled branch deploy using
   non-production bindings. Do not use `netlify deploy --prod` from a source
   workstation.
2. Confirm the deploy log reads committed `netlify.toml`, Node `22.23.1`, the
   deployment-environment gate, website database-readiness gate, Next.js build,
   and Edge-bundle check.
3. Promote through the approved Git production flow.
4. Confirm the custom domain and TLS, security headers, homepage, Auth start and
   callback, sign-out, authenticated console, strategy publication/discovery,
   social poster, and the connection route's safe fail-closed behavior.
5. Confirm no variable value appears in logs and no production credential was
   made available to a Deploy Preview.
6. Keep real-money execution disabled. Netlify ownership does not authorize a
   WEEX Live order or change the Executor's independent Live gate.

### 5. Closeout

After WEEX accepts the verification evidence:

1. Remove source-team project members and revoke source Netlify tokens.
2. Confirm the source team no longer pays for the project or its usage.
3. Retain audit logs, redacted preflight output, Git SHA, verification results,
   approvers, and timestamps under WEEX's evidence-retention policy.
4. Remove the old Netlify callback URL from the Auth allow-list only after the
   custom-domain callback has been reverified and the migration window closes.

## Domain handling

The project uses Cloudflare-authoritative DNS; do not move or delete DNS records
from this Netlify runbook. Preserve the custom domain on the project during the
project transfer. If the Netlify team dashboard unexpectedly shows a
Netlify-managed DNS zone or Netlify-registered domain, stop: domain ownership
is a separate Owner-only transfer under **Domain → Collaboration → Transfer
ownership**. A Netlify-registered domain moving to another registrar requires
Netlify Support and may be subject to the ICANN 60-day restriction.

Official reference: [Transfer a domain](https://docs.netlify.com/manage/domains/manage-domains/transfer-a-domain/).

## Rollback

If ownership, plan features, Git access, environment bindings, domain/TLS, or
the first controlled deployment cannot be verified:

1. Stop all deploys and keep Live disabled.
2. If both teams still share the required Owner/Developer, transfer the same
   project back through Netlify's UI. Do not recreate the site or change DNS.
3. If transfer-back is unavailable, open Netlify Support using the private team
   slug, account ID, project ID, and audit-log timestamps.
4. Restore only the last known-good deployment through Netlify's normal deploy
   controls after ownership is stable. Database schema rollback is not part of
   a Netlify ownership rollback.

## Post-transfer adapter follow-up

The repository currently pins `@netlify/plugin-nextjs` `5.15.12`. Netlify's
current guidance recommends the automatically managed OpenNext adapter for
modern Next.js and recommends not pinning it. Do not combine that runtime
migration with the ownership transfer. After WEEX accepts the transfer, test a
separate preview that removes the package/config pin, compare SSR, route
handlers, social images, ISR/cache behavior, and middleware, then promote it as
an independently reviewed change.
