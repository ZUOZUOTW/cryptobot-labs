#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DOMAIN = "cryptobotlabs.app";
const DEFAULT_REGION = "ap-northeast-1";
const DEFAULT_OUTPUT = resolve(ROOT, ".handoff/cloudflare-aws-inventory.json");

function usage() {
  return `Usage: node scripts/check-cloudflare-aws-handoff.mjs [--offline|--online] [--require-targets] [--output .handoff/file.json] [--no-write]

Offline mode validates the repository handoff controls and performs no cloud API calls.
Online mode adds read-only public DNS, Cloudflare API, and AWS CLI inventory.

Online source environment:
  CBL_HANDOFF_AWS_ACCOUNT_ID          expected 12-digit source AWS account
  CBL_HANDOFF_AWS_REGION              source region (default: ap-northeast-1)
  CBL_HANDOFF_CLOUDFLARE_ACCOUNT_ID   expected 32-hex source Cloudflare account
  CBL_HANDOFF_CLOUDFLARE_ZONE_ID      expected 32-hex source zone
  CLOUDFLARE_API_TOKEN                read-only token; never written to output

Optional decision/target environment:
  CBL_HANDOFF_AWS_MODE                account-ownership (default) or resource-rebuild
  CBL_HANDOFF_CLOUDFLARE_MODE         membership (default) or zone-move
  CBL_WEEX_AWS_ACCOUNT_ID             WEEX 12-digit AWS account (resource-rebuild)
  CBL_WEEX_CLOUDFLARE_ACCOUNT_ID      WEEX 32-hex Cloudflare account (zone-move)
  CBL_WEEX_CLOUDFLARE_ADMIN_SHA256S   two comma-separated WEEX admin email SHA-256 values (membership)
`;
}

function parseArguments(argv) {
  const options = { online: false, requireTargets: false, output: DEFAULT_OUTPUT, write: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--offline") options.online = false;
    else if (argument === "--online") options.online = true;
    else if (argument === "--require-targets") options.requireTargets = true;
    else if (argument === "--no-write") options.write = false;
    else if (argument === "--help" || argument === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (argument === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output requires a path");
      options.output = isAbsolute(value) ? resolve(value) : resolve(ROOT, value);
      index += 1;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  const privateRoot = resolve(ROOT, ".handoff");
  const outputRelative = relative(privateRoot, options.output);
  if (outputRelative.startsWith("..") || isAbsolute(outputRelative)) {
    throw new Error("Inventory output must stay inside the ignored .handoff directory");
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

export function exactSet(left, right) {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function normalizedDnsContent(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\.$/u, "");
}

function parseIpv4(value) {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((total, part) => ((total << 8) | part) >>> 0, 0);
}

function inCidr(address, cidr) {
  const [networkValue, prefixValue] = cidr.split("/");
  const addressNumber = parseIpv4(address);
  const networkNumber = parseIpv4(networkValue);
  const prefix = Number(prefixValue);
  if (addressNumber === null || networkNumber === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (addressNumber & mask) === (networkNumber & mask);
}

function commandAvailable(command) {
  return spawnSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] }).status === 0;
}

function runAws(arguments_) {
  const result = spawnSync("aws", [...arguments_, "--output", "json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AWS_PAGER: "" },
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) return { ok: false, status: result.status ?? 1 };
  try {
    return { ok: true, value: JSON.parse(result.stdout || "null") };
  } catch {
    return { ok: false, status: 1 };
  }
}

function runAwsOrganization() {
  const result = spawnSync("aws", ["organizations", "describe-organization", "--output", "json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, AWS_PAGER: "" },
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    return /AWSOrganizationsNotInUseException/u.test(result.stderr ?? "")
      ? { ok: true, value: { standalone: true } }
      : { ok: false, status: result.status ?? 1 };
  }
  try {
    return { ok: true, value: JSON.parse(result.stdout || "null") };
  } catch {
    return { ok: false, status: 1 };
  }
}

async function resolveSafe(name, type) {
  try {
    const values = await dns.resolve(name, type);
    return Array.isArray(values) ? values : [];
  } catch {
    return [];
  }
}

async function fetchJson(url, token) {
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    const payload = await response.json();
    if (!payload?.success) return { ok: false, status: response.status };
    return { ok: true, value: payload.result, info: payload.result_info ?? null };
  } catch {
    return { ok: false, status: response.status };
  }
}

async function fetchCloudflarePages(path, token) {
  const values = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await fetchJson(`https://api.cloudflare.com/client/v4${path}${separator}page=${page}&per_page=100`, token);
    if (!response.ok) return response;
    values.push(...(Array.isArray(response.value) ? response.value : []));
    const totalPages = Number(response.info?.total_pages ?? 1);
    if (page >= totalPages) return { ok: true, value: values };
  }
  return { ok: false, status: 0 };
}

async function publicProbe(url) {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json,text/html;q=0.8,*/*;q=0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel();
    return { reachable: true, status: response.status };
  } catch {
    return { reachable: false, status: null };
  }
}

function addCheck(report, id, status, detail, severity = "blocker") {
  report.checks.push({ id, status, severity, detail });
  if (status === "blocked" && severity === "blocker") report.blockers.push(id);
  if (status === "warning") report.warnings.push(id);
}

async function repositoryInventory(report) {
  const [main, variables, versions, outputs, runtimeSecrets, service, gitignore] = await Promise.all([
    readFile(resolve(ROOT, "infra/aws-executor/main.tf"), "utf8"),
    readFile(resolve(ROOT, "infra/aws-executor/variables.tf"), "utf8"),
    readFile(resolve(ROOT, "infra/aws-executor/versions.tf"), "utf8"),
    readFile(resolve(ROOT, "infra/aws-executor/outputs.tf"), "utf8"),
    readFile(resolve(ROOT, "apps/executor/src/runtime-secrets.ts"), "utf8"),
    readFile(resolve(ROOT, "infra/aws-executor/runtime/cryptobot-executor.service"), "utf8"),
    readFile(resolve(ROOT, ".gitignore"), "utf8"),
  ]);

  const terraformResources = [...main.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)]
    .map((match) => `${match[1]}.${match[2]}`);
  const expectedResources = [
    "aws_eip.executor",
    "aws_iam_instance_profile.executor",
    "aws_iam_role.executor",
    "aws_instance.executor",
    "aws_kms_alias.credentials",
    "aws_kms_key.credentials",
    "aws_secretsmanager_secret.executor_runtime",
    "aws_security_group.executor",
    "cloudflare_dns_record.api",
  ];
  const cidrBlock = variables.match(/variable\s+"cloudflare_ipv4_cidrs"[\s\S]*?default\s*=\s*\[([\s\S]*?)\n\s*\]/)?.[1] ?? "";
  const cloudflareCidrs = [...cidrBlock.matchAll(/"([0-9.]+\/\d+)"/g)].map((match) => match[1]);
  const allowedBlock = runtimeSecrets.match(/const ALLOWED = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  const runtimeSecretKeys = [...allowedBlock.matchAll(/"([A-Z][A-Z0-9_]+)"/g)].map((match) => match[1]).sort();
  const concreteAccountIds = [...`${main}\n${variables}\n${versions}\n${outputs}`.matchAll(/\b\d{12}\b/g)]
    .map((match) => match[0]).filter((value) => value !== "000000000000");
  const providerVersions = Object.fromEntries(
    [...versions.matchAll(/(aws|cloudflare)\s*=\s*\{[\s\S]*?version\s*=\s*"([^"]+)"/g)]
      .map((match) => [match[1], match[2]]),
  );

  report.repository = {
    terraformResources,
    providerVersions,
    cloudflareIpv4Cidrs: cloudflareCidrs,
    runtimeSecretKeys,
    runtimeSecretContainer: service.match(/EXECUTOR_SECRET_ID=([^\n]+)/)?.[1] ?? null,
    terraformOutputs: [...outputs.matchAll(/output\s+"([^"]+)"/g)].map((match) => match[1]),
    apiHostname: "api.cryptobotlabs.app",
  };

  addCheck(report, "repo.expected-terraform-resources", expectedResources.every((resource) => terraformResources.includes(resource)) ? "pass" : "blocked",
    "Expected EC2, EIP, IAM, KMS, Secrets Manager, security-group, and optional Cloudflare DNS resources are declared.");
  addCheck(report, "repo.no-static-aws-account", concreteAccountIds.length === 0 ? "pass" : "blocked",
    "Public infrastructure contains no concrete 12-digit production account ID.");
  addCheck(report, "repo.no-secret-material-in-terraform",
    !/aws_secretsmanager_secret_version|secret_string|aws_iam_access_key|aws_iam_user|user_data\s*=/.test(main) ? "pass" : "blocked",
    "Terraform declares only the secret container and no secret value, long-lived IAM key, IAM user, or user-data payload.");
  addCheck(report, "repo.destructive-guards",
    /resource\s+"aws_kms_key"[\s\S]*?prevent_destroy\s*=\s*true/.test(main)
      && /resource\s+"aws_instance"[\s\S]*?prevent_destroy\s*=\s*true/.test(main) ? "pass" : "blocked",
    "KMS and executor replacement are protected from routine Terraform applies.");
  addCheck(report, "repo.cloudflare-proxy-only",
    /resource\s+"cloudflare_dns_record"[\s\S]*?proxied\s*=\s*true/.test(main)
      && /manage_cloudflare_dns[\s\S]*?default\s*=\s*false/.test(variables)
      && /enable_public_https[\s\S]*?default\s*=\s*false/.test(variables) ? "pass" : "blocked",
    "DNS management and public ingress default off; any Terraform-managed API record is proxied.");
  addCheck(report, "repo.private-evidence-ignore", /(^|\n)\/\.handoff\//.test(gitignore) ? "pass" : "blocked",
    "Generated handoff evidence is excluded from version control.");
  addCheck(report, "repo.runtime-secret-allowlist", runtimeSecretKeys.includes("SUPABASE_DATABASE_URL")
    && runtimeSecretKeys.includes("EXECUTOR_HANDOFF_SECRET") && runtimeSecretKeys.includes("AWS_KMS_KEY_ID") ? "pass" : "blocked",
  "Executor accepts a closed, reviewable runtime-secret key set.");
  addCheck(report, "repo.cloudflare-ip-baseline", cloudflareCidrs.length === 15 ? "pass" : "blocked",
    "Terraform contains the complete expected Cloudflare IPv4 proxy baseline count.");
}

async function publicInventory(report, cloudflareCidrs) {
  const domain = process.env.CBL_HANDOFF_DOMAIN || DEFAULT_DOMAIN;
  const [nameservers, ds, apiAddresses, wwwAddresses, wwwCnames, homepage, health, ready, officialCidrsResponse] = await Promise.all([
    resolveSafe(domain, "NS"),
    resolveSafe(domain, "DS"),
    resolveSafe(`api.${domain}`, "A"),
    resolveSafe(`www.${domain}`, "A"),
    resolveSafe(`www.${domain}`, "CNAME"),
    publicProbe(`https://www.${domain}/`),
    publicProbe(`https://api.${domain}/healthz`),
    publicProbe(`https://api.${domain}/readyz`),
    fetch("https://www.cloudflare.com/ips-v4", { signal: AbortSignal.timeout(10_000) }).catch(() => null),
  ]);
  let officialCidrs = [];
  if (officialCidrsResponse?.ok) {
    officialCidrs = (await officialCidrsResponse.text()).split(/\s+/).filter(Boolean).sort();
  }
  const configuredCidrs = [...cloudflareCidrs].sort();
  report.public = {
    domain,
    nameservers,
    dnssecDelegationPresent: ds.length > 0,
    apiAddresses,
    wwwAddresses,
    wwwCnames,
    probes: { homepage, health, ready },
    officialCloudflareIpv4Cidrs: officialCidrs,
  };
  addCheck(report, "public.authoritative-cloudflare",
    nameservers.length >= 2 && nameservers.every((name) => name.endsWith(".ns.cloudflare.com")) ? "pass" : "blocked",
    "The public zone delegates to at least two Cloudflare nameservers.");
  addCheck(report, "public.cloudflare-ip-ranges-current",
    officialCidrs.length > 0 && exactSet(configuredCidrs, officialCidrs) ? "pass" : "blocked",
    "Terraform Cloudflare ingress ranges exactly match the current official IPv4 list.");
  addCheck(report, "public.api-is-proxied",
    apiAddresses.length > 0 && officialCidrs.length > 0
      && apiAddresses.every((address) => officialCidrs.some((cidr) => inCidr(address, cidr))) ? "pass" : "blocked",
    "The public API hostname resolves only to Cloudflare proxy space.");
  addCheck(report, "public.endpoints-reachable",
    homepage.reachable && homepage.status >= 200 && homepage.status < 300
      && health.status === 200 && ready.status === 200 ? "pass" : "blocked",
    "Website, executor health, and executor readiness are reachable before handoff.");
}

function crossProviderChecks(report) {
  const dnsRecords = report.cloudflare?.dnsRecords;
  const elasticIps = report.aws?.elasticIps;
  if (!Array.isArray(dnsRecords) || !Array.isArray(elasticIps)) return;

  const apiOriginHashes = dnsRecords
    .filter((record) => record.name === `api.${report.public.domain}` && record.type === "A")
    .map((record) => record.contentSha256);
  const expectedApiHashes = elasticIps.map((address) => sha256(address.publicIp));
  addCheck(report, "cross-provider.api-origin",
    exactSet(apiOriginHashes, expectedApiHashes) ? "pass" : "blocked",
    "Cloudflare API origin records exactly match the inventoried AWS Elastic IP; only hashes are retained.");

  const expectedWwwHash = sha256(normalizedDnsContent("cryptobot-labs.netlify.app"));
  const wwwTargets = dnsRecords
    .filter((record) => record.name === `www.${report.public.domain}` && record.type === "CNAME")
    .map((record) => record.contentSha256);
  addCheck(report, "cross-provider.www-origin",
    wwwTargets.length === 1 && wwwTargets[0] === expectedWwwHash ? "pass" : "blocked",
    "Cloudflare www CNAME points to the reviewed Netlify origin; only its hash is retained.");
}

async function cloudflareInventory(report) {
  const accountId = process.env.CBL_HANDOFF_CLOUDFLARE_ACCOUNT_ID ?? "";
  const zoneId = process.env.CBL_HANDOFF_CLOUDFLARE_ZONE_ID ?? "";
  const token = process.env.CLOUDFLARE_API_TOKEN ?? "";
  const cfMode = process.env.CBL_HANDOFF_CLOUDFLARE_MODE || "membership";
  if (!/^[0-9a-f]{32}$/i.test(accountId) || !/^[0-9a-f]{32}$/i.test(zoneId) || token.length < 20) {
    report.cloudflare = { status: "not-inventoried", mode: cfMode };
    addCheck(report, "cloudflare.source-identity", "blocked",
      "Source account ID, zone ID, and a read-only API token are required; no credential value is written.");
    return;
  }
  if (!new Set(["membership", "zone-move"]).has(cfMode)) {
    addCheck(report, "cloudflare.mode", "blocked", "Cloudflare handoff mode is invalid.");
    return;
  }

  const base = "https://api.cloudflare.com/client/v4";
  const [zone, records, settings, dnssec, routes, rulesets, members, registration] = await Promise.all([
    fetchJson(`${base}/zones/${zoneId}`, token),
    fetchCloudflarePages(`/zones/${zoneId}/dns_records`, token),
    fetchJson(`${base}/zones/${zoneId}/settings`, token),
    fetchJson(`${base}/zones/${zoneId}/dnssec`, token),
    fetchCloudflarePages(`/zones/${zoneId}/workers/routes`, token),
    fetchCloudflarePages(`/zones/${zoneId}/rulesets`, token),
    fetchCloudflarePages(`/accounts/${accountId}/members`, token),
    fetchJson(`${base}/accounts/${accountId}/registrar/domains/${process.env.CBL_HANDOFF_DOMAIN || DEFAULT_DOMAIN}`, token),
  ]);
  const failures = [zone, records, settings, dnssec].filter((item) => !item.ok).length;
  if (failures > 0) {
    report.cloudflare = { status: "incomplete", mode: cfMode, requiredEndpointFailures: failures };
    addCheck(report, "cloudflare.read-permissions", "blocked",
      "The token must read the zone, DNS records, zone settings, and DNSSEC state.");
    return;
  }
  const zoneAccountId = zone.value?.account?.id ?? null;
  const dnsRecords = records.value.map((record) => ({
    id: record.id,
    name: record.name,
    type: record.type,
    ttl: record.ttl,
    proxied: record.proxied ?? null,
    contentSha256: sha256(normalizedDnsContent(record.content)),
    commentSha256: record.comment ? sha256(record.comment) : null,
    tagCount: Array.isArray(record.tags) ? record.tags.length : 0,
  }));
  const selectedSettings = new Set([
    "always_use_https", "automatic_https_rewrites", "brotli", "http3", "min_tls_version", "security_level", "ssl", "tls_1_3",
  ]);
  const memberValues = members.ok ? members.value : [];
  const superAdministratorValues = memberValues.filter((member) => (
    member.roles ?? []
  ).some((role) => /super administrator/i.test(role.name ?? "")));
  report.cloudflare = {
    status: "inventoried",
    mode: cfMode,
    accountId,
    zoneId,
    zone: {
      name: zone.value?.name ?? null,
      status: zone.value?.status ?? null,
      paused: Boolean(zone.value?.paused),
      plan: zone.value?.plan?.name ?? null,
      nameservers: zone.value?.name_servers ?? [],
    },
    dnssec: { status: dnssec.value?.status ?? null },
    dnsRecords,
    settings: settings.value.filter((setting) => selectedSettings.has(setting.id))
      .map((setting) => ({ id: setting.id, value: setting.value })),
    workerRoutes: routes.ok ? routes.value.map((route) => ({ id: route.id, pattern: route.pattern, script: route.script })) : null,
    rulesets: rulesets.ok ? rulesets.value.map((ruleset) => ({ id: ruleset.id, name: ruleset.name, kind: ruleset.kind, phase: ruleset.phase })) : null,
    members: members.ok ? {
      count: memberValues.length,
      superAdministratorCount: superAdministratorValues.length,
      superAdministratorIdentityHashes: superAdministratorValues
        .map((member) => sha256(normalizedDnsContent(member.user?.email ?? member.id ?? "unknown"))),
      identityHashes: memberValues.map((member) => sha256(member.user?.email ?? member.id ?? "unknown")),
    } : null,
    registrar: registration.ok ? {
      status: registration.value?.status ?? null,
      registrar: registration.value?.registrar ?? null,
      expiresAt: registration.value?.expires_at ?? null,
      locked: registration.value?.locked ?? null,
      autoRenew: registration.value?.auto_renew ?? null,
    } : null,
    optionalEndpointFailures: [routes, rulesets, members, registration].filter((item) => !item.ok).length,
  };
  addCheck(report, "cloudflare.zone-account-match", zoneAccountId === accountId ? "pass" : "blocked",
    "The inventoried zone belongs to the explicitly expected source account.");
  addCheck(report, "cloudflare.zone-active", zone.value?.status === "active" && !zone.value?.paused ? "pass" : "blocked",
    "The source zone is active and not paused.");
  addCheck(report, "cloudflare.dns-inventory", dnsRecords.length > 0 ? "pass" : "blocked",
    "DNS metadata was inventoried; record content is represented only by SHA-256.");
  addCheck(report, "cloudflare.zone-move-dnssec",
    cfMode !== "zone-move" || dnssec.value?.status === "disabled" ? "pass" : "blocked",
    "A cross-account zone move requires DNSSEC to be disabled first.");
  if (!members.ok) addCheck(report, "cloudflare.member-inventory", "warning",
    "Account membership was not readable; verify two WEEX Super Administrators manually.", "warning");
  if (!registration.ok) addCheck(report, "cloudflare.registrar-inventory", "warning",
    "Registrar metadata was not readable; verify registrar ownership and transfer locks manually.", "warning");
}

function pickInstance(instance) {
  return {
    instanceId: instance.InstanceId,
    state: instance.State?.Name ?? null,
    type: instance.InstanceType,
    imageId: instance.ImageId,
    subnetId: instance.SubnetId,
    vpcId: instance.VpcId,
    publicIp: instance.PublicIpAddress ?? null,
    privateIp: instance.PrivateIpAddress ?? null,
    securityGroupIds: (instance.SecurityGroups ?? []).map((group) => group.GroupId),
    iamInstanceProfileArn: instance.IamInstanceProfile?.Arn ?? null,
    imdsTokens: instance.MetadataOptions?.HttpTokens ?? null,
    monitoring: instance.Monitoring?.State ?? null,
    rootDeviceName: instance.RootDeviceName ?? null,
  };
}

async function awsInventory(report) {
  const expectedAccountId = process.env.CBL_HANDOFF_AWS_ACCOUNT_ID ?? "";
  const region = process.env.CBL_HANDOFF_AWS_REGION || DEFAULT_REGION;
  const awsMode = process.env.CBL_HANDOFF_AWS_MODE || "account-ownership";
  if (!new Set(["account-ownership", "resource-rebuild"]).has(awsMode)) {
    addCheck(report, "aws.mode", "blocked", "AWS handoff mode is invalid.");
    return;
  }
  if (!/^\d{12}$/.test(expectedAccountId) || !commandAvailable("aws")) {
    report.aws = { status: "not-inventoried", mode: awsMode, region };
    addCheck(report, "aws.source-identity", "blocked",
      "The AWS CLI and an explicit expected source account ID are required.");
    return;
  }
  const identity = runAws(["sts", "get-caller-identity"]);
  if (!identity.ok || identity.value?.Account !== expectedAccountId) {
    report.aws = { status: "not-inventoried", mode: awsMode, region };
    addCheck(report, "aws.source-account-match", "blocked",
      "The authenticated caller must match the explicitly expected source account.");
    return;
  }

  const calls = {
    instances: runAws(["ec2", "describe-instances", "--region", region, "--filters", "Name=tag:Application,Values=cryptobot-labs"]),
    addresses: runAws(["ec2", "describe-addresses", "--region", region, "--filters", "Name=tag:Application,Values=cryptobot-labs"]),
    kms: runAws(["kms", "describe-key", "--region", region, "--key-id", "alias/cryptobot-labs-production-weex"]),
    rotation: runAws(["kms", "get-key-rotation-status", "--region", region, "--key-id", "alias/cryptobot-labs-production-weex"]),
    secret: runAws(["secretsmanager", "describe-secret", "--region", region, "--secret-id", "cryptobot-labs/production/executor-runtime"]),
    executorRole: runAws(["iam", "get-role", "--role-name", "cryptobot-labs-production-executor"]),
    provisionerRole: runAws(["iam", "get-role", "--role-name", "CryptoBotLabsProvisioner"]),
    ssm: runAws(["ssm", "describe-instance-information", "--region", region]),
    buckets: runAws(["s3api", "list-buckets"]),
    budget: runAws(["budgets", "describe-budget", "--account-id", expectedAccountId,
      "--budget-name", "cryptobot-labs-production-monthly"]),
    organization: runAwsOrganization(),
    trails: runAws(["cloudtrail", "describe-trails", "--region", region, "--include-shadow-trails", "false"]),
  };
  const requiredNames = ["instances", "addresses", "kms", "rotation", "secret", "executorRole", "provisionerRole", "ssm", "buckets", "budget", "organization"];
  const denied = requiredNames.filter((name) => !calls[name].ok);
  if (denied.length > 0) {
    report.aws = {
      status: "incomplete",
      mode: awsMode,
      region,
      accountId: expectedAccountId,
      inaccessibleChecks: denied,
    };
    addCheck(report, "aws.read-permissions", "blocked",
      "The current principal lacks one or more read-only handoff inventory permissions; raw AWS errors were discarded.");
    return;
  }

  const instances = (calls.instances.value?.Reservations ?? []).flatMap((reservation) => reservation.Instances ?? []).map(pickInstance);
  const addresses = (calls.addresses.value?.Addresses ?? []).map((address) => ({
    allocationId: address.AllocationId,
    associationId: address.AssociationId ?? null,
    publicIp: address.PublicIp,
    instanceId: address.InstanceId ?? null,
    networkBorderGroup: address.NetworkBorderGroup ?? null,
  }));
  const stateBuckets = (calls.buckets.value?.Buckets ?? [])
    .filter((bucket) => bucket.Name?.startsWith("cryptobot-labs-terraform-state-"))
    .map((bucket) => ({ name: bucket.Name, createdAt: bucket.CreationDate ?? null }));
  const managementAccountId = calls.organization.value?.Organization?.MasterAccountId ?? null;
  const identityArn = identity.value?.Arn ?? "";
  report.aws = {
    status: "inventoried",
    mode: awsMode,
    accountId: expectedAccountId,
    region,
    callerType: identityArn.includes(":assumed-role/") ? "assumed-role"
      : identityArn.endsWith(":root") ? "root" : identityArn.includes(":user/") ? "iam-user" : "other",
    callerArnSha256: sha256(identityArn),
    organization: {
      status: calls.organization.value?.standalone === true ? "standalone" : "member",
      id: calls.organization.value?.Organization?.Id ?? null,
      featureSet: calls.organization.value?.Organization?.FeatureSet ?? null,
      isManagementAccount: managementAccountId === expectedAccountId,
    },
    instances,
    elasticIps: addresses,
    kms: {
      arn: calls.kms.value?.KeyMetadata?.Arn ?? null,
      enabled: calls.kms.value?.KeyMetadata?.Enabled ?? false,
      state: calls.kms.value?.KeyMetadata?.KeyState ?? null,
      origin: calls.kms.value?.KeyMetadata?.Origin ?? null,
      rotationEnabled: calls.rotation.value?.KeyRotationEnabled ?? false,
    },
    runtimeSecret: {
      arn: calls.secret.value?.ARN ?? null,
      name: calls.secret.value?.Name ?? null,
      kmsKeyId: calls.secret.value?.KmsKeyId ?? null,
      lastChangedDate: calls.secret.value?.LastChangedDate ?? null,
      versionCount: Object.keys(calls.secret.value?.VersionIdsToStages ?? {}).length,
    },
    roles: {
      executorArn: calls.executorRole.value?.Role?.Arn ?? null,
      provisionerArn: calls.provisionerRole.value?.Role?.Arn ?? null,
    },
    ssmManagedInstanceCount: (calls.ssm.value?.InstanceInformationList ?? [])
      .filter((instance) => instances.some((candidate) => candidate.instanceId === instance.InstanceId)).length,
    terraformStateBuckets: stateBuckets,
    budget: {
      name: calls.budget.value?.Budget?.BudgetName ?? null,
      type: calls.budget.value?.Budget?.BudgetType ?? null,
      limit: calls.budget.value?.Budget?.BudgetLimit ?? null,
    },
    cloudTrails: calls.trails.ok ? (calls.trails.value?.trailList ?? []).map((trail) => ({
      name: trail.Name,
      homeRegion: trail.HomeRegion,
      multiRegion: Boolean(trail.IsMultiRegionTrail),
      logFileValidation: Boolean(trail.LogFileValidationEnabled),
    })) : null,
  };
  addCheck(report, "aws.executor-inventory", instances.length === 1 && instances[0].state === "running" ? "pass" : "blocked",
    "Exactly one running CryptoBot Labs executor was inventoried.");
  addCheck(report, "aws.fixed-egress", addresses.length === 1 && Boolean(addresses[0].associationId) ? "pass" : "blocked",
    "Exactly one associated Elastic IP was inventoried.");
  addCheck(report, "aws.kms-continuity", report.aws.kms.enabled && report.aws.kms.state === "Enabled"
    && report.aws.kms.rotationEnabled ? "pass" : "blocked",
    "The credential-envelope KMS key is enabled and rotating.");
  addCheck(report, "aws.secret-container", Boolean(report.aws.runtimeSecret.arn) ? "pass" : "blocked",
    "Secrets Manager metadata is present; no secret value was requested.");
  addCheck(report, "aws.ssm-only-administration", report.aws.ssmManagedInstanceCount === instances.length ? "pass" : "blocked",
    "Every inventoried executor is registered with SSM.");
  addCheck(report, "aws.terraform-state", stateBuckets.length === 1 ? "pass" : "blocked",
    "Exactly one account-specific Terraform state bucket was inventoried.");
  if (!calls.trails.ok) addCheck(report, "aws.cloudtrail-inventory", "warning",
    "CloudTrail metadata was not readable and must be checked manually.", "warning");
}

function targetChecks(report, options) {
  if (!options.requireTargets) return;
  const awsMode = process.env.CBL_HANDOFF_AWS_MODE || "account-ownership";
  const cfMode = process.env.CBL_HANDOFF_CLOUDFLARE_MODE || "membership";
  const weexAws = process.env.CBL_WEEX_AWS_ACCOUNT_ID ?? "";
  const weexCloudflare = process.env.CBL_WEEX_CLOUDFLARE_ACCOUNT_ID ?? "";
  const weexAdminHashes = (process.env.CBL_WEEX_CLOUDFLARE_ADMIN_SHA256S ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  addCheck(report, "target.weex-aws-account",
    awsMode !== "resource-rebuild" || (/^\d{12}$/.test(weexAws) && weexAws !== process.env.CBL_HANDOFF_AWS_ACCOUNT_ID)
      ? "pass" : "blocked",
    "Resource rebuild requires a distinct, verified WEEX AWS account ID.");
  addCheck(report, "target.weex-cloudflare-account",
    cfMode !== "zone-move" || (/^[0-9a-f]{32}$/i.test(weexCloudflare)
      && weexCloudflare !== process.env.CBL_HANDOFF_CLOUDFLARE_ACCOUNT_ID) ? "pass" : "blocked",
    "Zone move requires a distinct, verified WEEX Cloudflare account ID.");
  if (cfMode === "membership") {
    const superAdminHashes = report.cloudflare?.members?.superAdministratorIdentityHashes;
    addCheck(report, "target.weex-cloudflare-admins",
      Array.isArray(superAdminHashes)
        && weexAdminHashes.length === 2
        && new Set(weexAdminHashes).size === 2
        && weexAdminHashes.every((hash) => /^[a-f0-9]{64}$/u.test(hash) && superAdminHashes.includes(hash))
        ? "pass" : "blocked",
      "Membership handoff requires two independently verified WEEX Super Administrators identified only by email SHA-256.");
  }
  addCheck(report, "target.cloudflare-complete-inventory",
    report.cloudflare?.workerRoutes !== null && report.cloudflare?.rulesets !== null
      ? "pass" : "blocked",
    "Formal handoff requires readable Workers routes and rulesets inventory.");
}

async function writePrivateReport(output, report) {
  await mkdir(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, output);
  await chmod(output, 0o600);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: options.online ? "online-read-only" : "offline-repository",
    checks: [],
    blockers: [],
    warnings: [],
  };
  await repositoryInventory(report);
  if (options.online) {
    await publicInventory(report, report.repository.cloudflareIpv4Cidrs);
    await Promise.all([cloudflareInventory(report), awsInventory(report)]);
    crossProviderChecks(report);
    targetChecks(report, options);
  }
  report.result = report.blockers.length === 0 ? "ready" : "blocked";
  if (options.online && options.write) await writePrivateReport(options.output, report);

  process.stdout.write(`Cloudflare/AWS handoff preflight: ${report.result.toUpperCase()}\n`);
  process.stdout.write(`Checks: ${report.checks.length}; blockers: ${report.blockers.length}; warnings: ${report.warnings.length}\n`);
  if (report.blockers.length > 0) process.stdout.write(`Blocked checks: ${report.blockers.join(", ")}\n`);
  if (report.warnings.length > 0) process.stdout.write(`Warnings: ${report.warnings.join(", ")}\n`);
  if (options.online && options.write) process.stdout.write(`Private inventory: ${relative(ROOT, options.output)} (0600, gitignored)\n`);
  if (report.blockers.length > 0) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown preflight failure";
    process.stderr.write(`Cloudflare/AWS handoff preflight failed: ${message}\n`);
    process.exitCode = 1;
  });
}
