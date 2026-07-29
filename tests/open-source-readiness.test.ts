import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const bannedProductionIdentifierDigests = new Map([
  ["1a3f23be00bf6d01f9f06469021b69ca6804a34a82209705e20ec0377d19dcb4", "AWS account"],
  ["4d4d6f12d8bd26a5b4495fef57c36b3599629481ea4c3dce6968dd5485ddab34", "EC2 instance"],
  ["0d080b9f051fcd31f2f9932aa23c4e02eebea5f20700536b9fc86f999d74b1af", "executor egress IP"],
  ["d3fe46803796f00eec8e0e77416e0e1e5fdcbc8a11f114580c95416540228caf", "Cloudflare zone"],
  ["342520d99a8b38e8f032b8314d130e8bf11fdcee5f051a633072ab31c45d2b2f", "Supabase project"],
  ["9a5ae4a546f9e7fb0a828ff01ac0794c9d441e8b6058cdaf31e20ef3612cb5dd", "Broker UID"],
  ["2b73921d4030726d451abd6b817d41fe927b367605a4445647151aafe993afe5", "Supabase pooler"],
  ["79d39a65ebf5b228e1dd9f3aa0522b89d466c84fa3e3e2edb1afee1f22fb83f2", "Netlify team"],
]);

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function identifierCandidates(text: string) {
  const candidates = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z0-9._-]{4,}/g)) {
    candidates.add(match[0]);
    for (const part of match[0].split(/[._-]/)) {
      if (part.length >= 4) candidates.add(part);
    }
  }
  return candidates;
}

async function trackedTextFiles() {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      encoding: "buffer",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const files = stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const entries = await Promise.all(files.map(async (file) => {
    const content = await readFile(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (content === null) return null;
    if (content.subarray(0, 8192).includes(0)) return null;
    return { file, text: content.toString("utf8") };
  }));
  return entries.filter((entry): entry is { file: string; text: string } => entry !== null);
}

describe("open-source repository boundary", () => {
  it("publishes the exact Apache-2.0 license with explicit brand boundaries", async () => {
    const manifestPaths = [
      "package.json",
      "apps/agent/package.json",
      "apps/executor/package.json",
      "packages/trading-core/package.json",
      "packages/weex-client/package.json",
    ];
    const [license, notice, trademarks, brandAssets, readme, ...manifests] =
      await Promise.all([
        readFile("LICENSE", "utf8"),
        readFile("NOTICE", "utf8"),
        readFile("TRADEMARKS.md", "utf8"),
        readFile("BRAND_ASSETS.md", "utf8"),
        readFile("README.md", "utf8"),
        ...manifestPaths.map((path) => readFile(path, "utf8")),
      ]);

    expect(sha256(license)).toBe(
      "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    );
    expect(notice).toContain("Copyright 2026 CryptoBot Labs");
    expect(trademarks).toContain("Modified distributions must use a clearly");
    expect(brandAssets).toContain("public/mascots/**");
    expect(brandAssets).toContain("does **not** apply");
    expect(readme).toContain("[Apache License 2.0](LICENSE)");
    for (const manifest of manifests) {
      expect(JSON.parse(manifest).license).toBe("Apache-2.0");
    }
  });

  it("does not publish concrete production infrastructure identifiers", async () => {
    const entries = await trackedTextFiles();
    const matches = entries.flatMap(({ file, text }) => {
      const findings: string[] = [];
      for (const candidate of identifierCandidates(text)) {
        const label = bannedProductionIdentifierDigests.get(sha256(candidate));
        if (label) findings.push(`${file}: ${label}`);
      }
      return findings;
    });

    expect(matches).toEqual([]);
  });

  it("tracks no secret file types and keeps the environment template synthetic", async () => {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const files = stdout.toString("utf8").split("\0").filter(Boolean);
    const sensitivePaths = files.filter((file) =>
      /(^|\/)(?:\.env(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx|jks|keystore|tfstate(?:\.backup)?))$/i.test(file)
      && file !== ".env.example",
    );
    const environment = await readFile(".env.example", "utf8");

    expect(sensitivePaths).toEqual([]);
    expect(environment).toContain("PUBLIC_ORIGIN=https://app.example.com");
    expect(environment).toContain("NEXT_PUBLIC_EXECUTOR_EGRESS_IP=203.0.113.10");
    expect(environment).not.toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\s*=/);
  });

  it("does not publish contributor-local paths or machine-local email addresses", async () => {
    const entries = await trackedTextFiles();
    const macosHome = new RegExp("/" + "Users/[^/\\s\"'`]+/");
    const windowsHome = new RegExp("[A-Za-z]:\\\\U" + "sers\\\\[^\\\\\\s\"'`]+\\\\");
    const localEmail = new RegExp(
      "[A-Z0-9._%+-]+@[A-Z0-9.-]+\\." + "local\\b",
      "i",
    );
    const violations = entries
      .filter(({ text }) =>
        macosHome.test(text) || windowsHome.test(text) || localEmail.test(text))
      .map(({ file }) => file);

    expect(violations).toEqual([]);
  });

  it("requires operators to supply the AWS account before bootstrap", async () => {
    const [bootstrap, trust, policy] = await Promise.all([
      readFile("infra/aws-executor/bootstrap/bootstrap-cloudshell.sh", "utf8"),
      readFile("infra/aws-executor/bootstrap/provisioner-trust.json", "utf8"),
      readFile("infra/aws-executor/bootstrap/provisioner-iam-policy.json", "utf8"),
    ]);

    expect(bootstrap).toContain("CBL_AWS_ACCOUNT_ID");
    expect(bootstrap).toContain("must be exactly 12 digits");
    expect(trust).toContain("arn:aws:iam::000000000000:root");
    expect(policy).toContain("arn:aws:iam::000000000000:role/cryptobot-labs-*");
  });

  it("pins every GitHub Action to an immutable commit SHA", async () => {
    const workflowDirectory = ".github/workflows";
    const workflowFiles = (await readdir(workflowDirectory))
      .filter((file) => /\.ya?ml$/.test(file));
    const violations: string[] = [];

    for (const file of workflowFiles) {
      const source = await readFile(`${workflowDirectory}/${file}`, "utf8");
      for (const match of source.matchAll(/^\s*(?:-\s+)?uses:\s+([^#\s]+)/gm)) {
        const action = match[1];
        if (action.startsWith("./")) continue;
        if (!/@[a-f0-9]{40}$/.test(action)) violations.push(`${file}: ${action}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
