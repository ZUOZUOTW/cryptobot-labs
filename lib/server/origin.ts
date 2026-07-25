import { HttpProblem } from "./http";

export interface OriginPolicy {
  publicOrigin: string;
  trustedProxy?: { enabled: true; allowedHosts: readonly string[] };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const authority = (value: string | null): string | null => {
  if (!value || /[\u0000-\u0020\u007f,\\/?#@%]/.test(value)) return null;
  try { return new URL(`https://${value}`).host.toLowerCase(); } catch { return null; }
};
const configuredOrigin = (value: string): URL => {
  let url: URL;
  try { url = new URL(value); } catch { throw new TypeError("publicOrigin is invalid"); }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash || url.origin !== value.replace(/\/$/, "")) {
    throw new TypeError("publicOrigin must be an absolute origin");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol === "http:" && !loopback) throw new TypeError("HTTP publicOrigin is allowed only for loopback");
  return url;
};

export function requireSameOrigin(request: Request, policy: OriginPolicy): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;
  const expected = configuredOrigin(policy.publicOrigin);
  let effectiveHost: string | null;
  if (policy.trustedProxy?.enabled) {
    const forwardedHost = authority(request.headers.get("x-forwarded-host"));
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.toLowerCase();
    const allowed = new Set(policy.trustedProxy.allowedHosts.map((host) => host.toLowerCase()));
    if (!forwardedHost || !allowed.has(forwardedHost) || forwardedProtocol !== expected.protocol.slice(0, -1)) {
      throw new HttpProblem(403, "forbidden_origin");
    }
    effectiveHost = forwardedHost;
  } else {
    effectiveHost = authority(request.headers.get("host"));
  }
  if (effectiveHost !== expected.host.toLowerCase()) throw new HttpProblem(403, "forbidden_origin");
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (origin === "null") throw new HttpProblem(403, "forbidden_origin");
    let supplied: URL;
    try { supplied = new URL(origin); } catch { throw new HttpProblem(403, "forbidden_origin"); }
    if (supplied.origin !== expected.origin || supplied.href !== `${supplied.origin}/`) throw new HttpProblem(403, "forbidden_origin");
    return;
  }
  if (request.headers.get("sec-fetch-site") !== "same-origin") throw new HttpProblem(403, "forbidden_origin");
}
