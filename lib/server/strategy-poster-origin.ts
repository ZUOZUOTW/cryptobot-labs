import { requestOrigin } from "../site-metadata";

type HeaderReader = Pick<Headers, "get">;

export interface StrategyPosterOriginInput {
  publicOrigin: unknown;
  nodeEnv: string | undefined;
  requestHeaders: HeaderReader;
}

const isLoopback = (hostname: string): boolean => (
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
);

const configuredPublicOrigin = (value: unknown): URL | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_ORIGIN is invalid for strategy poster assets");
  }
  const loopbackHttp = parsed.protocol === "http:" && isLoopback(parsed.hostname);
  if ((parsed.protocol !== "https:" && !loopbackHttp)
    || parsed.username || parsed.password
    || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_ORIGIN is invalid for strategy poster assets");
  }
  return new URL(parsed.origin);
};

/**
 * Production poster rendering only fetches assets from a deployment-controlled
 * origin. Request Host is considered solely for a local loopback dev server.
 */
export function resolveStrategyPosterAssetOrigin(input: StrategyPosterOriginInput): URL {
  const configured = configuredPublicOrigin(input.publicOrigin);
  if (configured) return configured;

  if (input.nodeEnv !== "production") {
    const localOrigin = requestOrigin(input.requestHeaders);
    if (localOrigin && isLoopback(localOrigin.hostname)) return localOrigin;
  }

  throw new Error("PUBLIC_ORIGIN is required for strategy poster assets");
}
