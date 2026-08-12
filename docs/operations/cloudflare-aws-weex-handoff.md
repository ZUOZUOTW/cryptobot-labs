# Cloudflare and AWS handoff to WEEX

This runbook transfers administrative control without exposing credentials or
breaking the fixed-IP/KMS safety boundary. Keep `LIVE_TRADING_ENABLED=false`
throughout the handoff. No step in this document authorizes a real order.

## Fastest supported path

Use the existing dedicated Cloudflare and AWS accounts as the handoff units:

1. Add and verify WEEX administrators while the current administrators retain
   time-boxed break-glass access.
2. Transfer billing, recovery, organization, and root/super-admin control.
3. Replace user-owned automation credentials with WEEX-controlled service
   identities, verify production, and then remove the outgoing identities.

This path preserves the Cloudflare zone ID, nameservers, edge configuration,
AWS account ID, Elastic IP, EC2 instance, KMS key, Secrets Manager ARN, IAM
instance profile, and Terraform state. It is materially safer than rebuilding
in new accounts because existing WEEX credential envelopes are bound to the
current AWS KMS key.

Choose a Cloudflare `zone-move` or AWS `resource-rebuild` only if either current
account contains assets that are not part of the handoff. Those paths are
separate migrations, not an ownership toggle.

## Current repository inventory

### Cloudflare

- `cryptobotlabs.app` is publicly delegated to Cloudflare. On 2026-08-12 the
  public delegation used two Cloudflare nameservers and published no DS record;
  recheck both facts immediately before a cutover.
- `api.cryptobotlabs.app` is Cloudflare-proxied to the AWS Executor. Direct
  origin traffic is intentionally blocked by the AWS security group.
- `www.cryptobotlabs.app` points to the Netlify site through Cloudflare. Netlify
  ownership is handled by its separate runbook.
- Terraform can manage only the proxied API `A` record, and management defaults
  to off. The rest of the zone, registrar, subscriptions, certificates, rules,
  and member policies are not represented in this repository.
- The checked-in 15-entry IPv4 allow-list matched Cloudflare's official list on
  2026-08-12. The online preflight compares it again before every handoff.
- No Worker, Pages, D1, R2, KV, Tunnel, or Turnstile resource is declared in
  repository IaC. Remote inventory is still mandatory because dashboard-only
  resources may exist.

### AWS

`infra/aws-executor` declares the production stack in `ap-northeast-1`:

- one Amazon Linux 2023 EC2 Executor in the default VPC/subnet;
- one associated Elastic IP used for WEEX egress allow-listing;
- an ingress security group that accepts HTTPS only from Cloudflare IPv4 proxy
  ranges and permits the required HTTPS/PostgreSQL egress;
- an EC2 instance role/profile with SSM and narrowly scoped KMS/Secrets Manager
  runtime permissions;
- a rotating symmetric KMS key and alias
  `alias/cryptobot-labs-production-weex` with `prevent_destroy`;
- the `cryptobot-labs/production/executor-runtime` Secrets Manager container,
  without any secret value in Terraform state;
- an encrypted, versioned account-specific S3 Terraform backend and the
  `CryptoBotLabsProvisioner` role;
- the account budget named `cryptobot-labs-production-monthly`.

The runtime secret has a closed key allow-list. Values that must be transferred
through an approved secret channel and normally rotated include
`EXECUTOR_HANDOFF_SECRET`, `SUPABASE_DATABASE_URL`, and any issued
`WEEX_CLIENT_SECRET`. `WEEX_CLIENT_ID` may also be confidential under the WEEX
agreement. Resource metadata such as `AWS_KMS_KEY_ID`, `EXPECTED_EGRESS_IP`,
`PUBLIC_ORIGIN`, `WEEX_BROKER_ID`, and `WEEX_OAUTH_REDIRECT_URI` is not secret,
but belongs in private deployment evidence rather than source control.

The currently configured local AWS caller can authenticate but cannot read the
required EC2, KMS, or S3 inventory. The local environment also has no Cloudflare
read token/account/zone binding and no Terraform executable. This is an
evidence-permission blocker, not proof that the resources are absent.

## Inputs WEEX must provide

Do not proceed with guessed identities. Record these in the private handoff
ticket, not in source control:

### Cloudflare identity

- two named WEEX administrators, each using a verified corporate email and 2FA
  or corporate SSO;
- the WEEX Cloudflare account ID only if a zone move is required;
- desired Cloudflare plan, billing entity/payment method, billing contact, and
  registrar/WHOIS organization/contact;
- whether WEEX accepts the existing Cloudflare account or requires the zone and
  Registrar registration in a separate account;
- a WEEX owner for DNS, edge certificates, WAF/rules, API tokens, and incident
  notifications.

### AWS identity

- the 12-digit WEEX AWS account ID used for temporary cross-account access or a
  resource rebuild;
- the WEEX AWS Organizations management account ID and organization ID, or an
  explicit decision to keep this account standalone;
- the exact WEEX administrator role principal and a WEEX-generated external ID
  for any temporary cross-account role;
- a WEEX-controlled root email distribution list, new root MFA devices, account
  name, corporate phone/address, payment/tax details, and support plan;
- WEEX billing, operations, and security distribution lists for AWS alternate
  contacts;
- the IAM Identity Center group/permission-set owners who will replace outgoing
  human access;
- approval to preserve the current Region and Elastic IP, or a WEEX-approved
  replacement IP plus confirmation that WEEX has updated its allow-list.

## Generate the private inventory

The repository check is safe to run anywhere and makes no cloud calls:

```bash
node scripts/check-cloudflare-aws-handoff.mjs --offline
```

For the formal read-only inventory, first grant the current operator the policy
in `infra/aws-executor/handoff-readonly-policy.json`. That policy intentionally
cannot read a Secrets Manager value, decrypt with KMS, create resources, or
change IAM. Create a Cloudflare read token scoped to this account/zone with at
least Zone Read, DNS Read, Zone Settings Read, SSL and Certificates Read,
Workers Routes Read, Rulesets Read, and Account Memberships Read. Registrar
metadata may require a user token because account-owned token compatibility is
not universal for Registrar.

Supply the token through a no-echo prompt and use an explicit source-account
fence:

```bash
export CBL_HANDOFF_AWS_ACCOUNT_ID="<SOURCE_AWS_ACCOUNT_ID>"
export CBL_HANDOFF_AWS_REGION="ap-northeast-1"
export CBL_HANDOFF_CLOUDFLARE_ACCOUNT_ID="<SOURCE_CF_ACCOUNT_ID>"
export CBL_HANDOFF_CLOUDFLARE_ZONE_ID="<SOURCE_CF_ZONE_ID>"
# Hash the two approved WEEX administrator emails locally; never place the raw
# addresses in the inventory or shell history.
export CBL_WEEX_CLOUDFLARE_ADMIN_SHA256S="<ADMIN_1_SHA256>,<ADMIN_2_SHA256>"
read -r -s CLOUDFLARE_API_TOKEN
export CLOUDFLARE_API_TOKEN
node scripts/check-cloudflare-aws-handoff.mjs --online --require-targets
unset CLOUDFLARE_API_TOKEN CBL_WEEX_CLOUDFLARE_ADMIN_SHA256S
```

Set `CBL_HANDOFF_AWS_MODE=resource-rebuild` and
`CBL_WEEX_AWS_ACCOUNT_ID` only for a rebuild. Set
`CBL_HANDOFF_CLOUDFLARE_MODE=zone-move` and
`CBL_WEEX_CLOUDFLARE_ACCOUNT_ID` only for a zone move.

The script never requests a secret value or emits credential content. It hashes
DNS record content and member identities, discards raw cloud CLI/API errors, and
writes `.handoff/cloudflare-aws-inventory.json` with mode `0600`. The entire
`.handoff` directory is gitignored. Transfer the inventory through the approved
encrypted evidence channel; do not attach it to a public issue or commit.

## Preferred Cloudflare account-control handoff

This keeps the account and zone in place and avoids nameserver, certificate, and
DNS recreation.

1. Export the DNS zone from Cloudflare and store the unmodified export only in
   the encrypted handoff vault. Record its SHA-256 in the handoff ticket. A zone
   export may contain verification records; never commit or paste it into chat.
2. Capture a metadata inventory of plans/subscriptions, registrar expiry and
   lock status, DNSSEC, edge certificates, SSL mode, minimum TLS, WAF/rulesets,
   redirects, cache configuration, Worker routes, account/zone members, audit
   logs, notifications, and account/user API tokens. The preflight automates the
   non-secret subset.
3. From a verified Super Administrator, invite both WEEX administrators as
   `Super Administrator - All Privileges`. Each WEEX administrator enables 2FA
   before accepting. Verify they can view billing, members, zone settings, DNS,
   certificates, and audit logs.
4. Change the billing profile/payment method and registrar/WHOIS contacts to the
   WEEX entity. A registrant contact change can create a transfer lock; this does
   not interrupt the same-account path but must be recorded.
5. WEEX creates least-privilege **account-owned** API tokens for durable DNS/IaC
   automation. Do not retain a token owned by a departing user and do not use a
   Global API Key. Update the private Terraform/CI secret binding without
   changing the zone ID.
6. Run the online preflight, public website/API probes, and a no-change
   Terraform plan. Confirm the API remains proxied and Full (strict) remains in
   effect.
7. Revoke old user/account tokens, remove the outgoing Super Administrator only
   after two WEEX administrators and the replacement automation token work, and
   export the final Cloudflare audit log.

Cloudflare recommends multiple Super Administrators. Never leave only one WEEX
recovery path.

## Cloudflare zone/Registrar move (only if required)

A cross-account zone move does **not** carry all settings or certificates. The
target account must recreate and validate them. Cloudflare's current process
requires DNSSEC/add-ons to be handled first, the domain to be added to the target
account, nameservers to change, and certificates to be reissued.

1. Obtain and independently verify the WEEX Cloudflare account ID. Confirm the
   target plan and billing method.
2. Export the source DNS zone and inventory every setting listed above. Add the
   zone to WEEX's account and import/review every record, including proxy flags,
   comments/tags, MX/TXT records, and CNAME flattening.
3. Recreate rulesets, redirects, WAF, cache, Worker routes, origin certificates,
   alerting, and account tokens. Do not assume a DNS export includes them.
4. Confirm DNSSEC is disabled at Cloudflare **and** the registrar DS record is
   absent. Remove any zone lock/add-on that blocks the move. The public DS check
   is authoritative; a dashboard screenshot alone is insufficient.
5. Pre-stage target edge certificates. Cloudflare generally recommends starting
   records DNS-only, but `api.cryptobotlabs.app` cannot serve users DNS-only
   because the AWS origin rejects non-Cloudflare ingress. Keep the old zone
   authoritative until the target edge certificate and proxied API record are
   ready; otherwise schedule a maintenance window.
6. For an external registrar, change authoritative nameservers to the target
   account's nameservers and recheck activation. For Cloudflare Registrar, use
   the inter-account move flow: the registration must be older than 10 days,
   the target zone/plan must exist, the registrant email must be verified, and
   the target must accept within five days. The move transfers WHOIS contact
   data but not other zone configuration and creates a 30-day transfer lock.
7. Wait for target zone `Active`, validate edge certificates, proxy status,
   website/API/Email DNS, then re-enable DNSSEC and publish the new DS through
   the registrar. Do not remove the old account access until the full validation
   and audit-log export pass.

Cloudflare marks the old zone `Moved Away`, then deletes it on its documented
schedule. Do not treat the old zone as a rollback after the move is accepted.

## Preferred AWS account-control handoff

This is the only path that preserves KMS-encrypted credential continuity without
a re-encryption/relink project.

1. Run the formal inventory with read-only permissions. Export the current
   Terraform state and plan to the encrypted handoff vault; record hashes only.
   Review the plan for zero deletes/replacements. Do not send the state file in
   email or commit it.
2. Create a temporary, time-bounded cross-account role for the exact WEEX AWS
   account/principal, requiring the WEEX-generated external ID and MFA where
   supported. Start read-only, then grant the minimum administration required
   for the supervised handoff. Never share an IAM user's access key or root
   credentials.
3. Verify WEEX can use temporary credentials to inspect EC2, EIP, security group,
   SSM, IAM roles, KMS metadata/rotation, Secrets Manager metadata (not value),
   S3 state controls, budget, CloudTrail, and the account's organization status.
4. Determine the organization state before changing billing:
   - If standalone, update account/root controls directly.
   - If a member of the outgoing organization, export billing history, complete
     standalone account registration/payment/support details, remove it from
     the old organization, remove old organization-access roles, and accept the
     WEEX organization invitation. Recheck quotas and agreements.
   - If it is the management account, it cannot join another organization. A
     dedicated empty organization must first export billing history, remove all
     member accounts, and be deleted; otherwise use AWS Support/legal review or
     the resource-rebuild path. Deleting an organization is irreversible.
5. In a supervised root session, the outgoing owner enters the current password
   and changes the root email to the WEEX-controlled distribution list. WEEX
   completes the email verification, sets a new root password through its own
   recovery channel, registers its root MFA devices, verifies sign-in, and then
   removes outgoing MFA. Never disclose the old password or copy MFA seeds.
6. Update the account name, primary contact, billing/operations/security
   alternate contacts, phone/address, payment/tax profile, Support plan, and
   budget subscribers. Use corporate distribution lists instead of individuals.
7. Assign WEEX human administrators through IAM Identity Center/federation with
   temporary credentials. Verify two independent administrators and a root
   break-glass procedure before deleting outgoing users/keys/sessions and the
   temporary handoff role.
8. WEEX replaces the runtime secret values through Secrets Manager without
   printing JSON in a shell command. Keep `WEEX_AUTH_STAGE=transition` and
   `LIVE_TRADING_ENABLED=false`. Restart through SSM and require `/healthz`,
   `/readyz`, fixed-egress, KMS, database-role, and credential-envelope checks.
9. Preserve the KMS key, alias, EIP, state bucket, IAM instance role, and Region.
   Confirm the fixed IP remains on the WEEX allow-list and the Cloudflare API
   record remains proxied. Export the final CloudTrail/IAM Access Analyzer and
   billing evidence, then remove outgoing access.

Changing the root email can take hours to propagate. Do not schedule the final
removal of outgoing recovery access in the same minute as the email change.

## AWS resource rebuild (only if the account cannot transfer)

EC2/IAM/KMS/Secrets Manager/S3 state cannot be transferred as one stack. Rebuild
from Terraform in the verified WEEX account with public ingress and Cloudflare
DNS management off, then install the signed release through SSM.

Critical constraints:

- A KMS key remains owned by its source account. Cross-account key policies can
  allow cryptographic use but cannot make WEEX the key administrator/owner. The
  existing database credential blobs contain encrypted data keys tied to the
  source KMS key. Before source retirement, either implement and verify a
  controlled rewrap migration or require every affected connection to revoke
  and relink under the new key. Never schedule the old key for deletion while
  any blob references it.
- Recreate the Secrets Manager container and enter freshly rotated values through
  an approved secret channel. Do not copy a secret into Terraform variables,
  state, shell history, logs, or the evidence report.
- Recreate EC2, IAM, SSM, security groups, volumes, budget, trails, and the S3
  backend. Use a new target-account backend; do not let two states control one
  resource.
- AWS supports same-Region Elastic IP transfer with a source/target handshake.
  WEEX must supply its 12-digit target account, accept within seven days, and
  recreate tags. Coordinate disassociation/association in a maintenance window.
  Keeping the EIP avoids a WEEX allow-list change; otherwise WEEX must approve a
  new outgoing IP before traffic moves.
- Keep the Cloudflare API record pointed at the old origin until the target
  Executor passes private and public readiness. Move DNS/EIP once, reconcile all
  callbacks, then destroy nothing in the source account until the evidence and
  credential migration are complete.

## Final acceptance gates

- [ ] Offline and online preflight report `READY`; any warning has a named owner.
- [ ] WEEX has two working Cloudflare Super Administrators and two independent
      AWS administrative/recovery paths.
- [ ] Root/super-admin email, MFA, billing, legal contacts, tax/payment, support,
      notifications, and budget subscribers belong to WEEX.
- [ ] Cloudflare zone/account ID, DNS metadata hashes, settings, rules, registrar,
      certificates, members, tokens, and audit logs match the approved inventory.
- [ ] AWS account/organization, Region, EC2, EIP, SG, SSM, IAM, KMS rotation,
      Secrets Manager metadata, Terraform backend, budget, CloudTrail, and Access
      Analyzer match the approved inventory.
- [ ] Website, `/healthz`, `/readyz`, OAuth callback origin, Full (strict) TLS,
      fixed egress, database readiness, and no-change Terraform plan pass.
- [ ] Replacement automation credentials work; all outgoing tokens, IAM users,
      access keys, sessions, roles, and account memberships are revoked.
- [ ] `LIVE_TRADING_ENABLED=false` and `WEEX_AUTH_STAGE=transition` remain proven.
- [ ] Both parties sign the timestamped evidence manifest and incident/rollback
      contacts; no evidence package contains a secret value.

## Official references verified 2026-08-12

- Cloudflare: [members and Super Administrators](https://developers.cloudflare.com/fundamentals/manage-members/manage/),
  [account-owned API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/),
  [move a zone between accounts](https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/),
  [Registrar inter-account move](https://developers.cloudflare.com/registrar/account-options/inter-account-transfer/),
  [DNS import/export](https://developers.cloudflare.com/dns/manage-dns-records/how-to/import-and-export/), and
  [minimize downtime](https://developers.cloudflare.com/fundamentals/performance/minimize-downtime/).
- AWS: [update root email](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-update-root-user-email.html),
  [update primary contact](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-update-contact-primary.html),
  [update alternate contacts](https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-update-contact-alternate.html),
  [remove a member account](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_remove.html),
  [invite an account](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_accounts_invites.html),
  [cross-account roles](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_common-scenarios_third-party.html),
  [cross-account KMS use](https://docs.aws.amazon.com/kms/latest/developerguide/key-policy-modifying-external-accounts.html), and
  [Elastic IP transfer](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/transfer-EIPs-intro-ec2.html).
