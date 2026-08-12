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
    "SUPABASE_DATABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL",
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
  if (!/^postgres(?:ql)?:\/\/.+/u.test(process.env.SUPABASE_DATABASE_URL)) {
    console.error("Deployment environment check failed: SUPABASE_DATABASE_URL must be a PostgreSQL connection URL.");
    process.exit(1);
  }
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY.trim();
  if (publishableKey.length < 20 || /\s/u.test(publishableKey)) {
    console.error("Deployment environment check failed: SUPABASE_PUBLISHABLE_KEY is invalid.");
    process.exit(1);
  }
  let supabaseUrl;
  try {
    supabaseUrl = new URL(process.env.SUPABASE_URL);
  } catch {
    console.error("Deployment environment check failed: SUPABASE_URL must be an origin-only HTTPS URL.");
    process.exit(1);
  }
  if (supabaseUrl.protocol !== "https:"
    || supabaseUrl.username
    || supabaseUrl.password
    || supabaseUrl.pathname !== "/"
    || supabaseUrl.search
    || supabaseUrl.hash) {
    console.error("Deployment environment check failed: SUPABASE_URL must be an origin-only HTTPS URL.");
    process.exit(1);
  }
}

console.log(`Deployment environment check passed for ${parsedOrigin.hostname} (${demoMode === "true" ? "demo" : "production"} mode).`);
