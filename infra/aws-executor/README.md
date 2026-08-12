# Production executor infrastructure

This Terraform stack provisions an EC2 executor with an Elastic IP, an instance role, a rotating symmetric AWS KMS key, and a Secrets Manager container. It deliberately does not place any secret value in Terraform state.

The first production bootstrap uses the currently authenticated AWS console session to create a project-specific `CryptoBotLabsProvisioner` role and the encrypted, versioned S3 state bucket. AWS does not allow a root principal to assume an IAM role, so a root-authenticated CloudShell performs this one-time plan, apply, and verification directly. Future non-root operators use one-hour STS sessions for the project role. No long-lived AWS access key is created.

CloudShell's persistent home volume is intentionally small, so Terraform provider binaries are kept in `/tmp/cryptobot-labs-terraform-data`; Terraform state itself remains in the protected S3 backend.

The public stack deliberately contains no concrete production account ID, instance ID, state bucket,
reserved egress IP, Cloudflare zone ID, Supabase project host, or deploy ID. Those values stay in private
deployment evidence. The checked-in examples use reserved placeholders and require the operator to supply
the target account explicitly.

1. In AWS CloudShell export `CBL_AWS_ACCOUNT_ID` with the 12-digit target account. Optionally set
   `CBL_AWS_REGION` and `CBL_TERRAFORM_STATE_BUCKET`, then run `bootstrap/bootstrap-cloudshell.sh` and
   review `production-plan.txt`.
2. Run `bootstrap/apply-cloudshell.sh` only after the plan contains the expected additions and no deletes.
3. Run `bootstrap/verify-cloudshell.sh`; the instance must be running, IMDSv2 required, KMS rotation enabled, and the security group must have no ingress during the base phase.
4. Put runtime values directly into the created Secrets Manager secret. `WEEX_BROKER_ID` is required runtime metadata, while API keys, OAuth client credentials, database credentials, and handoff secrets remain secrets. Never put secret values in `.tfvars`, Terraform resources, user-data, or source control.
5. Build `scripts/build-executor-release.sh`, verify `release/executor/main.js.sha256`, and install the release through SSM Session Manager; do not open SSH. The service reads `AWSCURRENT` directly from Secrets Manager through its instance role, so no plaintext secret file is written to disk.
6. Configure and verify origin TLS on port 443. Before restricting origin ingress, enable Cloudflare proxying for the API A record and set the zone SSL mode to Full (strict). The production DNS record remains managed outside this Terraform state (`manage_cloudflare_dns=false`) unless it is explicitly imported; if Terraform manages it, the record is always proxied with automatic TTL.
7. Verify the proxied `/healthz` and `/readyz` responses, then set `enable_public_https=true`. Terraform replaces public `0.0.0.0/0` ingress with one TCP/443 rule per official Cloudflare IPv4 proxy range. Direct requests to the historical origin IP must then fail.
8. Before restarting the service, run `pnpm db:preflight:executor` from the
   reviewed release workspace with the same Secrets Manager database binding.
   Terminate deployment if it cannot prove the exact NOBYPASSRLS
   `cryptobot_executor` identity, canonical target index/trigger, or stop-fence
   function. Then terminate deployment if the private executor journal cannot
   prove the expected egress IP, KMS adapter, database, and cloud-runtime
   readiness. Public probes intentionally expose only aggregate `ok`, `ready`,
   or `not-ready` status.

The security group permits outbound HTTPS plus TCP 5432 for the Supabase IPv4 Session Pooler. The database runtime role and TLS-required connection string remain the authorization boundary; no inbound database traffic is opened.

The SSM data source intentionally follows the latest Amazon Linux 2023 image for visibility, but routine plans ignore AMI drift and the executor has `prevent_destroy`. An AMI upgrade therefore requires a reviewed maintenance change that explicitly adjusts the lifecycle guard and replaces the instance during a planned window; it cannot silently replace production during an unrelated apply.

The executor uses the official pinned AWS KMS and Secrets Manager SDKs. It refuses readiness unless KMS, fixed egress, exact low-privilege PostgreSQL identity, the current target-exclusivity and stop-fence schema, and the credential-envelope adapter validate. Missing WEEX OAuth credentials keep `/oauth/weex/start` disabled with HTTP 503. Public probes do not expose feature flags, revisions, worker state, cache state, counts, or rate-limit data; those diagnostics remain in the private system journal.

Before every infrastructure apply, compare `cloudflare_ipv4_cidrs` with Cloudflare's official `https://www.cloudflare.com/ips-v4` list. Cloudflare publishes additions before using them. A mismatch can either expose the origin or block a subset of Cloudflare edge traffic.

The release includes a hardened systemd unit and Caddy origin configuration under `runtime/`. Caddy access logging is intentionally not enabled because OAuth callback URLs contain short-lived authorization codes and state values. Journal output must also remain metadata-only and never include request headers, query strings, token bodies, or credential payloads.

Amazon Linux 2023 does not have a compatible Caddy COPR target. Install the pinned official Caddy static binary only after checking its SHA-256 against the matching GitHub release checksum file; the release supplies the hardened `caddy.service` unit.
