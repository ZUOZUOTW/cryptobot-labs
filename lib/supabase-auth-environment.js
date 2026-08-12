const LOCAL_SUPABASE_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Canonicalizes the Supabase Auth origin shared by the build-time deployment
 * gate and the runtime Auth client. Formal production must always use TLS;
 * local HTTP remains available only outside formal production.
 *
 * @param {unknown} value
 * @param {{ allowLocalHttp?: boolean }} [options]
 * @returns {string}
 */
export function canonicalSupabaseAuthUrl(value, { allowLocalHttp = false } = {}) {
  if (typeof value !== "string" || value.length === 0) throw new Error("SUPABASE_URL is required");
  const parsed = new URL(value);
  const localHttp = allowLocalHttp
    && parsed.protocol === "http:"
    && LOCAL_SUPABASE_HOSTNAMES.has(parsed.hostname);
  if ((parsed.protocol !== "https:" && !localHttp)
    || parsed.username
    || parsed.password
    || (parsed.pathname !== "/" && parsed.pathname !== "")
    || parsed.search
    || parsed.hash) {
    throw new Error("SUPABASE_URL is invalid");
  }
  return parsed.origin;
}

/**
 * Accepts only Supabase's low-privilege publishable-key format. In particular,
 * secret/service-role credentials must never be accepted under this binding.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalSupabasePublishableKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 20 || !/^sb_publishable_[A-Za-z0-9_-]+$/u.test(key)) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is invalid");
  }
  return key;
}
