import postgres from "postgres";
import {
  assertExecutorDatabaseSchema,
  assertPostgresRuntimeIdentity,
  assertWebsiteDatabaseSchema,
  EXECUTOR_DATABASE_SCHEMA_SQL,
  POSTGRES_RUNTIME_IDENTITY_SQL,
  WEBSITE_DATABASE_SCHEMA_SQL,
} from "../lib/server/postgres-runtime-readiness.js";

const target = process.argv[2] ?? "website";
const expectedRoles = {
  website: "cryptobot_netlify",
  executor: "cryptobot_executor",
};
const expectedRole = expectedRoles[target];

if (!expectedRole) {
  console.error("Production database readiness check failed: target must be website or executor.");
  process.exit(1);
}

// Demo builds deliberately have no production database dependency. Formal
// website builds always execute the catalog preflight before Next.js compiles.
if (target === "website") {
  if (process.env.DEMO_MODE === "true") {
    console.log("Production database readiness check skipped for demo mode.");
    process.exit(0);
  }
  if (process.env.DEMO_MODE !== "false") {
    console.error("Production database readiness check failed: DEMO_MODE must be exactly true or false.");
    process.exit(1);
  }
  let databaseHost = "";
  try {
    databaseHost = new URL(process.env.SUPABASE_DATABASE_URL ?? "").hostname;
  } catch {
    // The required-binding and connection checks below remain fail closed.
  }
  const syntheticGitHubBuild = process.env.CI === "true"
    && process.env.GITHUB_ACTIONS === "true"
    && process.env.PUBLIC_ORIGIN === "https://ci.cryptobot.invalid"
    && databaseHost === "ci-only.invalid";
  if (syntheticGitHubBuild) {
    console.log("Production database readiness check skipped for the synthetic GitHub build only.");
    process.exit(0);
  }
}

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
  console.error("Production database readiness check failed: SUPABASE_DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  idle_timeout: 5,
  connect_timeout: 10,
  prepare: false,
  ssl: "require",
});

try {
  const identities = await sql.unsafe(POSTGRES_RUNTIME_IDENTITY_SQL);
  assertPostgresRuntimeIdentity(identities[0], expectedRole);
  const schema = await sql.unsafe(EXECUTOR_DATABASE_SCHEMA_SQL);
  assertExecutorDatabaseSchema(schema[0]);
  if (target === "website") {
    const websiteSchema = await sql.unsafe(WEBSITE_DATABASE_SCHEMA_SQL);
    assertWebsiteDatabaseSchema(websiteSchema[0]);
  }
  console.log(`Production database readiness check passed for ${target}.`);
} catch {
  // Never echo driver errors because they can contain connection details.
  console.error(`Production database readiness check failed for ${target}.`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
