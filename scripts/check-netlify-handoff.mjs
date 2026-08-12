import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_SITE_NAME = "cryptobot-labs";
const EXPECTED_CUSTOM_DOMAIN = "www.cryptobotlabs.app";
const EXPECTED_PUBLIC_ORIGIN = `https://${EXPECTED_CUSTOM_DOMAIN}`;
const EXPECTED_REPOSITORY = "https://github.com/ZUOZUOTW/cryptobot-labs";
const PRODUCTION_ENVIRONMENT_CONTEXTS = new Set(["all", "production"]);

export const NETLIFY_ENVIRONMENT_CONTRACT = Object.freeze({
  AUTH_COOKIE_SECRET: { scopes: ["builds", "functions"], secret: true },
  DEMO_MODE: { scopes: ["builds", "functions"], secret: false },
  EXECUTOR_API_ORIGIN: { scopes: ["builds", "functions"], secret: false },
  EXECUTOR_HANDOFF_SECRET: { scopes: ["builds", "functions"], secret: true },
  NEXT_PUBLIC_EXECUTOR_EGRESS_IP: { scopes: ["builds"], secret: false },
  PUBLIC_ORIGIN: { scopes: ["builds", "functions"], secret: false },
  SUPABASE_DATABASE_URL: { scopes: ["builds", "functions"], secret: true },
  SUPABASE_PUBLISHABLE_KEY: { scopes: ["builds", "functions"], secret: false },
  SUPABASE_URL: { scopes: ["builds", "functions"], secret: false },
  WEEX_AUTH_STAGE: { scopes: ["builds", "functions"], secret: false },
});

export const FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS = Object.freeze([
  "AWS_ACCESS_KEY_ID",
  "AWS_KMS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "LIVE_TRADING_ENABLED",
  "WEEX_API_KEY",
  "WEEX_CLIENT_ID",
  "WEEX_CLIENT_SECRET",
  "WEEX_PASSPHRASE",
  "WEEX_SECRET_KEY",
]);

const stableFingerprint = (value) => value
  ? createHash("sha256").update(String(value)).digest("hex").slice(0, 12)
  : null;

const normalizedRepository = (value) => String(value ?? "")
  .replace(/\.git$/u, "")
  .replace(/\/$/u, "");

const uniqueSortedStrings = (values) => [...new Set(values
  .filter((value) => typeof value === "string" && value.length > 0))].sort();

const isPlaceholderValue = (value) => {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0
    || /(?:change[-_ ]?me|placeholder|replace[-_ ]?(?:me|this|with)|your[-_ ]|todo|tbd)/u.test(normalized)
    || /^<[^>]+>$/u.test(normalized)
    || /^\$\{[^}]+\}$/u.test(normalized);
};

const isCanonicalHttpsOrigin = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && value === url.origin;
  } catch {
    return false;
  }
};

const isExactIpv4Address = (value) => {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u.test(value)) return false;
  return value.split(".").every((octet) => Number(octet) <= 255);
};

const isPostgresRuntimeUrl = (value) => {
  try {
    const url = new URL(value);
    const username = decodeURIComponent(url.username);
    return (url.protocol === "postgres:" || url.protocol === "postgresql:")
      && (username === "cryptobot_netlify" || username.startsWith("cryptobot_netlify."))
      && url.password.length > 0
      && url.hostname.length > 0
      && url.pathname.length > 1;
  } catch {
    return false;
  }
};

const isValidEnvironmentValue = (key, value) => {
  if (isPlaceholderValue(value)) return false;

  switch (key) {
    case "AUTH_COOKIE_SECRET":
    case "EXECUTOR_HANDOFF_SECRET": {
      const bytes = Buffer.byteLength(value, "utf8");
      return bytes >= 32 && bytes <= 512;
    }
    case "DEMO_MODE":
      return value === "false";
    case "EXECUTOR_API_ORIGIN":
      return isCanonicalHttpsOrigin(value) && value !== EXPECTED_PUBLIC_ORIGIN;
    case "NEXT_PUBLIC_EXECUTOR_EGRESS_IP":
      return isExactIpv4Address(value);
    case "PUBLIC_ORIGIN":
      return value === EXPECTED_PUBLIC_ORIGIN;
    case "SUPABASE_DATABASE_URL":
      return isPostgresRuntimeUrl(value);
    case "SUPABASE_PUBLISHABLE_KEY":
      return /^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(value);
    case "SUPABASE_URL":
      return isCanonicalHttpsOrigin(value);
    case "WEEX_AUTH_STAGE":
      return value === "transition";
    default:
      return false;
  }
};

export async function auditNetlifyRepository(projectRoot = DEFAULT_PROJECT_ROOT) {
  const [config, manifestSource, ignore, environmentExample] = await Promise.all([
    readFile(resolve(projectRoot, "netlify.toml"), "utf8"),
    readFile(resolve(projectRoot, "package.json"), "utf8"),
    readFile(resolve(projectRoot, ".gitignore"), "utf8"),
    readFile(resolve(projectRoot, ".env.example"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const issues = [];
  const warnings = [];

  const requiredConfigFragments = [
    'NODE_VERSION = "22.23.1"',
    'DEMO_MODE = "false"',
    'WEEX_AUTH_STAGE = "transition"',
    'publish = ".next"',
    "node scripts/check-deployment-env.mjs",
    "node scripts/check-production-database-readiness.mjs website",
    "node scripts/check-next-edge-bundle.mjs",
  ];
  for (const fragment of requiredConfigFragments) {
    if (!config.includes(fragment)) issues.push(`netlify.toml is missing required contract fragment: ${fragment}`);
  }

  if (!/^\.netlify\/?$/mu.test(ignore)) {
    issues.push(".gitignore must exclude the local .netlify link directory");
  }
  for (const key of Object.keys(NETLIFY_ENVIRONMENT_CONTRACT)) {
    if (!new RegExp(`^${key}=`, "mu").test(environmentExample)) {
      issues.push(`.env.example is missing the Netlify binding ${key}`);
    }
  }
  for (const key of FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS) {
    if (new RegExp(`^\\s*${key}\\s*=`, "mu").test(config)) {
      issues.push(`netlify.toml must not contain the executor-only binding ${key}`);
    }
  }

  const pinnedAdapter = manifest.devDependencies?.["@netlify/plugin-nextjs"];
  if (pinnedAdapter || config.includes('package = "@netlify/plugin-nextjs"')) {
    warnings.push("The Next.js adapter is intentionally pinned for the ownership-transfer freeze; validate an unpinned OpenNext migration in a separate post-transfer preview.");
  }

  return {
    ok: issues.length === 0,
    project: "CryptoBot Labs",
    expectedSiteName: DEFAULT_SITE_NAME,
    expectedCustomDomain: EXPECTED_CUSTOM_DOMAIN,
    expectedRepository: EXPECTED_REPOSITORY,
    framework: `Next.js ${manifest.dependencies?.next ?? "unknown"}`,
    nodeVersion: manifest.engines?.node ?? "unknown",
    packageManager: manifest.packageManager ?? "unknown",
    requiredEnvironmentKeys: Object.keys(NETLIFY_ENVIRONMENT_CONTRACT).sort(),
    forbiddenEnvironmentKeys: [...FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS],
    issues,
    warnings,
  };
}

export function redactNetlifyRemoteState(site, environmentVariables) {
  const rawEnvironment = Array.isArray(environmentVariables) ? environmentVariables : [];
  const environment = rawEnvironment
    .map((entry) => ({
      contexts: uniqueSortedStrings((entry.values ?? []).map((value) => value?.context)),
      key: typeof entry.key === "string" ? entry.key : "",
      scopes: uniqueSortedStrings(Array.isArray(entry.scopes) ? entry.scopes : []),
      secret: entry.is_secret === true,
    }))
    .filter((entry) => entry.key)
    .sort((left, right) => left.key.localeCompare(right.key));
  const environmentByKey = new Map(environment.map((entry) => [entry.key, entry]));
  const rawEnvironmentByKey = new Map(rawEnvironment
    .filter((entry) => typeof entry?.key === "string" && entry.key.length > 0)
    .map((entry) => [entry.key, entry]));
  const issues = [];
  const warnings = [];

  if (site?.name !== DEFAULT_SITE_NAME) issues.push("unexpected Netlify project name");
  if (site?.custom_domain !== EXPECTED_CUSTOM_DOMAIN) {
    issues.push("unexpected primary custom domain");
  }
  if (normalizedRepository(site?.build_settings?.repo_url) !== EXPECTED_REPOSITORY) {
    issues.push("the Netlify project is not linked to the expected Git repository");
  }
  if (site?.build_settings?.repo_branch !== "main") issues.push("the Netlify production branch must be main");
  if (!site?.published_deploy) issues.push("the Netlify project has no published deployment");
  if (site?.state !== "current") issues.push("the Netlify project is not in the current state");
  if (!site?.ssl) issues.push("Netlify reports that TLS is not enabled");

  for (const [key, contract] of Object.entries(NETLIFY_ENVIRONMENT_CONTRACT)) {
    const entry = environmentByKey.get(key);
    if (!entry) {
      issues.push(`missing Netlify environment variable: ${key}`);
      continue;
    }
    if (!entry.contexts.some((context) => context === "all" || context === "production")) {
      issues.push(`${key} has no production or all-context value`);
    }
    for (const scope of contract.scopes) {
      if (!entry.scopes.includes(scope)) issues.push(`${key} is missing the ${scope} scope`);
    }
    if (contract.secret && !entry.secret) issues.push(`${key} must be marked as containing secret values`);

    const rawEntry = rawEnvironmentByKey.get(key);
    const applicableValues = (Array.isArray(rawEntry?.values) ? rawEntry.values : [])
      .filter((value) => PRODUCTION_ENVIRONMENT_CONTEXTS.has(value?.context));
    const productionValue = applicableValues.find((value) => value?.context === "production")?.value;
    const allValue = applicableValues.find((value) => value?.context === "all")?.value;
    const effectiveValue = productionValue ?? allValue;
    if (applicableValues.some((value) => (
      typeof value?.value !== "string" || value.value.trim().length === 0
    )) || typeof effectiveValue !== "string" || effectiveValue.trim().length === 0) {
      issues.push(`${key} has no non-empty production or all-context value`);
    } else if (!isValidEnvironmentValue(key, effectiveValue)) {
      issues.push(`${key} has an invalid production value`);
    }
  }
  for (const key of FORBIDDEN_NETLIFY_ENVIRONMENT_KEYS) {
    if (environmentByKey.has(key)) issues.push(`executor-only variable must be removed from Netlify: ${key}`);
  }

  const dashboardCommand = site?.build_settings?.cmd;
  if (dashboardCommand && !dashboardCommand.includes("check-deployment-env.mjs")) {
    warnings.push("The dashboard build command is stale; committed netlify.toml is authoritative and must be observed in the next deploy log.");
  }

  return {
    ok: issues.length === 0,
    project: {
      accountFingerprint: stableFingerprint(site?.account_id),
      buildCommandFingerprint: stableFingerprint(dashboardCommand),
      buildCommandMatchesContract: typeof dashboardCommand === "string"
        && dashboardCommand.includes("check-deployment-env.mjs"),
      buildCommandPresent: typeof dashboardCommand === "string" && dashboardCommand.length > 0,
      customDomain: site?.custom_domain ?? null,
      domainAliases: uniqueSortedStrings(Array.isArray(site?.domain_aliases) ? site.domain_aliases : []),
      name: site?.name ?? null,
      netlifyUrl: site?.ssl_url ?? site?.url ?? null,
      productionBranch: site?.build_settings?.repo_branch ?? null,
      provider: site?.build_settings?.provider ?? null,
      publishDirectory: site?.build_settings?.dir ?? null,
      repository: site?.build_settings?.repo_url ?? null,
      siteFingerprint: stableFingerprint(site?.id),
      state: site?.state ?? null,
      tlsEnabled: Boolean(site?.ssl),
    },
    environment,
    issues,
    warnings,
  };
}

async function netlifyGet(path, token) {
  const response = await fetch(new URL(path, "https://api.netlify.com"), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "cryptobot-labs-netlify-handoff-readonly",
    },
  });
  if (!response.ok) throw new Error(`Netlify read-only API request failed with status ${response.status}`);
  return response.json();
}

export async function auditNetlifyRemote({ siteName = DEFAULT_SITE_NAME, token }) {
  if (typeof token !== "string" || token.length < 1) {
    throw new Error("NETLIFY_AUTH_TOKEN is required for the optional remote audit");
  }
  const sites = await netlifyGet("/api/v1/sites?filter=all&per_page=100", token);
  const matches = (Array.isArray(sites) ? sites : []).filter((site) => site?.name === siteName);
  if (matches.length !== 1) throw new Error(`Expected exactly one visible Netlify project named ${siteName}`);
  const site = matches[0];
  if (!site.account_id || !site.id) throw new Error("The Netlify project is missing ownership metadata");
  const environment = await netlifyGet(
    `/api/v1/accounts/${encodeURIComponent(site.account_id)}/env?site_id=${encodeURIComponent(site.id)}`,
    token,
  );
  return redactNetlifyRemoteState(site, environment);
}

function parseArguments(arguments_) {
  let remote = false;
  let siteName = process.env.NETLIFY_SITE_NAME ?? DEFAULT_SITE_NAME;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--remote") remote = true;
    else if (argument === "--site-name") {
      siteName = arguments_[index + 1] ?? "";
      index += 1;
    } else if (argument === "--help") {
      return { help: true, remote, siteName };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!/^[a-z0-9-]{1,63}$/u.test(siteName)) throw new Error("Netlify site name is invalid");
  return { help: false, remote, siteName };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("Usage: node scripts/check-netlify-handoff.mjs [--remote] [--site-name cryptobot-labs]");
    console.log("The remote mode performs GET-only Netlify API requests and never prints environment values or resource IDs.");
    return;
  }

  const repository = await auditNetlifyRepository();
  const result = { repository };
  if (options.remote) {
    result.remote = await auditNetlifyRemote({
      siteName: options.siteName,
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
  }
  console.log(JSON.stringify(result, null, 2));
  if (!repository.ok || (result.remote && !result.remote.ok)) process.exitCode = 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Netlify handoff preflight failed");
    process.exitCode = 1;
  });
}
