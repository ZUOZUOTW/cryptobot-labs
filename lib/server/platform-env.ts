let runtimeEnvironment: Record<string, unknown> | undefined;

/** Inject platform bindings for the current request (Cloudflare worker path). */
export function setPlatformEnv(environment: Record<string, unknown>) {
  runtimeEnvironment = environment;
}

/**
 * Shared platform environment. Cloudflare injects bindings per request;
 * Netlify falls back to its process environment.
 */
export const env = new Proxy<Record<string, unknown>>({}, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    return runtimeEnvironment?.[property] ?? process.env[property];
  },
});
