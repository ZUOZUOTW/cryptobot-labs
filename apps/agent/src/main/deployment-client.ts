import type { ControlDeviceIdentity } from "./control-client";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const SYMBOL = /^[A-Z0-9][A-Z0-9._:-]{1,63}$/;
const MAX_RESPONSE_BYTES = 524_288;
const encoder = new TextEncoder();

export interface DeploymentBundle {
  readonly schemaVersion: 1;
  readonly deployment: Readonly<{ id: string; version: number; strategyVersionId: string;
    mode: "paper" | "futures-demo" | "live"; state: "stopped" | "running" | "paused" | "error";
    configurationHash: string }>;
  readonly strategy: Readonly<{ market: "spot" | "futures"; symbol: string; configHash: string;
    sourceHash: string | null; config: unknown | null; source: string | null }>;
  readonly risk: Readonly<{ id: string; allowedSymbols: readonly string[]; maxOrderNotional: string;
    maxPositionNotional: string; maxTotalExposure: string; maxSimultaneousPositions: number;
    maxDailyLoss: string; maxLeverage: string; maxSlippageBps: number; minSignalCooldownMs: number;
    maxConsecutiveFailures: number; operationMode: "approval-required" | "automatic"; updatedAt: number }> | null;
}

export class DeploymentClientError extends Error {
  constructor(message: string, readonly code: "invalid" | "network" | "revoked" | "deployment-fence" = "invalid") {
    super(message); this.name = "DeploymentClientError";
  }
}

export interface DeploymentClientOptions {
  baseUrl: string;
  identity: ControlDeviceIdentity | (() => ControlDeviceIdentity | Promise<ControlDeviceIdentity>);
  fetch?: typeof fetch;
  crypto?: Pick<Crypto, "subtle" | "getRandomValues">;
  now?: () => number;
  requestTimeoutMs?: number;
  onRevoked?: () => void | Promise<void>;
}

// The device signs the request. Response provenance is authenticated by pinned
// HTTPS origin validation; bundleHash detects corruption but is not a signature.

const plain = (value: unknown, label: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) throw new DeploymentClientError(`${label} is invalid`);
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: readonly string[], label: string): void => {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))
    || keys.some((key) => !Object.hasOwn(value, key))) throw new DeploymentClientError(`${label} is invalid`);
};
const identifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !ID.test(value)) throw new DeploymentClientError(`${label} is invalid`);
  return value;
};
const integer = (value: unknown, label: string, minimum = 0): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new DeploymentClientError(`${label} is invalid`);
  return value as number;
};
const hash = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !HASH.test(value)) throw new DeploymentClientError(`${label} is invalid`);
  return value;
};
const decimal = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length > 128 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new DeploymentClientError(`${label} is invalid`);
  }
  return value;
};

function cloneJson(value: unknown, depth = 0, nodes = { count: 0 }): unknown {
  nodes.count += 1;
  if (depth > 32 || nodes.count > 4_096) throw new DeploymentClientError("bundle JSON is too complex");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new DeploymentClientError("bundle JSON number is invalid");
    return value;
  }
  if (typeof value !== "object" || value === null) throw new DeploymentClientError("bundle JSON value is invalid");
  if (Array.isArray(value)) return value.map((item) => cloneJson(item, depth + 1, nodes));
  const record = plain(value, "bundle JSON object");
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      throw new DeploymentClientError("bundle JSON field is invalid");
    }
    output[key] = cloneJson(record[key], depth + 1, nodes);
  }
  return output;
}

function canonicalJson(value: unknown): string {
  const serialize = (item: unknown): string => {
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") return JSON.stringify(item);
    if (Array.isArray(item)) return `[${item.map(serialize).join(",")}]`;
    const record = item as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${serialize(record[key])}`).join(",")}}`;
  };
  return serialize(cloneJson(value));
}

const hex = (value: Uint8Array): string => [...value].map((item) => item.toString(16).padStart(2, "0")).join("");
const digest = async (value: Uint8Array | string, implementation: Pick<Crypto, "subtle">): Promise<string> =>
  hex(new Uint8Array(await implementation.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : Uint8Array.from(value))));

function parseBundle(raw: unknown): { bundle: DeploymentBundle; bundleHash: string } {
  const envelope = plain(raw, "deployment bundle envelope"); exact(envelope, ["bundle", "bundleHash"], "deployment bundle envelope");
  const bundle = plain(envelope.bundle, "deployment bundle"); exact(bundle, ["schemaVersion", "deployment", "strategy", "risk"], "deployment bundle");
  if (bundle.schemaVersion !== 1) throw new DeploymentClientError("deployment bundle version is unsupported");
  const deployment = plain(bundle.deployment, "deployment");
  exact(deployment, ["id", "version", "strategyVersionId", "mode", "state", "configurationHash"], "deployment");
  const mode = deployment.mode;
  if (mode !== "paper" && mode !== "futures-demo" && mode !== "live") throw new DeploymentClientError("deployment mode is invalid");
  const state = deployment.state;
  if (state !== "stopped" && state !== "running" && state !== "paused" && state !== "error") throw new DeploymentClientError("deployment state is invalid");
  const strategy = plain(bundle.strategy, "strategy");
  exact(strategy, ["market", "symbol", "configHash", "sourceHash", "config", "source"], "strategy");
  if ((strategy.market !== "spot" && strategy.market !== "futures") || typeof strategy.symbol !== "string" || !SYMBOL.test(strategy.symbol)) {
    throw new DeploymentClientError("strategy is invalid");
  }
  const market: "spot" | "futures" = strategy.market;
  const sourceHash = strategy.sourceHash === null ? null : hash(strategy.sourceHash, "source hash");
  if ((strategy.source === null) !== (sourceHash === null) || (strategy.source !== null && typeof strategy.source !== "string")) {
    throw new DeploymentClientError("strategy source is invalid");
  }
  const risk = bundle.risk === null ? null : (() => {
    const item = plain(bundle.risk, "risk policy");
    exact(item, ["id", "allowedSymbols", "maxOrderNotional", "maxPositionNotional", "maxTotalExposure",
      "maxSimultaneousPositions", "maxDailyLoss", "maxLeverage", "maxSlippageBps", "minSignalCooldownMs",
      "maxConsecutiveFailures", "operationMode", "updatedAt"], "risk policy");
    if (!Array.isArray(item.allowedSymbols) || item.allowedSymbols.length < 1 || item.allowedSymbols.length > 100
      || item.allowedSymbols.some((symbol) => typeof symbol !== "string" || !SYMBOL.test(symbol))
      || new Set(item.allowedSymbols).size !== item.allowedSymbols.length
      || (item.operationMode !== "approval-required" && item.operationMode !== "automatic")) {
      throw new DeploymentClientError("risk policy is invalid");
    }
    return Object.freeze({ id: identifier(item.id, "risk policy id"), allowedSymbols: Object.freeze([...item.allowedSymbols]) as readonly string[],
      maxOrderNotional: decimal(item.maxOrderNotional, "maximum order notional"),
      maxPositionNotional: decimal(item.maxPositionNotional, "maximum position notional"),
      maxTotalExposure: decimal(item.maxTotalExposure, "maximum exposure"),
      maxSimultaneousPositions: integer(item.maxSimultaneousPositions, "maximum positions"),
      maxDailyLoss: decimal(item.maxDailyLoss, "maximum daily loss"), maxLeverage: decimal(item.maxLeverage, "maximum leverage"),
      maxSlippageBps: integer(item.maxSlippageBps, "maximum slippage"),
      minSignalCooldownMs: integer(item.minSignalCooldownMs, "signal cooldown"),
      maxConsecutiveFailures: integer(item.maxConsecutiveFailures, "maximum failures"),
      operationMode: item.operationMode, updatedAt: integer(item.updatedAt, "risk policy time") });
  })();
  const normalized: DeploymentBundle = Object.freeze({ schemaVersion: 1,
    deployment: Object.freeze({ id: identifier(deployment.id, "deployment id"), version: integer(deployment.version, "deployment version", 1),
      strategyVersionId: identifier(deployment.strategyVersionId, "strategy version id"), mode, state,
      configurationHash: hash(deployment.configurationHash, "configuration hash") }),
    strategy: Object.freeze({ market, symbol: strategy.symbol, configHash: hash(strategy.configHash, "config hash"),
      sourceHash, config: cloneJson(strategy.config), source: strategy.source as string | null }), risk });
  return { bundle: normalized, bundleHash: hash(envelope.bundleHash, "bundle hash") };
}

async function boundedJson(response: Response, timeout: ReturnType<typeof setTimeout>): Promise<unknown> {
  try {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type")?.trim() ?? "")) {
      throw new DeploymentClientError("deployment bundle response type is invalid");
    }
    const length = response.headers.get("content-length");
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
      throw new DeploymentClientError("deployment bundle response is too large");
    }
    if (!response.body) throw new DeploymentClientError("deployment bundle response is empty");
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new DeploymentClientError("deployment bundle response is too large"); }
        chunks.push(next.value);
      }
    } finally { reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
    catch { throw new DeploymentClientError("deployment bundle response is invalid"); }
  } finally { clearTimeout(timeout); }
}

export function createDeploymentClient(options: DeploymentClientOptions) {
  let base: URL;
  try { base = new URL(options.baseUrl); } catch { throw new DeploymentClientError("control-plane URL is invalid"); }
  const loopback = base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if ((base.protocol !== "https:" && !loopback) || base.username || base.password || base.search || base.hash) {
    throw new DeploymentClientError("control-plane URL must be HTTPS");
  }
  const implementation = options.crypto ?? crypto;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 100 || requestTimeoutMs > 60_000) {
    throw new DeploymentClientError("request timeout is invalid");
  }
  let nonceCounter = 0;
  const loadIdentity = async (): Promise<ControlDeviceIdentity> => {
    const identity = typeof options.identity === "function" ? await options.identity() : options.identity;
    if (!identity || !ID.test(identity.deviceId) || !/^cred_[A-Za-z0-9_-]{43}$/.test(identity.credential)
      || !Number.isSafeInteger(identity.credentialExpiresAt) || identity.credentialExpiresAt <= now()) {
      await options.onRevoked?.(); throw new DeploymentClientError("device authorization is no longer valid", "revoked");
    }
    return identity;
  };
  return Object.freeze({
    async fetchBundle(deploymentId: string, expectedVersion: number): Promise<DeploymentBundle> {
      identifier(deploymentId, "deployment id"); integer(expectedVersion, "deployment version", 1);
      const identity = await loadIdentity();
      const url = new URL(`/api/agent/deployments/${encodeURIComponent(deploymentId)}?version=${expectedVersion}`, base);
      const timestamp = now();
      nonceCounter += 1;
      const random = new Uint8Array(24); implementation.getRandomValues(random);
      const nonce = `nonce_${Buffer.from(random).toString("base64url")}_${nonceCounter.toString(36)}`;
      const bodyHash = await digest(new Uint8Array(), implementation);
      const canonical = `GET\n${url.pathname}${url.search}\n${timestamp}\n${nonce}\n${bodyHash}`;
      const signature = await identity.sign(encoder.encode(canonical));
      if (!(signature instanceof Uint8Array) || signature.byteLength !== 64) throw new DeploymentClientError("device signer is invalid");
      const headers = new Headers({ Authorization: `Device ${identity.credential}`, "X-CBL-Device-Id": identity.deviceId,
        "X-CBL-Device-Timestamp": String(timestamp), "X-CBL-Device-Nonce": nonce,
        "X-CBL-Device-Signature": Buffer.from(signature).toString("base64url") });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
      let response: Response;
      try {
        response = await fetcher(url.href, { method: "GET", headers, signal: controller.signal, redirect: "error",
          credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      } catch { clearTimeout(timeout); throw new DeploymentClientError("deployment bundle request failed", "network"); }
      if (response.status === 401 || response.status === 403) {
        clearTimeout(timeout); await options.onRevoked?.();
        throw new DeploymentClientError("device authorization is no longer valid", "revoked");
      }
      if (response.status === 409) { clearTimeout(timeout); throw new DeploymentClientError("deployment version does not match", "deployment-fence"); }
      if (!response.ok) { clearTimeout(timeout); throw new DeploymentClientError("deployment bundle request failed", "network"); }
      const parsed = parseBundle(await boundedJson(response, timeout));
      if (parsed.bundle.deployment.id !== deploymentId || parsed.bundle.deployment.version !== expectedVersion) {
        throw new DeploymentClientError("deployment bundle identity does not match", "deployment-fence");
      }
      if (await digest(canonicalJson(parsed.bundle), implementation) !== parsed.bundleHash) {
        throw new DeploymentClientError("deployment bundle hash does not match");
      }
      if (await digest(canonicalJson(parsed.bundle.strategy.config), implementation) !== parsed.bundle.strategy.configHash) {
        throw new DeploymentClientError("strategy config hash does not match");
      }
      if (parsed.bundle.strategy.source !== null
        && await digest(parsed.bundle.strategy.source, implementation) !== parsed.bundle.strategy.sourceHash) {
        throw new DeploymentClientError("strategy source hash does not match");
      }
      return parsed.bundle;
    },
  });
}
