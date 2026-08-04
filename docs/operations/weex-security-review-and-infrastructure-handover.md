# WEEX security review and infrastructure handover plan

Status date: 2026-08-04 (Asia/Taipei)

## Decisions

- Submit the website source code to the WEEX technical team for security review
  on 2026-08-04. Do not wait for the infrastructure migration design to be
  completed before submitting the reviewed source snapshot.
- Move production maintenance and administrative ownership away from personal
  accounts. AWS, Cloudflare, and Supabase must become WEEX-managed or be
  replaced by WEEX-managed equivalents.
- Include the adjacent control planes in the handover scope: GitHub, Netlify,
  the domain registrar, Google OAuth, release signing, monitoring, incident
  response, billing, and backup ownership. The migration is incomplete while
  any production-critical recovery path still depends on one person.
- Keep `WEEX_AUTH_STAGE=transition` and keep live trading fail-closed throughout
  the review and migration. Enabling WEEX OAuth or live trading is a separate
  reviewed cutover.

## Today: immutable security-review submission

The original tested public `main` baseline was:

```text
fcdf5d7281c342f91d49fbf83526e776cd9b4654
```

A complete dependency audit performed after that freeze found high/critical
desktop-runtime and build-chain advisories that the former production-only
audit did not cover. Do not submit the baseline archive as the final review
snapshot. The final delivery commit is the security-remediation branch head
after all required CI and Agent packaging checks pass. Record that exact full
SHA in the external delivery evidence; do not hard-code a prospective commit
SHA in this document because doing so would change the commit being identified.

Repository:

```text
https://github.com/ZUOZUOTW/cryptobot-labs
```

Submit both of the following:

1. The repository URL pinned to the exact commit, so reviewers can inspect
   history and verify the commit identity.
2. A source-only archive generated with `git archive` from that exact commit,
   accompanied by a SHA-256 digest and a tracked-file manifest.

The delivery message must record, outside the public repository:

- WEEX recipient and approved transfer channel;
- sender and delivery timestamp;
- repository URL, full commit SHA, archive filename, and SHA-256;
- review scope and known disabled features;
- acknowledgement time and the WEEX review ticket or case identifier.

### Review scope

Submit the complete monorepo rather than only `app/`. The security boundary
also includes:

- Next.js website and same-origin API routes;
- the WEEX client and Broker order attribution;
- AWS Executor, KMS envelope handling, and signed handoff;
- Supabase migrations, roles, RLS, and Auth integration;
- desktop Agent and release workflow;
- Cloudflare and AWS infrastructure definitions;
- CI, dependency, license, and secret-scanning controls.

### Required evidence

- `README.md`, `SECURITY.md`, `LICENSE`, `NOTICE`,
  `THIRD_PARTY_NOTICES.md`, and `TRADEMARKS.md`;
- `docs/security/credential-handling.md`;
- `docs/security/live-trading-threat-model.md`;
- `docs/security/open-source-audit.md`;
- `docs/operations/production-cutover.md`;
- `.env.example`, with placeholders only;
- `pnpm-lock.yaml`, workspace manifests, and the dependency-license checker;
- successful PR and `main` CI evidence for tests, lint, build, complete
  dependency audit, registry-signature verification, license policy,
  complete-history Gitleaks scanning, and CodeQL analysis;
- the production deployment commit reference, without private deploy IDs or
  provider credentials.

### Prohibited delivery content

Do not include:

- `.env` files, provider tokens, cookies, API keys, OAuth client secrets, or
  signing credentials;
- Terraform state, AWS account/resource IDs, Cloudflare zone IDs, Supabase
  project/database identifiers, the Broker UID, or private deployment evidence;
- production database exports, user records, logs, screenshots containing
  private data, or plaintext/decrypted WEEX credentials;
- `.git/`, `node_modules/`, `.next/`, `.netlify/`, build caches, or local tool
  output.

Sensitive architecture evidence, if WEEX requests it, must be redacted and sent
through a separately approved encrypted channel. Never attach production
credentials to the security-review ticket.

## Migration strategy

Use two distinct stages:

### Stage A: transfer administrative ownership

This is the fastest way to remove the single-person dependency while keeping
the current runtime stable:

- place the AWS workload account under a WEEX-owned AWS Organization, or
  reproduce it in a WEEX-owned AWS account;
- transfer the Supabase project to a WEEX-owned organization;
- move the Cloudflare zone and, where applicable, registrar ownership to a
  WEEX-owned account;
- transfer GitHub administration and Netlify ownership to WEEX-managed teams;
- move Google OAuth and release-signing administration to WEEX-controlled
  organization accounts.

Stage A is an interim governance control. It does not by itself satisfy a WEEX
requirement to remove third-party managed platforms.

### Stage B: re-platform to WEEX-managed servers

Only begin after WEEX provides an approved target architecture. The target must
replace every security property currently supplied by AWS, Cloudflare,
Supabase, and Netlify. Re-platforming is not a lift-and-shift of application
processes alone.

## Current-to-target control map

| Current control | WEEX target must provide |
| --- | --- |
| AWS EC2 + Elastic IP | Hardened compute, fixed outbound IP, patching, host isolation, and capacity/failover |
| AWS KMS + Secrets Manager | Non-exportable encryption key, envelope encryption, scoped secret access, rotation, audit, and recovery |
| AWS SSM + IAM + CloudTrail | Named operator identity, short-lived access, approval trail, immutable audit logs, and break-glass procedure |
| S3 Terraform state | Encrypted, versioned, locked infrastructure state with backup and restricted access |
| Supabase Postgres | Managed Postgres, TLS, backups/PITR, migration history, least-privilege runtime roles, and restore tests |
| Supabase Auth | Google/Email transition login, PKCE, exact redirects, session revocation, rate limits, leaked-password controls, and Auth audit logs |
| Cloudflare DNS/proxy/WAF | Authoritative DNS, DDoS/WAF controls, origin shielding, certificate lifecycle, security headers, and change audit |
| Netlify Next.js runtime | Supported Node/Next.js runtime, server routes, middleware behavior, environment-secret isolation, atomic deploy, and rollback |
| GitHub Actions | Protected `main`, reviewed pull requests, pinned actions, CI, secret scanning, release provenance, and administrator audit |
| Personal incident access | At least two WEEX-controlled administrators, on-call ownership, MFA/SSO, and documented escalation |

## Required WEEX inputs before provisioning

WEEX must name or provide:

- technical owner, security owner, database owner, DNS owner, incident contact,
  and final change approver;
- target account/organization identifiers and two organization-controlled admin
  identities;
- target regions, data residency requirements, RPO, RTO, retention periods,
  SLA, maintenance windows, and log access rules;
- compute topology, fixed outbound IP, inbound proxy/WAF design, TLS ownership,
  secrets/KMS service, backup service, and monitoring service;
- approved source-code and sensitive-evidence transfer channels;
- the future production URL and exact OAuth callback/origin allow-list;
- whether Stage A account transfer is acceptable or all workloads must be
  re-platformed immediately.

Do not provision against a personal email, personal billing profile, shared
password, or long-lived administrator key.

## Execution order

### Phase 0 — review freeze and delivery

1. Freeze the review commit and record the full SHA.
2. Reconfirm `main` CI, history secret scan, license policy, and production
   deployment commit.
3. Generate the source archive, manifest, and SHA-256.
4. Perform a second-person check that the archive contains no prohibited
   material.
5. Deliver to WEEX and obtain written acknowledgement on 2026-08-04.

Exit gate: WEEX confirms receipt of the exact commit and returns a review
ticket/case identifier.

### Phase 1 — discovery and target design

1. Inventory every production resource, owner, biller, secret, callback, DNS
   record, certificate, backup, alert, and operator role in a private handover
   register.
2. Freeze infrastructure changes except reviewed security fixes.
3. Produce the WEEX target data-flow and trust-boundary diagram.
4. Map each current control to a WEEX equivalent and document any gap.
5. Agree RPO/RTO, rollback ownership, maintenance window, and acceptance
   evidence.

Exit gate: WEEX security and operations approve the target architecture and no
control is marked “owner unknown” or “replacement unknown.”

### Phase 2 — parallel non-production environment

1. Provision WEEX-owned development and staging identities first.
2. Deploy the application and infrastructure from reviewed source/IaC; do not
   copy personal administrator credentials.
3. Create new KMS/secrets keys in the WEEX boundary.
4. Restore a sanitized database backup and apply the canonical migration
   baseline.
5. Configure Auth callbacks, SMTP/provider ownership, DNS, TLS, WAF, logging,
   alerting, backups, and restore testing.
6. Run tests, lint, build, dependency audit, license checks, Gitleaks, RLS
   review, database advisors, and end-to-end smoke tests.

Exit gate: staging proves the same security invariants as production, including
no secret logging, no withdrawal path, fixed egress, Broker attribution, backup
restore, and emergency stop.

### Phase 3 — data, identity, and credential migration

1. Export and validate the Supabase schema/migration history separately from
   user data.
2. Decide whether Supabase is transferred to a WEEX organization or replaced by
   WEEX-managed Postgres/Auth.
3. If self-hosting Supabase, pin and test the selected release. Current
   self-hosted releases require explicit Postgres major-version planning and
   current Auth external-URL behavior; never assume a managed-project transfer
   procedure applies to self-hosting.
4. Migrate Auth identities only through a supported provider path. If session
   or identity semantics cannot be preserved safely, require users to sign in
   again rather than exporting password material.
5. Do not copy KMS ciphertext and assume it is portable. Prefer revoking and
   re-linking WEEX credentials under the new WEEX-owned key boundary. Any
   controlled re-encryption design requires a separate security review.
6. Rotate database passwords, Auth secrets, cookie/HMAC secrets, OAuth client
   secrets, CI secrets, and provider tokens after the target is verified.

Exit gate: data counts, ownership/RLS tests, Auth flows, audit records, restore,
and explicit credential revocation/re-link behavior pass.

### Phase 4 — executor and web cutover

1. Deploy the WEEX-owned Executor with live trading disabled.
2. Register and verify its fixed outbound IP wherever WEEX API allow-listing is
   used.
3. Validate KMS/secrets access, time synchronization, readiness, reconciliation,
   rate limits, and Broker ID order formatting.
4. Deploy the web control plane to the WEEX-owned runtime or WEEX-owned Netlify
   team.
5. Verify the current Google/Email plus manual API transition flow; keep WEEX
   OAuth unavailable until the separate OAuth approval gate passes.

Exit gate: authenticated staging and production smoke tests pass while all live
order gates remain disabled.

### Phase 5 — DNS and production cutover

1. Export Cloudflare DNS records and all proxy/WAF/TLS settings.
2. Pre-issue and validate certificates in the target.
3. Lower DNS TTL only for the approved migration window.
4. If moving between Cloudflare accounts, follow the provider transfer process,
   including DNSSEC/add-on review and certificate re-issuance. If Cloudflare is
   removed, validate equivalent DDoS/WAF/origin-shield controls before changing
   nameservers.
5. Pause writes, take the final backup, apply the delta, switch application
   endpoints, then change DNS.
6. Observe health, Auth, database, queue/order state, audit logs, error rates,
   and rollback signals for the agreed window.

Exit gate: WEEX operations signs off production availability, security
controls, data integrity, and rollback readiness.

### Phase 6 — revoke personal control and decommission

1. Confirm two WEEX administrators and break-glass recovery work without the
   original personal account.
2. Revoke all personal provider roles, tokens, SSH material, recovery emails,
   billing access, OAuth ownership, CI secrets, and signing access.
3. Keep the old environment read-only for the approved rollback period under
   WEEX control, not personal control.
4. Export required audit/billing records, then decommission old resources and
   record data/secret destruction evidence.
5. Update privacy, security, deployment, incident, and support documentation to
   name the new operator and data-processing boundaries.

Exit gate: no production or recovery operation depends on a personal account,
device, mailbox, payment method, or secret.

## Rollback rules

- Define rollback before each cutover; “repair forward” is not the only plan.
- Keep source and target schemas backward-compatible during the rollback
  window. Do not allow independent writes to both databases.
- DNS rollback alone is insufficient after new writes reach the target. Pair it
  with an explicit data rollback or forward-reconciliation procedure.
- Abort on unknown order state, credential leakage, RLS/auth mismatch, missing
  audit events, backup failure, certificate failure, fixed-egress mismatch, or
  Broker attribution failure.
- Reconcile all orders and positions in WEEX before resuming any automation.

## Responsibility model

| Activity | CryptoBot Labs during transition | WEEX |
| --- | --- | --- |
| Explain current code and controls | Responsible | Consulted |
| Security review and findings | Consulted | Accountable and responsible |
| Target architecture and hosting | Consulted | Accountable and responsible |
| Production credentials and provider ownership | No permanent ownership | Accountable and responsible |
| Migration execution | Supports reviewed runbook | Accountable and responsible |
| Cutover approval and rollback command | Consulted | Accountable |
| Post-cutover operations and incident response | Informed/advisory only | Accountable and responsible |

## Immediate schedule for 2026-08-04

1. **Now:** send WEEX the repository URL and frozen full commit SHA so the
   review can begin immediately.
2. **Within 30 minutes:** generate and independently inspect the source archive,
   manifest, and SHA-256.
3. **Within 60 minutes:** deliver the archive and evidence index through the
   approved WEEX channel.
4. **Before end of day:** obtain acknowledgement, reviewer/contact name, and
   review ticket; record any requested evidence without sending secrets.
5. **Next working session:** hold the infrastructure target-design meeting and
   complete the private ownership/resource inventory before changing any
   provider account.
