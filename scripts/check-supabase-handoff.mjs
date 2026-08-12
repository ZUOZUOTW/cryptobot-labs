import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const baselinePath = resolve(
  repositoryRoot,
  "supabase/production-migration-baseline.json",
);
const migrationsDirectory = resolve(repositoryRoot, "supabase/migrations");
const knownRemoteOnlyMigrationCount = 19;
const expectedSharedProducts = [
  "CryptoBot Labs",
  "CryptoHunter",
  "Nexus",
  "OmniTrade",
];
const requiredSharedAssetClasses = [
  "auth",
  "database-assets",
  "edge-functions",
  "realtime",
  "storage",
];

const secretPatterns = [
  /\bsbp_[A-Za-z0-9_-]+\b/u,
  /\bsb_secret_[A-Za-z0-9_-]+\b/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /postgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
];

const forbiddenEvidenceFieldNames = new Set([
  "accessToken",
  "apiKey",
  "databaseUrl",
  "password",
  "projectRef",
  "secret",
  "serviceRoleKey",
  "sourceOrganizationId",
  "targetOrganizationId",
  "weexOwnerEmail",
]);

const preTransferEvidence = [
  "identity.sourceOrganizationOwnerVerified",
  "identity.targetOrganizationMembershipAccepted",
  "identity.weexOrganizationOwnerNamed",
  "commercial.targetPlanAndBillingVerified",
  "commercial.sameRegionAccepted",
  "transfer.githubIntegrationDisconnected",
  "transfer.projectScopedRolesCleared",
  "transfer.logDrainsCleared",
  "backup.restorePointRecorded",
  "backup.restoreProcedureReviewed",
  "scope.sharedProjectInventoryCaptured",
  "database.remoteHistoryInventoryCaptured",
  "database.knownRemoteDriftAcknowledged",
  "database.externalCanonicalSqlReviewed",
  "database.migrationChainReconciled",
  "database.dryRunReviewed",
  "database.pendingMigrationsApplied",
  "database.fullRemoteHistoryVerifiedAfterPush",
  "database.catalogObjectsVerifiedAfterPush",
  "database.websiteReadinessPassed",
  "database.executorReadinessPassed",
  "database.securityAdvisorsReviewed",
  "database.performanceAdvisorsReviewed",
  "database.crossProductAdvisorFindingAssigned",
  "auth.siteUrlVerified",
  "auth.redirectAllowlistVerified",
  "auth.providersVerified",
  "auth.smtpAndTemplatesVerified",
  "credentials.publishableKeyInventoryRecorded",
  "credentials.secretKeyRotationPlanApproved",
  "credentials.databaseRoleRotationPlanApproved",
  "operations.liveTradingDisabled",
  "operations.maintenanceWindowApproved",
  "operations.rollbackOwnerNamed",
];

const postTransferEvidence = [
  "cutover.weexOwnerAccessVerified",
  "cutover.projectHealthVerified",
  "cutover.authSmokePassed",
  "cutover.websiteDatabaseSmokePassed",
  "cutover.executorDatabaseSmokePassed",
  "cutover.weexPersonalAccessTokenCreated",
  "cutover.providerSecretsRehomed",
  "cutover.sourceAccessRemovalApproved",
];

function valueAtPath(value, dottedPath) {
  return dottedPath.split(".").reduce(
    (current, part) => current && typeof current === "object"
      ? current[part]
      : undefined,
    value,
  );
}

function collectStrings(value, strings = []) {
  if (typeof value === "string") {
    strings.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, strings);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, strings);
  }
  return strings;
}

function containsForbiddenEvidenceField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenEvidenceField(item));
  }
  return Object.entries(value).some(([key, item]) => {
    const normalizedKey = key.replace(/[^a-z0-9]/giu, "").toLowerCase();
    const looksLikeRawSensitiveField = /(?:project.*ref|organi[sz]ation.*id|account.*id|owner.*(?:email|address)|(?:access)?token|secret|password|database.*url|service.*role.*key|api.*key)/u
      .test(normalizedKey)
      && !normalizedKey.endsWith("sha256");
    return (
    ((forbiddenEvidenceFieldNames.has(key)
      || (looksLikeRawSensitiveField && typeof item !== "boolean"))
      && item !== null && item !== "")
    || containsForbiddenEvidenceField(item)
    );
  });
}

function migrationVersions(entries) {
  return entries.map(({ version }) => version);
}

function arraysEqual(left, right) {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/u.test(value ?? "");
}

export function canonicalExternalMigrationManifest(entries) {
  return JSON.stringify(entries.map((entry) => ({
    version: entry?.version,
    name: entry?.name,
    normalizedSha256: entry?.normalizedSha256,
  })));
}

export function externalMigrationManifestSha256(entries) {
  return createHash("sha256")
    .update(canonicalExternalMigrationManifest(entries))
    .digest("hex");
}

export function validateHandoffEvidence(
  evidence,
  baseline,
  stage,
  {
    approvedExternalManifestSha256,
    approvedProjectSplitManifestSha256,
  } = {},
) {
  const failures = [];
  const requiredPaths = stage === "post-transfer"
    ? [...preTransferEvidence, ...postTransferEvidence]
    : preTransferEvidence;

  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["evidence must be a JSON object"];
  }
  if (evidence.schemaVersion !== 1) failures.push("schemaVersion must be 1");

  for (const path of requiredPaths) {
    if (valueAtPath(evidence, path) !== true) failures.push(`${path} must be true`);
  }

  for (const fingerprintPath of [
    "identifiers.projectRefSha256",
    "identifiers.sourceOrganizationIdSha256",
    "identifiers.targetOrganizationIdSha256",
    "identifiers.weexOwnerEmailSha256",
    "backup.artifactSha256",
    "scope.sharedProjectInventorySha256",
    "database.externalCanonicalManifestSha256",
  ]) {
    if (!isSha256(valueAtPath(evidence, fingerprintPath))) {
      failures.push(`${fingerprintPath} must be a lowercase SHA-256 fingerprint`);
    }
  }

  const sharedProjectScopeAccepted = valueAtPath(
    evidence,
    "scope.sharedProjectScopeAccepted",
  ) === true;
  const sourceProductOwnersApproved = valueAtPath(
    evidence,
    "scope.sourceProductOwnersApproved",
  ) === true;
  const weexSharedProjectScopeAccepted = valueAtPath(
    evidence,
    "scope.weexSharedProjectScopeAccepted",
  ) === true;
  const splitCompleted = valueAtPath(
    evidence,
    "scope.projectSplitCompleted",
  ) === true;
  const splitValidated = valueAtPath(
    evidence,
    "scope.projectSplitValidationPassed",
  ) === true;
  const splitApprovedBySourceOwners = valueAtPath(
    evidence,
    "scope.projectSplitApprovedBySourceOwners",
  ) === true;
  const splitApprovedByWeex = valueAtPath(
    evidence,
    "scope.projectSplitApprovedByWeex",
  ) === true;
  const acceptedWithApprovals = sharedProjectScopeAccepted
    && sourceProductOwnersApproved
    && weexSharedProjectScopeAccepted
    && isSha256(valueAtPath(evidence, "scope.sourceProductOwnerApprovalsSha256"))
    && isSha256(valueAtPath(evidence, "scope.weexSharedProjectAcceptanceSha256"));
  const acceptedThroughSplit = splitCompleted
    && splitValidated
    && splitApprovedBySourceOwners
    && splitApprovedByWeex
    && isSha256(valueAtPath(evidence, "scope.projectSplitManifestSha256"))
    && valueAtPath(evidence, "scope.projectSplitManifestSha256")
      === approvedProjectSplitManifestSha256;

  if (splitCompleted && !isSha256(approvedProjectSplitManifestSha256)) {
    failures.push(
      "a completed project split requires an independently approved split manifest SHA-256 fence",
    );
  } else if (splitCompleted
    && valueAtPath(evidence, "scope.projectSplitManifestSha256")
      !== approvedProjectSplitManifestSha256) {
    failures.push(
      "project split evidence does not match the independently approved SHA-256 fence",
    );
  }

  if (!acceptedWithApprovals && !acceptedThroughSplit) {
    failures.push(
      "shared Supabase project scope requires source product owner and WEEX acceptance, or a completed validated project split",
    );
  }
  const sharedProducts = valueAtPath(evidence, "scope.sharedProducts");
  if (!Array.isArray(sharedProducts)
    || !arraysEqual([...sharedProducts].sort(), expectedSharedProducts)) {
    failures.push(
      "scope.sharedProducts must identify CryptoBot Labs, CryptoHunter, Nexus, and OmniTrade",
    );
  }
  const sharedAssetClasses = valueAtPath(evidence, "scope.sharedAssetClasses");
  if (!Array.isArray(sharedAssetClasses)
    || !requiredSharedAssetClasses.every((assetClass) => (
      sharedAssetClasses.includes(assetClass)
    ))) {
    failures.push(
      "scope.sharedAssetClasses must include Auth, database assets, Edge Functions, Realtime, and Storage",
    );
  }

  const appliedVersions = migrationVersions(baseline.migrations);
  const pendingVersions = migrationVersions(baseline.pendingMigrations);
  const externalCanonicalMigrations = valueAtPath(
    evidence,
    "database.externalCanonicalMigrations",
  );
  const externalVersions = Array.isArray(externalCanonicalMigrations)
    ? externalCanonicalMigrations.map((migration) => migration?.version)
    : [];
  const expectedBeforeVersions = [...appliedVersions, ...externalVersions];
  const expectedAfterVersions = [...expectedBeforeVersions, ...pendingVersions];
  const beforeVersions = valueAtPath(evidence, "database.beforePushVersions");
  const dryRunVersions = valueAtPath(evidence, "database.dryRunVersions");
  const afterVersions = valueAtPath(evidence, "database.afterPushVersions");

  if (!Array.isArray(externalCanonicalMigrations)
    || externalCanonicalMigrations.length !== knownRemoteOnlyMigrationCount) {
    failures.push(
      `database.externalCanonicalMigrations must contain all ${knownRemoteOnlyMigrationCount} known remote-only migrations`,
    );
  } else {
    for (const [index, migration] of externalCanonicalMigrations.entries()) {
      if (!/^\d{14}$/u.test(migration?.version ?? "")
        || !/^[a-z0-9_]+$/u.test(migration?.name ?? "")
        || !/^[a-f0-9]{64}$/u.test(migration?.normalizedSha256 ?? "")) {
        failures.push(`database.externalCanonicalMigrations entry ${index + 1} is invalid`);
      }
    }
    if (!arraysEqual(externalVersions, [...externalVersions].sort())
      || new Set(externalVersions).size !== externalVersions.length
      || externalVersions.some((version) => (
        version <= appliedVersions.at(-1) || version >= pendingVersions[0]
      ))) {
      failures.push(
        "database.externalCanonicalMigrations must be unique, ordered, and located between the applied and pending histories",
      );
    }
  }

  const computedExternalManifestSha256 = Array.isArray(externalCanonicalMigrations)
    ? externalMigrationManifestSha256(externalCanonicalMigrations)
    : undefined;
  const evidenceExternalManifestSha256 = valueAtPath(
    evidence,
    "database.externalCanonicalManifestSha256",
  );
  if (!computedExternalManifestSha256
    || evidenceExternalManifestSha256 !== computedExternalManifestSha256) {
    failures.push(
      "database.externalCanonicalManifestSha256 must match the canonical ordered migration entries",
    );
  }
  if (!isSha256(approvedExternalManifestSha256)) {
    failures.push(
      "an independently approved external migration manifest SHA-256 fence is required",
    );
  } else if (approvedExternalManifestSha256 !== computedExternalManifestSha256) {
    failures.push(
      "external migration manifest does not match the independently approved SHA-256 fence",
    );
  }

  if (![
    "canonical-restore",
    "reviewed-isolation",
  ].includes(valueAtPath(evidence, "database.migrationChainStrategy"))) {
    failures.push(
      "database.migrationChainStrategy must be canonical-restore or reviewed-isolation",
    );
  }
  if (!Array.isArray(beforeVersions)
    || !arraysEqual(beforeVersions, expectedBeforeVersions)) {
    failures.push(
      "database.beforePushVersions must include the applied baseline followed by every reviewed remote-only migration",
    );
  }
  if (!Array.isArray(dryRunVersions) || !arraysEqual(dryRunVersions, pendingVersions)) {
    failures.push("database.dryRunVersions must exactly match pending migrations");
  }
  if (!Array.isArray(afterVersions)
    || !arraysEqual(afterVersions, expectedAfterVersions)) {
    failures.push(
      "database.afterPushVersions must preserve the reconciled remote history and append only the reviewed pending migrations",
    );
  }

  if (collectStrings(evidence).some((value) => (
    secretPatterns.some((pattern) => pattern.test(value))
  ))) {
    failures.push("evidence contains secret-shaped material; retain fingerprints only");
  }
  if (containsForbiddenEvidenceField(evidence)) {
    failures.push("evidence contains a raw identifier or credential field; retain fingerprints only");
  }

  return failures;
}

export async function checkRepository() {
  const failures = [];
  const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
  const allEntries = [...baseline.migrations, ...baseline.pendingMigrations];
  const expectedFiles = allEntries.map(
    ({ version, name }) => `${version}_${name}.sql`,
  );
  const actualFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  if (baseline.projectRef !== "production-project-redacted") {
    failures.push("production project ref must remain redacted in the repository");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(baseline.capturedAt ?? "")) {
    failures.push("baseline capturedAt must use YYYY-MM-DD");
  }
  if (!arraysEqual(actualFiles, [...expectedFiles].sort())) {
    failures.push("migration files do not exactly match the baseline inventory");
  }

  for (const [index, entry] of allEntries.entries()) {
    if (!/^\d{14}$/u.test(entry.version)
      || !/^[a-z0-9_]+$/u.test(entry.name)
      || !/^[a-f0-9]{64}$/u.test(entry.normalizedSha256)) {
      failures.push(`migration entry ${index + 1} has invalid metadata`);
      continue;
    }
    if (index > 0 && entry.version <= allEntries[index - 1].version) {
      failures.push("migration versions must be strictly increasing");
    }
    const sql = await readFile(
      resolve(migrationsDirectory, `${entry.version}_${entry.name}.sql`),
      "utf8",
    );
    const hash = createHash("sha256")
      .update(sql.replace(/\n+$/u, ""))
      .digest("hex");
    if (hash !== entry.normalizedSha256) {
      failures.push(`migration ${entry.version} does not match its reviewed hash`);
    }
    if (/\b(?:create|alter)\s+extension\b[^;]*\bversion\b/iu.test(sql)) {
      failures.push(`migration ${entry.version} pins a deprecated extension version`);
    }
  }

  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  const forbiddenTrackedFiles = tracked.filter((file) => (
    file.startsWith("supabase/.temp/")
    || (/^\.env(?:\.|$)/u.test(file) && file !== ".env.example")
  ));
  if (forbiddenTrackedFiles.length > 0) {
    failures.push("repository tracks local Supabase state or an environment file");
  }

  return {
    baseline,
    failures,
    summary: {
      appliedMigrationCount: baseline.migrations.length,
      pendingMigrationCount: baseline.pendingMigrations.length,
      pendingVersions: migrationVersions(baseline.pendingMigrations),
      knownRemoteOnlyMigrationCount,
      sharedProjectScope: "OmniTrade, Nexus, CryptoHunter, and CryptoBot Labs assets transfer together unless split first",
      remoteCatalogStatus: "required pending catalog objects are absent",
      remoteGate: "P0 blocked: remote-only migration SQL must be restored canonically or isolated through an approved complete chain",
    },
  };
}

function usage() {
  return [
    "Usage:",
    "  node scripts/check-supabase-handoff.mjs --repository-only",
    "  node scripts/check-supabase-handoff.mjs --evidence /secure/path/evidence.json --stage pre-transfer",
    "  node scripts/check-supabase-handoff.mjs --evidence /secure/path/evidence.json --stage post-transfer",
    "",
    "Formal preflight requires --evidence. --repository-only checks local/CI integrity and never certifies handoff readiness.",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const repositoryOnly = args.includes("--repository-only");
  const evidenceIndex = args.indexOf("--evidence");
  const stageIndex = args.indexOf("--stage");
  const evidencePath = evidenceIndex >= 0 ? args[evidenceIndex + 1] : undefined;
  const stage = stageIndex >= 0 ? args[stageIndex + 1] : "pre-transfer";
  const knownArguments = new Set(["--repository-only", "--evidence", "--stage"]);
  const unknownArguments = args.filter((argument, index) => (
    !knownArguments.has(argument)
    && args[index - 1] !== "--evidence"
    && args[index - 1] !== "--stage"
  ));

  if ((evidenceIndex >= 0 && !evidencePath)
    || !["pre-transfer", "post-transfer"].includes(stage)
    || (repositoryOnly && (evidencePath || stageIndex >= 0))
    || unknownArguments.length > 0) {
    console.error(usage());
    process.exitCode = 2;
    return;
  }

  const result = await checkRepository();
  const failures = [...result.failures];

  if (!repositoryOnly && !evidencePath) {
    failures.push(
      "formal handoff preflight requires --evidence; use --repository-only only for CI or local integrity",
    );
  }

  if (evidencePath) {
    let evidence;
    const resolvedEvidencePath = resolve(evidencePath);
    if (resolvedEvidencePath === repositoryRoot
      || resolvedEvidencePath.startsWith(`${repositoryRoot}${sep}`)) {
      failures.push("evidence file must remain outside the repository");
    } else {
      try {
        evidence = JSON.parse(await readFile(resolvedEvidencePath, "utf8"));
      } catch {
        failures.push("evidence file could not be read as JSON");
      }
    }
    if (evidence) {
      failures.push(...validateHandoffEvidence(
        evidence,
        result.baseline,
        stage,
        {
          approvedExternalManifestSha256:
            process.env.SUPABASE_EXTERNAL_MIGRATION_MANIFEST_SHA256,
          approvedProjectSplitManifestSha256:
            process.env.SUPABASE_PROJECT_SPLIT_MANIFEST_SHA256,
        },
      ));
    }
  }

  const report = {
    ok: failures.length === 0,
    handoffReady: Boolean(evidencePath) && failures.length === 0,
    stage: repositoryOnly ? "repository-only" : stage,
    ...result.summary,
    ...(evidencePath && failures.length === 0
      ? { remoteGate: "known remote drift reconciled by validated evidence" }
      : {}),
    failures,
  };
  console.log(JSON.stringify(report, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
  await main();
}
