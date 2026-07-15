import { requireControlPlaneDatabase } from "../../db/control-plane";
import { createBacktestRepository, createStrategyVersionRepository, createUserRepository } from "../../db/repositories";
import { createFetchTransport, WeexPublicClient } from "../../packages/weex-client/src";
import { deriveWorkspaceUserId, platformIdentityProvider, type PlatformIdentityProvider } from "./auth";
import { createHistoricalBacktestHandlers, createHistoricalBacktestService } from "./backtests";
import { errorResponse } from "./http";
import { createStrategySaveHandler, createStrategySaveService } from "./strategies";

export interface TradingEnvironment {
  DB?: unknown;
  PUBLIC_ORIGIN?: unknown;
  URL?: unknown;
  SUPABASE_DATABASE_URL?: unknown;
  DATABASE_URL?: unknown;
}
export interface TradingRuntimeOptions {
  fetchImpl?: typeof fetch;
  identityProvider?: PlatformIdentityProvider;
  now?: () => number;
  deriveUserId?: (email: string) => Promise<string>;
  newId?: (prefix: string) => string;
}

export function productionTradingFailure(error: unknown): Response {
  const message = error instanceof Error
    ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database-url-redacted]")
    : "Unknown trading runtime error";
  console.error("[trading-runtime] initialization failed", {
    name: error instanceof Error ? error.name : "Error",
    message,
  });
  return errorResponse(error, { status: 500, code: "internal" });
}

export function tradingEnvironmentForRequest(
  environment: TradingEnvironment,
  request: Request,
): TradingEnvironment {
  return {
    DB: environment.DB,
    PUBLIC_ORIGIN: environment.PUBLIC_ORIGIN ?? environment.URL ?? new URL(request.url).origin,
    SUPABASE_DATABASE_URL: environment.SUPABASE_DATABASE_URL,
    DATABASE_URL: environment.DATABASE_URL,
  };
}

export function createProductionTradingHandlers(
  environment: TradingEnvironment,
  options: TradingRuntimeOptions = {},
) {
  if (typeof environment.PUBLIC_ORIGIN !== "string" || environment.PUBLIC_ORIGIN.length < 1) {
    throw new Error("PUBLIC_ORIGIN deployment binding is required");
  }
  let configuredOrigin: URL;
  try { configuredOrigin = new URL(environment.PUBLIC_ORIGIN); }
  catch { throw new Error("PUBLIC_ORIGIN deployment binding is invalid"); }
  const loopback = configuredOrigin.hostname === "localhost" || configuredOrigin.hostname === "127.0.0.1"
    || configuredOrigin.hostname === "[::1]";
  if ((configuredOrigin.protocol !== "https:" && !(configuredOrigin.protocol === "http:" && loopback))
    || configuredOrigin.username || configuredOrigin.password || configuredOrigin.pathname !== "/"
    || configuredOrigin.search || configuredOrigin.hash || configuredOrigin.origin !== environment.PUBLIC_ORIGIN.replace(/\/$/, "")) {
    throw new Error("PUBLIC_ORIGIN deployment binding is invalid");
  }
  const database = requireControlPlaneDatabase(
    environment.DB,
    environment.SUPABASE_DATABASE_URL ?? environment.DATABASE_URL,
  );
  const strategies = createStrategyVersionRepository(database);
  const now = options.now ?? Date.now;
  const idFactory = options.newId ?? ((prefix: string) => `${prefix}_${crypto.randomUUID()}`);
  const auth = { identityProvider: options.identityProvider ?? platformIdentityProvider,
    userRepository: createUserRepository(database), deriveUserId: options.deriveUserId ?? deriveWorkspaceUserId, now };
  const originPolicy = { publicOrigin: configuredOrigin.origin };
  const marketData = new WeexPublicClient(createFetchTransport({ fetchImpl: options.fetchImpl,
    timeoutMs: 10_000, maximumResponseBytes: 2_097_152 }), now);
  const backtestHandlers = createHistoricalBacktestHandlers({ auth, originPolicy,
    service: createHistoricalBacktestService({ backtests: createBacktestRepository(database), strategies, marketData, now,
      newId: (prefix) => idFactory(prefix) }) });
  const strategy = createStrategySaveHandler({ auth, originPolicy,
    service: createStrategySaveService({ repository: strategies, now, newId: (prefix) => idFactory(prefix) }) });
  return { backtests: backtestHandlers, strategy };
}
