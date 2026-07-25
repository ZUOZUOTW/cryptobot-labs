import type { ControlPlaneDatabase } from "../../db";
import { safeCanonicalJsonStringify } from "../control-plane/schemas";
import { DeviceAuthenticationError, sha256Hex, type VerifiedDeviceIdentity } from "./device-signature";
import { HttpProblem, errorResponse, jsonResponse } from "./http";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[0-9a-f]{64}$/;
const MAX_CONFIG_BYTES = 262_144;
const MAX_SOURCE_BYTES = 131_072;
export const MAX_DEPLOYMENT_BUNDLE_BYTES = 524_288;
export const DEPLOYMENT_BUNDLE_CAPABILITY = "agent.deployments.read" as const;

interface BundleRow {
  deploymentId: string;
  deploymentVersion: number;
  strategyVersionId: string;
  mode: "paper" | "futures-demo" | "live";
  state: "stopped" | "running" | "paused" | "error";
  configurationHash: string;
  market: "spot" | "futures";
  symbol: string;
  configHash: string;
  sourceHash: string | null;
  configJson: string;
  sourceCode: string | null;
  riskId: string | null;
  allowedSymbolsJson: string | null;
  maxOrderNotional: string | null;
  maxPositionNotional: string | null;
  maxTotalExposure: string | null;
  maxSimultaneousPositions: number | null;
  maxDailyLoss: string | null;
  maxLeverage: string | null;
  maxSlippageBps: number | null;
  minSignalCooldownMs: number | null;
  maxConsecutiveFailures: number | null;
  operationMode: "approval-required" | "automatic" | null;
  riskUpdatedAt: number | null;
}

export interface AgentDeploymentBundle {
  schemaVersion: 1;
  deployment: {
    id: string; version: number; strategyVersionId: string; mode: "paper" | "futures-demo" | "live";
    state: "stopped" | "running" | "paused" | "error"; configurationHash: string;
  };
  strategy: {
    market: "spot" | "futures"; symbol: string; configHash: string; sourceHash: string | null;
    config: unknown | null; source: string | null;
  };
  risk: {
    id: string; allowedSymbols: string[]; maxOrderNotional: string; maxPositionNotional: string;
    maxTotalExposure: string; maxSimultaneousPositions: number; maxDailyLoss: string; maxLeverage: string;
    maxSlippageBps: number; minSignalCooldownMs: number; maxConsecutiveFailures: number;
    operationMode: "approval-required" | "automatic"; updatedAt: number;
  } | null;
}

/** Integrity hash inside an HTTPS-authenticated response; this is not an offline server signature. */
export interface AgentDeploymentBundleEnvelope { bundle: AgentDeploymentBundle; bundleHash: string }

export class AgentDeploymentBundleError extends Error {
  constructor(readonly category: "deployment-fence" | "invalid-bundle", message: string) {
    super(message);
    this.name = "AgentDeploymentBundleError";
  }
}

const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
const parsedJson = (value: string, label: string, maximumBytes: number): unknown => {
  if (typeof value !== "string" || bytes(value) > maximumBytes) {
    throw new AgentDeploymentBundleError("invalid-bundle", `${label} is invalid`);
  }
  try {
    const parsed: unknown = JSON.parse(value);
    // Reuse the control-plane's detached, credential-field-safe JSON validator.
    safeCanonicalJsonStringify(parsed, label, maximumBytes);
    return parsed;
  } catch (error) {
    if (error instanceof AgentDeploymentBundleError) throw error;
    throw new AgentDeploymentBundleError("invalid-bundle", `${label} is invalid`);
  }
};

const checkedSource = (source: string | null): string | null => {
  if (source === null) return null;
  if (typeof source !== "string" || bytes(source) > MAX_SOURCE_BYTES
    || /\b(?:cred|bst)_[A-Za-z0-9_-]{16,}\b/.test(source)
    || /(?:api[_ -]?(?:secret|key)|access[_ -]?key|secret[_ -]?key|pass[_ -]?phrase)\s*[:=]\s*["'][^"']{8,}["']/i.test(source)) {
    throw new AgentDeploymentBundleError("invalid-bundle", "strategy source is invalid");
  }
  return source;
};

const positive = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) throw new HttpProblem(400, "invalid_request");
  return value;
};

export function createAgentDeploymentBundleService(database: ControlPlaneDatabase) {
  return Object.freeze({
    async get(identity: Pick<VerifiedDeviceIdentity, "userId" | "deviceId">,
      input: { deploymentId: string; expectedVersion: number }): Promise<AgentDeploymentBundleEnvelope> {
      if (!ID.test(input.deploymentId)) throw new HttpProblem(400, "invalid_request");
      const expectedVersion = positive(input.expectedVersion);
      const row = await database.prepare(`SELECT d.id AS deploymentId,d.version AS deploymentVersion,
        d.strategy_version_id AS strategyVersionId,d.mode,d.state,d.configuration_hash AS configurationHash,
        s.market,s.symbol,v.config_hash AS configHash,v.source_hash AS sourceHash,v.config_json AS configJson,
        v.source_code AS sourceCode,r.id AS riskId,r.allowed_symbols_json AS allowedSymbolsJson,
        r.max_order_notional AS maxOrderNotional,r.max_position_notional AS maxPositionNotional,
        r.max_total_exposure AS maxTotalExposure,r.max_simultaneous_positions AS maxSimultaneousPositions,
        r.max_daily_loss AS maxDailyLoss,r.max_leverage AS maxLeverage,r.max_slippage_bps AS maxSlippageBps,
        r.min_signal_cooldown_ms AS minSignalCooldownMs,r.max_consecutive_failures AS maxConsecutiveFailures,
        r.operation_mode AS operationMode,r.updated_at AS riskUpdatedAt
        FROM deployments d
        JOIN devices x ON x.id=d.device_id AND x.user_id=d.user_id AND x.status='active' AND x.revoked_at IS NULL
        JOIN strategy_versions v ON v.id=d.strategy_version_id AND v.user_id=d.user_id
        JOIN strategies s ON s.id=v.strategy_id AND s.user_id=v.user_id
        LEFT JOIN risk_policies r ON r.deployment_id=d.id AND r.user_id=d.user_id
        WHERE d.user_id=? AND d.device_id=? AND d.id=? AND d.version=?`)
        .bind(identity.userId, identity.deviceId, input.deploymentId, expectedVersion).first<BundleRow>();
      if (!row) throw new AgentDeploymentBundleError("deployment-fence", "deployment version is unavailable");
      if (!HASH.test(row.configurationHash) || !HASH.test(row.configHash)
        || (row.sourceHash !== null && !HASH.test(row.sourceHash))) {
        throw new AgentDeploymentBundleError("invalid-bundle", "stored hashes are invalid");
      }
      const config = parsedJson(row.configJson, "strategy config", MAX_CONFIG_BYTES);
      const source = checkedSource(row.sourceCode);
      if ((source === null) !== (row.sourceHash === null)) {
        throw new AgentDeploymentBundleError("invalid-bundle", "strategy source hash is inconsistent");
      }
      const risk = row.riskId === null ? null : (() => {
        const allowedSymbols = parsedJson(row.allowedSymbolsJson ?? "", "allowed symbols", 8_192);
        if (!Array.isArray(allowedSymbols) || allowedSymbols.some((item) => typeof item !== "string")) {
          throw new AgentDeploymentBundleError("invalid-bundle", "risk policy is invalid");
        }
        const required = [row.maxOrderNotional, row.maxPositionNotional, row.maxTotalExposure,
          row.maxDailyLoss, row.maxLeverage, row.operationMode];
        if (required.some((item) => item === null) || row.maxSimultaneousPositions === null
          || row.maxSlippageBps === null || row.minSignalCooldownMs === null
          || row.maxConsecutiveFailures === null || row.riskUpdatedAt === null) {
          throw new AgentDeploymentBundleError("invalid-bundle", "risk policy is invalid");
        }
        return { id: row.riskId!, allowedSymbols: allowedSymbols as string[], maxOrderNotional: row.maxOrderNotional!,
          maxPositionNotional: row.maxPositionNotional!, maxTotalExposure: row.maxTotalExposure!,
          maxSimultaneousPositions: row.maxSimultaneousPositions, maxDailyLoss: row.maxDailyLoss!,
          maxLeverage: row.maxLeverage!, maxSlippageBps: row.maxSlippageBps,
          minSignalCooldownMs: row.minSignalCooldownMs, maxConsecutiveFailures: row.maxConsecutiveFailures,
          operationMode: row.operationMode!, updatedAt: row.riskUpdatedAt };
      })();
      const bundle: AgentDeploymentBundle = { schemaVersion: 1,
        deployment: { id: row.deploymentId, version: row.deploymentVersion,
          strategyVersionId: row.strategyVersionId, mode: row.mode, state: row.state,
          configurationHash: row.configurationHash },
        strategy: { market: row.market, symbol: row.symbol, configHash: row.configHash,
          sourceHash: row.sourceHash, config, source }, risk };
      const canonical = safeCanonicalJsonStringify(bundle, "deployment bundle", MAX_DEPLOYMENT_BUNDLE_BYTES);
      return { bundle, bundleHash: await sha256Hex(canonical) };
    },
  });
}

type Verifier = (input: { headers: Headers; method: string; url: string | URL; body: Uint8Array;
  capability: typeof DEPLOYMENT_BUNDLE_CAPABILITY }) => Promise<VerifiedDeviceIdentity>;

const failure = (error: unknown): Response => {
  if (error instanceof DeviceAuthenticationError) return errorResponse(error, { status: 401, code: "device_authentication_failed" });
  if (error instanceof HttpProblem) return errorResponse(error, { status: error.status, code: error.code });
  if (error instanceof AgentDeploymentBundleError) return errorResponse(error, {
    status: error.category === "deployment-fence" ? 409 : 500,
    code: error.category === "deployment-fence" ? "conflict" : "internal",
  });
  return errorResponse(error, { status: 500, code: "internal" });
};

export function createAgentDeploymentBundleHandler(dependencies: {
  verify: Verifier; service: ReturnType<typeof createAgentDeploymentBundleService>;
}) {
  return async (request: Request, context: { params: { id: string } | Promise<{ id: string }> }): Promise<Response> => {
    try {
      if (request.method !== "GET" || request.body !== null || request.headers.has("content-type")
        || request.headers.has("transfer-encoding")
        || (request.headers.get("content-length") !== null && request.headers.get("content-length") !== "0")) {
        throw new HttpProblem(400, "invalid_request");
      }
      const params = await context.params;
      if (params === null || typeof params !== "object" || Object.keys(params).length !== 1
        || typeof params.id !== "string" || !ID.test(params.id)) throw new HttpProblem(400, "invalid_request");
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => key !== "version")
        || url.searchParams.getAll("version").length !== 1) throw new HttpProblem(400, "invalid_request");
      const versionText = url.searchParams.get("version");
      if (versionText === null || !/^[1-9]\d{0,15}$/.test(versionText)) throw new HttpProblem(400, "invalid_request");
      const body = new Uint8Array();
      const identity = await dependencies.verify({ headers: request.headers, method: "GET", url: request.url,
        body, capability: DEPLOYMENT_BUNDLE_CAPABILITY });
      const envelope = await dependencies.service.get(identity, { deploymentId: params.id, expectedVersion: Number(versionText) });
      const serialized = safeCanonicalJsonStringify(envelope, "deployment bundle response", MAX_DEPLOYMENT_BUNDLE_BYTES);
      return jsonResponse(JSON.parse(serialized));
    } catch (error) { return failure(error); }
  };
}
