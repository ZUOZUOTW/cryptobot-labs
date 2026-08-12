import {
  canonicalSupabaseAuthUrl,
  canonicalSupabasePublishableKey,
} from "../lib/supabase-auth-environment.js";
import { isIP } from "node:net";

const publicOrigin = process.env.PUBLIC_ORIGIN;

let parsedOrigin;
try {
  parsedOrigin = new URL(publicOrigin ?? "");
} catch {
  console.error("Deployment environment check failed: PUBLIC_ORIGIN must be an absolute HTTPS origin.");
  process.exit(1);
}

if (parsedOrigin.protocol !== "https:"
  || parsedOrigin.username
  || parsedOrigin.password
  || parsedOrigin.pathname !== "/"
  || parsedOrigin.search
  || parsedOrigin.hash) {
  console.error("Deployment environment check failed: PUBLIC_ORIGIN must be an origin-only HTTPS URL.");
  process.exit(1);
}

const demoMode = process.env.DEMO_MODE;
if (demoMode !== "true" && demoMode !== "false") {
  console.error("Deployment environment check failed: DEMO_MODE must be exactly true or false.");
  process.exit(1);
}

if (demoMode === "false") {
  const requiredProductionBindings = [
    "AUTH_COOKIE_SECRET",
    "EXECUTOR_API_ORIGIN",
    "EXECUTOR_HANDOFF_SECRET",
    "NEXT_PUBLIC_EXECUTOR_EGRESS_IP",
    "SUPABASE_DATABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL",
    "WEEX_AUTH_STAGE",
  ];
  const missing = requiredProductionBindings.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    console.error(`Deployment environment check failed: missing production bindings: ${missing.join(", ")}.`);
    process.exit(1);
  }
  if (new TextEncoder().encode(process.env.AUTH_COOKIE_SECRET).length < 32) {
    console.error("Deployment environment check failed: AUTH_COOKIE_SECRET must contain at least 32 bytes.");
    process.exit(1);
  }
  const handoffSecretLength = new TextEncoder().encode(process.env.EXECUTOR_HANDOFF_SECRET).length;
  if (handoffSecretLength < 32 || handoffSecretLength > 512) {
    console.error("Deployment environment check failed: EXECUTOR_HANDOFF_SECRET must contain 32 to 512 bytes.");
    process.exit(1);
  }
  let executorOrigin;
  try {
    executorOrigin = new URL(process.env.EXECUTOR_API_ORIGIN);
  } catch {
    console.error("Deployment environment check failed: EXECUTOR_API_ORIGIN must be an origin-only HTTPS URL.");
    process.exit(1);
  }
  if (executorOrigin.protocol !== "https:"
    || executorOrigin.username
    || executorOrigin.password
    || executorOrigin.pathname !== "/"
    || executorOrigin.search
    || executorOrigin.hash
    || executorOrigin.origin === parsedOrigin.origin) {
    console.error("Deployment environment check failed: EXECUTOR_API_ORIGIN must be a distinct origin-only HTTPS URL.");
    process.exit(1);
  }
  if (isIP(process.env.NEXT_PUBLIC_EXECUTOR_EGRESS_IP.trim()) !== 4) {
    console.error("Deployment environment check failed: NEXT_PUBLIC_EXECUTOR_EGRESS_IP must be one IPv4 address.");
    process.exit(1);
  }
  if (!new Set(["transition", "dual", "oauth-only"]).has(process.env.WEEX_AUTH_STAGE)) {
    console.error("Deployment environment check failed: WEEX_AUTH_STAGE is invalid.");
    process.exit(1);
  }
  if (!/^postgres(?:ql)?:\/\/.+/u.test(process.env.SUPABASE_DATABASE_URL)) {
    console.error("Deployment environment check failed: SUPABASE_DATABASE_URL must be a PostgreSQL connection URL.");
    process.exit(1);
  }
  let databaseUsername = "";
  try {
    databaseUsername = decodeURIComponent(new URL(process.env.SUPABASE_DATABASE_URL).username);
  } catch {
    // The generic URL error below intentionally avoids echoing the credential.
  }
  if (databaseUsername !== "cryptobot_netlify" && !databaseUsername.startsWith("cryptobot_netlify.")) {
    console.error("Deployment environment check failed: SUPABASE_DATABASE_URL must use the cryptobot_netlify runtime role.");
    process.exit(1);
  }
  try {
    canonicalSupabasePublishableKey(process.env.SUPABASE_PUBLISHABLE_KEY);
  } catch {
    console.error("Deployment environment check failed: SUPABASE_PUBLISHABLE_KEY is invalid.");
    process.exit(1);
  }
  try {
    canonicalSupabaseAuthUrl(process.env.SUPABASE_URL);
  } catch {
    console.error("Deployment environment check failed: SUPABASE_URL must be an origin-only HTTPS URL.");
    process.exit(1);
  }
}

console.log(`Deployment environment check passed for ${parsedOrigin.hostname} (${demoMode === "true" ? "demo" : "production"} mode).`);
