// @vitest-environment node

import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { exactSet } from "../scripts/check-cloudflare-aws-handoff.mjs";

const node = process.execPath;
const scriptPath = "scripts/check-cloudflare-aws-handoff.mjs";

describe("Cloudflare/AWS WEEX handoff preflight", () => {
  it("does not accept duplicate entries as an exact provider range match", () => {
    expect(exactSet(["a", "a"], ["a", "b"])).toBe(false);
    expect(exactSet(["b", "a"], ["a", "b"])).toBe(true);
  });

  it("passes the repository-only inventory without creating evidence", () => {
    const result = spawnSync(node, [
      scriptPath,
      "--offline",
      "--no-write",
    ], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Cloudflare/AWS handoff preflight: READY");
    expect(result.stdout).toContain("blockers: 0");
    expect(result.stdout).not.toMatch(/\b\d{12}\b/u);
    expect(result.stdout).not.toMatch(/\b[0-9a-f]{32}\b/iu);
    expect(result.stdout).not.toMatch(/cf(?:at|ut|k)_[A-Za-z0-9_-]+/u);
  });

  it("refuses to write handoff evidence outside the ignored private directory", () => {
    const result = spawnSync(node, [
      scriptPath,
      "--offline",
      "--output",
      "handoff-inventory.json",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must stay inside the ignored .handoff directory");
  });

  it("keeps the online audit read-only and secret-value blind", async () => {
    const source = await readFile(scriptPath, "utf8");
    const policy = JSON.parse(await readFile(
      "infra/aws-executor/handoff-readonly-policy.json",
      "utf8",
    )) as { Statement: Array<{ Action: string[] }> };
    const actions = policy.Statement.flatMap(({ Action }) => Action);

    expect(source).toContain('method: "GET"');
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/u);
    expect(source).not.toContain("GetSecretValue");
    expect(source).not.toContain("DecryptCommand");
    expect(actions).toContain("ec2:DescribeInstances");
    expect(actions).toContain("kms:DescribeKey");
    expect(actions).toContain("secretsmanager:DescribeSecret");
    expect(actions).not.toContain("secretsmanager:GetSecretValue");
    expect(actions).not.toContain("kms:Decrypt");
    expect(actions).not.toContain("kms:GenerateDataKey");
    expect(actions).not.toContain("sts:AssumeRole");
    expect(actions).not.toContain("iam:PassRole");
    expect(actions).not.toContain("*");
    expect(actions.every((action) => /^(?:budgets:View|cloudtrail:(?:Describe|Get)|ec2:Describe|iam:(?:Get|List)|kms:(?:Describe|Get|List)|organizations:(?:Describe|List)|s3:(?:Get|List)|secretsmanager:(?:Describe|GetResourcePolicy)|ssm:Describe|tag:Get)/u.test(action))).toBe(true);
    expect(actions.some((action) => /:(?:Create|Put|Update|Delete|Attach|Detach|Modify|Authorize|Revoke|Enable|Disable|Remove|Leave|Accept|Start|Stop|Terminate)/u.test(action))).toBe(false);
  });

  it("documents continuity-first and cross-account fallbacks without committing evidence", async () => {
    const [runbook, source, gitignore] = await Promise.all([
      readFile("docs/operations/cloudflare-aws-weex-handoff.md", "utf8"),
      readFile(scriptPath, "utf8"),
      readFile(".gitignore", "utf8"),
    ]);

    expect(runbook).toContain("Preferred Cloudflare account-control handoff");
    expect(runbook).toContain("Cloudflare zone/Registrar move (only if required)");
    expect(runbook).toContain("Preferred AWS account-control handoff");
    expect(runbook).toContain("AWS resource rebuild (only if the account cannot transfer)");
    expect(runbook).toContain("LIVE_TRADING_ENABLED=false");
    expect(runbook).toContain("https://developers.cloudflare.com/fundamentals/manage-domains/move-domain/");
    expect(runbook).toContain("https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-update-root-user-email.html");
    expect(runbook).toContain("https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/transfer-EIPs-intro-ec2.html");
    expect(source).not.toContain("GetSecretValue");
    expect(source).not.toContain("get-secret-value");
    expect(gitignore).toMatch(/(^|\n)\/\.handoff\//u);
  });
});
