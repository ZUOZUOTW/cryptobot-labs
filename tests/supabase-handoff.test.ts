import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkRepository,
  externalMigrationManifestSha256,
  validateHandoffEvidence,
} from "../scripts/check-supabase-handoff.mjs";

function completeEvidence(baseline: Awaited<ReturnType<typeof checkRepository>>["baseline"]) {
  const applied = baseline.migrations.map(({ version }: { version: string }) => version);
  const pending = baseline.pendingMigrations.map(({ version }: { version: string }) => version);
  const fingerprint = "a".repeat(64);
  const externalCanonicalMigrations = Array.from({ length: 19 }, (_, index) => ({
    version: `20260729${String(index).padStart(6, "0")}`,
    name: `external_product_${index + 1}`,
    normalizedSha256: "b".repeat(64),
  }));
  const external = externalCanonicalMigrations.map(({ version }) => version);
  const externalManifestSha256 = externalMigrationManifestSha256(
    externalCanonicalMigrations,
  );
  return {
    schemaVersion: 1,
    identifiers: {
      projectRefSha256: fingerprint,
      sourceOrganizationIdSha256: fingerprint,
      targetOrganizationIdSha256: fingerprint,
      weexOwnerEmailSha256: fingerprint,
    },
    identity: {
      sourceOrganizationOwnerVerified: true,
      targetOrganizationMembershipAccepted: true,
      weexOrganizationOwnerNamed: true,
    },
    commercial: {
      targetPlanAndBillingVerified: true,
      sameRegionAccepted: true,
    },
    transfer: {
      githubIntegrationDisconnected: true,
      projectScopedRolesCleared: true,
      logDrainsCleared: true,
    },
    backup: {
      restorePointRecorded: true,
      restoreProcedureReviewed: true,
      artifactSha256: fingerprint,
    },
    scope: {
      sharedProjectInventoryCaptured: true,
      sharedProjectInventorySha256: fingerprint,
      sharedProjectScopeAccepted: true,
      sourceProductOwnersApproved: true,
      weexSharedProjectScopeAccepted: true,
      sourceProductOwnerApprovalsSha256: fingerprint,
      weexSharedProjectAcceptanceSha256: fingerprint,
      projectSplitCompleted: false,
      projectSplitValidationPassed: false,
      projectSplitApprovedBySourceOwners: false,
      projectSplitApprovedByWeex: false,
      projectSplitManifestSha256: "",
      sharedProducts: [
        "CryptoBot Labs",
        "CryptoHunter",
        "Nexus",
        "OmniTrade",
      ],
      sharedAssetClasses: [
        "auth",
        "database-assets",
        "edge-functions",
        "realtime",
        "storage",
      ],
    },
    database: {
      remoteHistoryInventoryCaptured: true,
      knownRemoteDriftAcknowledged: true,
      externalCanonicalSqlReviewed: true,
      migrationChainReconciled: true,
      dryRunReviewed: true,
      pendingMigrationsApplied: true,
      fullRemoteHistoryVerifiedAfterPush: true,
      catalogObjectsVerifiedAfterPush: true,
      websiteReadinessPassed: true,
      executorReadinessPassed: true,
      securityAdvisorsReviewed: true,
      performanceAdvisorsReviewed: true,
      crossProductAdvisorFindingAssigned: true,
      externalCanonicalManifestSha256: externalManifestSha256,
      externalCanonicalMigrations,
      migrationChainStrategy: "canonical-restore",
      beforePushVersions: [...applied, ...external],
      dryRunVersions: pending,
      afterPushVersions: [...applied, ...external, ...pending],
    },
    auth: {
      siteUrlVerified: true,
      redirectAllowlistVerified: true,
      providersVerified: true,
      smtpAndTemplatesVerified: true,
    },
    credentials: {
      publishableKeyInventoryRecorded: true,
      secretKeyRotationPlanApproved: true,
      databaseRoleRotationPlanApproved: true,
    },
    operations: {
      liveTradingDisabled: true,
      maintenanceWindowApproved: true,
      rollbackOwnerNamed: true,
    },
    cutover: {
      weexOwnerAccessVerified: true,
      projectHealthVerified: true,
      authSmokePassed: true,
      websiteDatabaseSmokePassed: true,
      executorDatabaseSmokePassed: true,
      weexPersonalAccessTokenCreated: true,
      providerSecretsRehomed: true,
      sourceAccessRemovalApproved: true,
    },
  };
}

describe("Supabase WEEX handoff preflight", () => {
  it("verifies the redacted repository migration inventory", async () => {
    const result = await checkRepository();

    expect(result.failures).toEqual([]);
    expect(result.summary.appliedMigrationCount).toBeGreaterThan(0);
    expect(result.summary.pendingVersions).toEqual([
      "20260812061404",
      "20260812072739",
      "20260812090000",
    ]);
    expect(result.summary.knownRemoteOnlyMigrationCount).toBe(19);
    expect(result.summary.remoteGate).toMatch(/^P0 blocked:/);
  });

  it("accepts complete fingerprint-only transfer evidence", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);

    expect(validateHandoffEvidence(
      evidence,
      baseline,
      "post-transfer",
      {
        approvedExternalManifestSha256:
          evidence.database.externalCanonicalManifestSha256,
      },
    )).toEqual([]);
  });

  it("rejects secrets and migration history divergence", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    evidence.database.beforePushVersions = [];
    Object.assign(evidence.credentials, {
      leakedValue: "sb_secret_do-not-store-this-value",
    });

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256:
        evidence.database.externalCanonicalManifestSha256,
    })).toEqual(
      expect.arrayContaining([
        "database.beforePushVersions must include the applied baseline followed by every reviewed remote-only migration",
        "evidence contains secret-shaped material; retain fingerprints only",
      ]),
    );
  });

  it("blocks the whole-project transfer without shared-scope acceptance or a validated split", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    evidence.scope.sharedProjectScopeAccepted = false;
    evidence.scope.sourceProductOwnersApproved = false;
    evidence.scope.weexSharedProjectScopeAccepted = false;

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256:
        evidence.database.externalCanonicalManifestSha256,
    })).toContain(
      "shared Supabase project scope requires source product owner and WEEX acceptance, or a completed validated project split",
    );
  });

  it("accepts an independently fenced and validated project split as the scope alternative", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    const splitManifestSha256 = "c".repeat(64);
    evidence.scope.sharedProjectScopeAccepted = false;
    evidence.scope.sourceProductOwnersApproved = false;
    evidence.scope.weexSharedProjectScopeAccepted = false;
    evidence.scope.projectSplitCompleted = true;
    evidence.scope.projectSplitValidationPassed = true;
    evidence.scope.projectSplitApprovedBySourceOwners = true;
    evidence.scope.projectSplitApprovedByWeex = true;
    evidence.scope.projectSplitManifestSha256 = splitManifestSha256;

    expect(validateHandoffEvidence(evidence, baseline, "post-transfer", {
      approvedExternalManifestSha256:
        evidence.database.externalCanonicalManifestSha256,
      approvedProjectSplitManifestSha256: splitManifestSha256,
    })).toEqual([]);
  });

  it("blocks an exact local baseline when remote-only canonical SQL is absent", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    const applied = baseline.migrations.map(({ version }: { version: string }) => version);
    evidence.database.externalCanonicalMigrations = [];
    evidence.database.beforePushVersions = applied;

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256:
        evidence.database.externalCanonicalManifestSha256,
    })).toEqual(
      expect.arrayContaining([
        "database.externalCanonicalMigrations must contain all 19 known remote-only migrations",
      ]),
    );
  });

  it("rejects tampering even when evidence retains the original manifest hash", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    const approvedHash = evidence.database.externalCanonicalManifestSha256;
    evidence.database.externalCanonicalMigrations[0]!.name = "tampered_product";

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256: approvedHash,
    })).toEqual(expect.arrayContaining([
      "database.externalCanonicalManifestSha256 must match the canonical ordered migration entries",
      "external migration manifest does not match the independently approved SHA-256 fence",
    ]));
  });

  it("rejects a self-consistent forged manifest that lacks the independent fence", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    const approvedHash = evidence.database.externalCanonicalManifestSha256;
    evidence.database.externalCanonicalMigrations[0]!.name = "forged_product";
    evidence.database.externalCanonicalManifestSha256 = externalMigrationManifestSha256(
      evidence.database.externalCanonicalMigrations,
    );

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256: approvedHash,
    })).toContain(
      "external migration manifest does not match the independently approved SHA-256 fence",
    );
  });

  it("cannot certify a well-formed manifest without an independent approved fence", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer")).toContain(
      "an independently approved external migration manifest SHA-256 fence is required",
    );
  });

  it("fails closed without evidence and supports an explicit repository-only CI mode", () => {
    const script = resolve("scripts/check-supabase-handoff.mjs");
    const formal = spawnSync(process.execPath, [script], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    const repositoryOnly = spawnSync(
      process.execPath,
      [script, "--repository-only"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(formal.status).toBe(1);
    expect(JSON.parse(formal.stdout)).toMatchObject({
      ok: false,
      handoffReady: false,
      stage: "pre-transfer",
      failures: [
        "formal handoff preflight requires --evidence; use --repository-only only for CI or local integrity",
      ],
    });
    expect(repositoryOnly.status).toBe(0);
    expect(JSON.parse(repositoryOnly.stdout)).toMatchObject({
      ok: true,
      handoffReady: false,
      stage: "repository-only",
    });
  });

  it("keeps formal CLI handoffReady false until an independent manifest fence is injected", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "cbl-supabase-handoff-"));
    const evidencePath = join(temporaryDirectory, "evidence.json");
    const childEnvironment = { ...process.env };
    delete childEnvironment.SUPABASE_EXTERNAL_MIGRATION_MANIFEST_SHA256;
    delete childEnvironment.SUPABASE_PROJECT_SPLIT_MANIFEST_SHA256;
    writeFileSync(evidencePath, JSON.stringify(evidence), { mode: 0o600 });

    try {
      const withoutFence = spawnSync(
        process.execPath,
        [
          resolve("scripts/check-supabase-handoff.mjs"),
          "--evidence",
          evidencePath,
          "--stage",
          "pre-transfer",
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: childEnvironment,
        },
      );

      expect(withoutFence.status).toBe(1);
      expect(JSON.parse(withoutFence.stdout)).toMatchObject({
        ok: false,
        handoffReady: false,
        failures: expect.arrayContaining([
          "an independently approved external migration manifest SHA-256 fence is required",
        ]),
      });
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects raw ownership identifiers even when they are not secret-shaped", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    Object.assign(evidence.identifiers, {
      projectRef: "abcdefghijklmnopqrst",
    });

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer", {
      approvedExternalManifestSha256:
        evidence.database.externalCanonicalManifestSha256,
    })).toContain(
      "evidence contains a raw identifier or credential field; retain fingerprints only",
    );
  });

  it("rejects alternate raw identifier field names", async () => {
    const { baseline } = await checkRepository();
    const evidence = completeEvidence(baseline);
    Object.assign(evidence.identifiers, {
      project_ref: "abcdefghijklmnopqrst",
      rawTargetAccountId: "target-account",
    });

    expect(validateHandoffEvidence(evidence, baseline, "pre-transfer")).toContain(
      "evidence contains a raw identifier or credential field; retain fingerprints only",
    );
  });
});
