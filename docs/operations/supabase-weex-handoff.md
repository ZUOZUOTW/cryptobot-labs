# Supabase to WEEX handoff

This runbook transfers the existing Supabase project between organizations.
Supabase organization transfer moves the **entire project**, not selected
schemas, rows, buckets, or functions. The remote project contains OmniTrade,
Nexus, CryptoHunter, and CryptoBot Labs database assets and Edge Functions.
It does not change region or authorize a live-trading cutover. Keep
`LIVE_TRADING_ENABLED=false` until the separate WEEX execution acceptance gates
are complete.

## Current closeout status

- The repository preserves 22 confirmed production migration versions and 3
  reviewed pending versions in
  `supabase/production-migration-baseline.json`.
- The pending versions are `20260812061404`, `20260812072739`, and
  `20260812090000`, in that order.
- An authorized read-only remote inventory on 2026-08-12 found that production
  contains the repository's 22 applied versions followed by **19 additional
  migrations from other products**, dated from 2026-07-29 through 2026-08-11.
  Their canonical SQL is absent from this repository. The three pending
  CryptoBot Labs versions are confirmed absent remotely.
- The catalog objects expected from the three pending migrations are also
  absent, as expected before rollout. Security Advisor contains a separate
  Nexus-owned warning; it is cross-product evidence that must be assigned and
  reviewed, not silently treated as a CryptoBot Labs migration result.
- The 19-version remote-only gap is a **P0 transfer and deployment blocker**.
  Do not run `db push`, `migration repair`, or claim an exact 22-version match.
  First restore and review the canonical 19 entries and their SQL, or adopt a
  formally approved isolated deployment chain containing the complete remote
  history.
- The shared-project scope is a separate **P0 transfer blocker**. Obtain signed
  acceptance from every source product owner and WEEX for the whole-project
  scope, or complete a source-owner/WEEX-approved project split and validate
  both sides before transfer. A Supabase transfer dialog cannot split assets.
- This local workspace still has no linked project ref, Supabase access token,
  production database URL, Docker runtime, or `psql`, so it cannot independently
  repeat the connector inventory or certify backups, Auth configuration,
  organization membership, or transfer prerequisites.
- Supabase CLI `2.113.0` was the reviewed current release on 2026-08-12. Pin
  that version for this handoff and re-review the changelog before changing it.
- The 2026 breaking changes relevant here are already reflected locally: no
  migration pins an extension version, frontend Auth uses a publishable key,
  and control-plane grants do not depend on automatic Data API exposure.

Run the repository-only, secret-safe integrity check at any time. It does not
certify handoff readiness:

```sh
pnpm handoff:supabase:repository
```

Calling `check-supabase-handoff.mjs` without `--repository-only` or external
`--evidence` fails closed by design.

## Inputs WEEX must provide

Do not send any of these through issues, pull requests, chat, or committed
files. Store identifiers in the private transfer record and secrets in the
destination secret manager.

1. The exact WEEX Supabase target organization ID/slug and target billing plan.
2. The named WEEX organization Owner's accepted Supabase account email, plus a
   separate database deployer and break-glass Owner.
3. The source organization Owner who will initiate the transfer. A Supabase
   Administrator cannot transfer a project outside an organization.
4. Written acceptance that a project transfer cannot change regions, and that
   the target plan retains the required compute, PITR/backup retention, IPv4,
   custom-domain, Advanced MFA, and other add-ons.
5. A maintenance window, technical approver, rollback owner, evidence location,
   and the timestamp after which source access may be removed.
6. Fingerprinted approval from the current owners of OmniTrade, Nexus,
   CryptoHunter, and CryptoBot Labs, plus WEEX, accepting that their shared
   database assets, Auth/Storage/Realtime configuration, and Edge Functions all
   move with the project. If any party does not accept, provide an approved
   project-split plan, owner, destination, maintenance window, and validation
   manifest instead.

The person initiating the transfer must be an Owner of the source organization
and already be a member of the WEEX target organization. If SAML SSO is in use,
the invitation must be accepted through the same configured identity provider.

## Stop conditions

Stop and escalate instead of using `migration repair`, `--include-all`, a
Dashboard schema edit, or an applied-migration edit when any condition is true:

- Any plan assumes production contains only this repository's 22 applied
  versions. It does not: 19 later remote-only versions are known to exist.
- All 19 remote-only entries have not been recovered with exact timestamp,
  name, canonical SQL, normalized SHA-256, owning product, and reviewer, or an
  approved complete-history isolation strategy has not been evidenced.
- A proposed deployment directory cannot reproduce the full 41-version remote
  history before the three pending CryptoBot Labs versions.
- A pending timestamp already exists remotely without reviewable evidence that
  the SQL matches this repository.
- The dry run contains anything other than the three pending versions in order.
- A database advisor introduces an unreviewed security finding.
- The known Nexus-owned Security Advisor warning has no named owner, triage
  record, or explicit disposition.
- OmniTrade, Nexus, CryptoHunter, or CryptoBot Labs assets/Edge Functions have
  not been inventoried and assigned to a source product owner.
- Every source product owner and WEEX have not accepted the whole-project scope,
  and a separately approved project split has not completed validation.
- A split would delete, disable, rotate, or transfer a source product asset
  before its owner accepts and its retained/migrated copy passes smoke tests.
- A backup/restore point cannot be identified and its recovery procedure has
  not been reviewed.
- The target plan, region, billing owner, WEEX Owner, or maintenance window is
  not confirmed.
- GitHub integration, a project-scoped role, or a log drain still points to the
  project when the transfer is initiated.

## Phase 1: freeze and capture recovery evidence

1. Freeze schema changes and deployments. Keep Demo and Live execution
   fail-closed and record the application release SHA.
2. In Supabase Dashboard, record project ref, source organization, region,
   plan, compute/disk, backup retention/PITR, IPv4, custom domain, network
   restrictions, read replicas, log drains, and current billing add-ons.
3. Record a restorable pre-change backup or PITR timestamp. For an independent
   logical recovery artifact, follow Supabase's CLI backup guide to dump roles,
   schema, and data to encrypted storage outside the repository. Record only an
   artifact SHA-256 and restore owner in the handoff evidence.
4. Inventory Storage buckets/objects, Edge Functions and their secret names,
   Realtime publications, database extensions, cron/webhook jobs, Vault usage,
   Auth providers, Site URL, redirect allow-list, SMTP/templates, CAPTCHA, and
   custom domains. Tag every asset to OmniTrade, Nexus, CryptoHunter,
   CryptoBot Labs, or reviewed shared infrastructure. Record names and
   fingerprints, never secret values.
5. Confirm the recovery owner can access the backup and has reviewed the
   restore procedure. A backup that has never been located or assigned is not
   rollback evidence.

### Shared-project scope decision

Choose exactly one path before transfer:

1. **Accept whole-project transfer:** all source product owners and WEEX sign
   the fingerprinted scope inventory. WEEX assumes operation, billing, data
   protection, retention, secrets, Edge Functions, and incident response for
   every listed product asset—not only CryptoBot Labs.
2. **Split before transfer:** owners approve which project remains and which
   assets move. Clone or migrate data, Auth dependencies, Storage objects,
   Realtime publications, Edge Functions, schedules/webhooks, Vault references,
   and consumer configuration into the approved destination. Use forward-only
   schema changes; do not delete source assets during validation. Test each
   product independently, reconcile object counts and hashes, rotate consumers,
   and preserve rollback until all owners sign the split manifest. If the
   original project is transferred afterward, its complete 41-version history
   still requires reconciliation.

Set `SUPABASE_PROJECT_SPLIT_MANIFEST_SHA256` from the independent approval
record when validating the split path. Never derive this fence from the
evidence file being checked.

## Phase 2: close the migration gate

Use a WEEX-approved workstation. Generate a temporary personal access token
from the operator's own Supabase account and inject it from a password manager.
Personal access tokens are user-scoped and must never be transferred to WEEX.
Do not pass the database password on a command line.

The following commands are read-only inventory steps using the pinned CLI
without adding it to the repository:

```sh
pnpm dlx supabase@2.113.0 --version
pnpm dlx supabase@2.113.0 link --project-ref "$SUPABASE_PROJECT_REF"
pnpm dlx supabase@2.113.0 migration list --linked
pnpm dlx supabase@2.113.0 db advisors --linked --type security --level info --fail-on error
pnpm dlx supabase@2.113.0 db advisors --linked --type performance --level info --fail-on error
```

Capture redacted outputs in the private evidence location. Production is known
to contain 41 versions before this rollout: 22 in this repository plus 19
remote-only versions. An exact 22-version result is not a safe precondition.

Before any dry run or push, choose and approve one reconciliation strategy:

1. **Canonical restore:** retrieve the exact 19 remote migration entries and
   SQL from the product teams or authoritative remote evidence. Preserve their
   recorded timestamps and names, compute normalized SQL hashes, review every
   statement, and restore them to the canonical deployment chain. Never invent
   placeholder SQL for a timestamp that production says is applied.
2. **Reviewed isolation:** prohibit this repository from linking or pushing to
   production. Use a separately owned deployment repository/directory that
   contains and reviews the complete 41-version production chain before adding
   the three CryptoBot Labs versions. Record its manifest hash, owner, and
   approval in the transfer evidence.

`supabase db pull` can capture current schema state but cannot reconstruct the
19 canonical migration entries or prove their original SQL. It is not by itself
a reconciliation. `migration repair` changes history metadata and is forbidden
for concealing this gap.

Only after one strategy is fully evidenced may the database deployer run a dry
run. It must preserve all 41 existing versions and append exactly the three
pending versions. Run these commands only from the reviewed complete-chain
working directory; the current repository in its present 22-plus-3 state is
prohibited from pushing:

```sh
pnpm dlx supabase@2.113.0 db push --linked --dry-run
pnpm dlx supabase@2.113.0 db push --linked
pnpm dlx supabase@2.113.0 migration list --linked
node scripts/check-production-database-readiness.mjs website
node scripts/check-production-database-readiness.mjs executor
```

The website and Executor readiness commands must each receive their own TLS
Session Pooler URL through `SUPABASE_DATABASE_URL`; do not use `postgres`,
`service_role`, or one runtime role for both checks. After remote confirmation,
verify the required referral, discovery-projection, and cloud-run exclusivity
catalog objects. The post-push history must contain 44 versions: the original
22, the reviewed 19 remote-only versions, then the 3 pending versions.

If this repository becomes the canonical complete chain, add the reviewed 19
remote entries before promoting the three pending entries to `migrations`,
update `capturedAt`, and rerun baseline tests. Under reviewed isolation, keep
this repository's pending status explicit and record the authoritative
deployment manifest instead of falsely declaring a complete local history.
Database rollback is forward-only: roll the application back or add a later
CLI-generated corrective migration. Do not mutate history to hide a failed
deployment.

## Phase 3: prepare identities and credentials

1. Invite the transfer operator to the WEEX organization and verify membership
   acceptance. Name at least one WEEX organization Owner before cutover.
2. Inventory API keys by type, name, scope, consumer, and SHA-256 fingerprint.
   Publishable keys may be public, but do not put raw keys in handoff evidence.
   Never share a `sb_secret_...`, legacy `service_role`, database password, or
   personal access token.
3. WEEX creates its own personal access tokens and separate secret API keys for
   each backend that genuinely needs one. New secret keys coexist with old
   keys; deploy and verify replacements before deleting the previous keys.
   This application currently uses dedicated Postgres runtime roles rather than
   a Supabase secret/service-role key for its website and Executor.
4. Approve a rotation plan for the Supabase database password,
   `cryptobot_netlify` password, `cryptobot_executor` password, Auth cookie
   secret, Google OAuth client secret, SMTP credential, webhook signing
   secrets, and any Edge Function secrets. Rotate consumers one at a time and
   verify health before revocation. Never rotate credentials merely to make the
   ownership transfer button available.
5. Disconnect the project's GitHub integration, remove project-scoped role
   assignments pointing to the project, and remove log drains. Preserve their
   reviewed configurations so WEEX can recreate them after transfer.

## Phase 4: transfer and verify

1. Reconfirm the target organization in the Supabase General Settings transfer
   dialog. A transfer is an external ownership/billing mutation and requires
   the named source Owner and WEEX approver to review the exact target together.
2. Initiate the transfer once. Supabase notes a possible one-to-two-minute
   downtime when moving from a paid plan to Free; this project must not be
   downgraded during handoff.
3. Have the WEEX Owner verify project access, plan/add-ons, billing, backup/PITR,
   region, database health, Auth settings, API key inventory, Storage, Edge
   Functions, Realtime, network restrictions, and custom domains.
4. Recreate GitHub integration and log drains under WEEX-controlled identities,
   then run Google sign-in/sign-out, website database readiness, Executor
   readiness, an authenticated publication-to-Explore smoke, and secret-safe
   log review. Keep Live trading disabled.
5. Create WEEX-owned PATs and deploy approved credential rotations. Revoke the
   source operator's PAT after evidence is captured.
6. Remove or downgrade source members only after WEEX signs acceptance and the
   rollback period expires. Supabase requires every organization to retain at
   least one Owner.

## Fingerprint-only acceptance evidence

Create the JSON below outside the repository. Hash identifiers and owner emails
instead of recording raw values. All booleans must be supported by private
screenshots, audit-log records, or redacted command outputs.

```json
{
  "schemaVersion": 1,
  "identifiers": {
    "projectRefSha256": "<64 lowercase hex>",
    "sourceOrganizationIdSha256": "<64 lowercase hex>",
    "targetOrganizationIdSha256": "<64 lowercase hex>",
    "weexOwnerEmailSha256": "<64 lowercase hex>"
  },
  "identity": {
    "sourceOrganizationOwnerVerified": false,
    "targetOrganizationMembershipAccepted": false,
    "weexOrganizationOwnerNamed": false
  },
  "commercial": {
    "targetPlanAndBillingVerified": false,
    "sameRegionAccepted": false
  },
  "transfer": {
    "githubIntegrationDisconnected": false,
    "projectScopedRolesCleared": false,
    "logDrainsCleared": false
  },
  "backup": {
    "restorePointRecorded": false,
    "restoreProcedureReviewed": false,
    "artifactSha256": "<64 lowercase hex>"
  },
  "scope": {
    "sharedProjectInventoryCaptured": false,
    "sharedProjectInventorySha256": "<64 lowercase hex>",
    "sharedProjectScopeAccepted": false,
    "sourceProductOwnersApproved": false,
    "weexSharedProjectScopeAccepted": false,
    "sourceProductOwnerApprovalsSha256": "<64 lowercase hex>",
    "weexSharedProjectAcceptanceSha256": "<64 lowercase hex>",
    "projectSplitCompleted": false,
    "projectSplitValidationPassed": false,
    "projectSplitApprovedBySourceOwners": false,
    "projectSplitApprovedByWeex": false,
    "projectSplitManifestSha256": "<64 lowercase hex or empty when unused>",
    "sharedProducts": [
      "CryptoBot Labs",
      "CryptoHunter",
      "Nexus",
      "OmniTrade"
    ],
    "sharedAssetClasses": [
      "auth",
      "database-assets",
      "edge-functions",
      "realtime",
      "storage"
    ]
  },
  "database": {
    "remoteHistoryInventoryCaptured": false,
    "knownRemoteDriftAcknowledged": false,
    "externalCanonicalSqlReviewed": false,
    "migrationChainReconciled": false,
    "dryRunReviewed": false,
    "pendingMigrationsApplied": false,
    "fullRemoteHistoryVerifiedAfterPush": false,
    "catalogObjectsVerifiedAfterPush": false,
    "websiteReadinessPassed": false,
    "executorReadinessPassed": false,
    "securityAdvisorsReviewed": false,
    "performanceAdvisorsReviewed": false,
    "crossProductAdvisorFindingAssigned": false,
    "externalCanonicalManifestSha256": "<64 lowercase hex>",
    "migrationChainStrategy": "canonical-restore or reviewed-isolation",
    "externalCanonicalMigrations": [],
    "beforePushVersions": [],
    "dryRunVersions": [],
    "afterPushVersions": []
  },
  "auth": {
    "siteUrlVerified": false,
    "redirectAllowlistVerified": false,
    "providersVerified": false,
    "smtpAndTemplatesVerified": false
  },
  "credentials": {
    "publishableKeyInventoryRecorded": false,
    "secretKeyRotationPlanApproved": false,
    "databaseRoleRotationPlanApproved": false
  },
  "operations": {
    "liveTradingDisabled": false,
    "maintenanceWindowApproved": false,
    "rollbackOwnerNamed": false
  },
  "cutover": {
    "weexOwnerAccessVerified": false,
    "projectHealthVerified": false,
    "authSmokePassed": false,
    "websiteDatabaseSmokePassed": false,
    "executorDatabaseSmokePassed": false,
    "weexPersonalAccessTokenCreated": false,
    "providerSecretsRehomed": false,
    "sourceAccessRemovalApproved": false
  }
}
```

`externalCanonicalMigrations` must contain exactly 19 objects with `version`,
`name`, and `normalizedSha256`. `beforePushVersions` must contain the 22 local
applied versions followed by those 19 reviewed versions; `dryRunVersions` must
contain only the 3 pending versions; `afterPushVersions` must contain all 44 in
order. A list of timestamps without canonical SQL hashes does not close the P0
blocker.

The validator recomputes `externalCanonicalManifestSha256` from the ordered
canonical JSON projection of each entry's `version`, `name`, and
`normalizedSha256`. Obtain the independently reviewed expected hash from a
separate approval channel and inject it as
`SUPABASE_EXTERNAL_MIGRATION_MANIFEST_SHA256`; never copy the value from the
evidence under review. Without this fence, formal preflight cannot become
ready even if an arbitrary 19-entry list is internally well formed.

Validate it before and after transfer:

```sh
export SUPABASE_EXTERNAL_MIGRATION_MANIFEST_SHA256="<independently approved hash>"
node scripts/check-supabase-handoff.mjs --evidence /secure/path/evidence.json --stage pre-transfer
node scripts/check-supabase-handoff.mjs --evidence /secure/path/evidence.json --stage post-transfer
```

The validator never prints evidence values. It reports only missing checkpoint
paths, exact migration-history mismatches, or detection of secret-shaped data.

## Official references reviewed

- [Supabase Project Transfers](https://supabase.com/docs/guides/platform/project-transfer)
- [Supabase Access Control](https://supabase.com/docs/guides/platform/access-control)
- [Supabase Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase CLI Backup/Restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase API Keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase 2026 breaking-change changelog](https://supabase.com/changelog?types=breaking-change)
