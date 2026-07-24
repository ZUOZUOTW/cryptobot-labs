import type { ControlPlaneDatabase } from "@/db";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const SYMBOL = /^[A-Z0-9_]{3,32}$/;

export interface CloudRiskInput {
  allowedSymbols: string[];
  maxOrderNotional: string;
  maxPositionNotional: string;
  maxTotalExposure: string;
  maxSimultaneousPositions: number;
  maxDailyLoss: string;
  maxLeverage: string;
  maxSlippageBps: number;
  minSignalCooldownMs: number;
  maxConsecutiveFailures: number;
  operationMode: "approval-required" | "automatic";
}

export interface CloudRunRow {
  id: string; name: string; mode: "futures-demo" | "live";
  state: "running" | "paused" | "stopped" | "error";
  version: number; lastCandleAt: number | null; lastEvaluatedAt: number | null;
  lastSignalJson: string | Record<string, unknown> | null; lastErrorCode: string | null;
  consecutiveFailures: number; createdAt: number; updatedAt: number;
  allowedSymbols: string[]; accountAsset: string | null; accountObservedAt: number | null;
  accountEquity: string | null; availableEquity: string | null; unrealizedPnl: string | null;
  positionsJson: string | Array<Record<string, unknown>>; evaluationCount: number; signalCount: number;
}

const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

export function parseCloudRisk(value: unknown): CloudRiskInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const risk = value as Record<string, unknown>;
  const keys = ["allowedSymbols", "maxOrderNotional", "maxPositionNotional", "maxTotalExposure",
    "maxSimultaneousPositions", "maxDailyLoss", "maxLeverage", "maxSlippageBps",
    "minSignalCooldownMs", "maxConsecutiveFailures", "operationMode"];
  if (!exact(risk, keys) || !Array.isArray(risk.allowedSymbols) || risk.allowedSymbols.length < 1
    || risk.allowedSymbols.length > 20 || risk.allowedSymbols.some((symbol) => typeof symbol !== "string"
      || !SYMBOL.test(symbol)) || new Set(risk.allowedSymbols).size !== risk.allowedSymbols.length) return null;
  for (const key of ["maxOrderNotional", "maxPositionNotional", "maxTotalExposure", "maxDailyLoss", "maxLeverage"]) {
    if (typeof risk[key] !== "string" || !DECIMAL.test(risk[key] as string) || Number(risk[key]) <= 0) return null;
  }
  for (const [key, maximum] of [["maxSimultaneousPositions", 100], ["maxSlippageBps", 10_000],
    ["minSignalCooldownMs", 86_400_000], ["maxConsecutiveFailures", 100]] as const) {
    if (!Number.isSafeInteger(risk[key]) || Number(risk[key]) < (key === "minSignalCooldownMs" ? 0 : 1)
      || Number(risk[key]) > maximum) return null;
  }
  if (risk.operationMode !== "automatic") return null;
  return risk as unknown as CloudRiskInput;
}

const columns = `id,name,mode,state,version,last_candle_at as lastCandleAt,
  last_evaluated_at as lastEvaluatedAt,last_signal_json as lastSignalJson,last_error_code as lastErrorCode,
  consecutive_failures as consecutiveFailures,created_at as createdAt,updated_at as updatedAt,
  risk_json->'allowedSymbols' as allowedSymbols,account_asset as accountAsset,
  account_observed_at as accountObservedAt,account_equity::text as accountEquity,
  available_equity::text as availableEquity,unrealized_pnl::text as unrealizedPnl,
  positions_json as positionsJson,evaluation_count as evaluationCount,signal_count as signalCount`;

export function createCloudRunRepository(database: ControlPlaneDatabase) {
  return {
    async list(userId: string): Promise<CloudRunRow[]> {
      const result = await database.prepare(`select ${columns} from cloud_strategy_runs
        where user_id=? order by created_at desc limit 100`).bind(userId).all<CloudRunRow>();
      return result.results;
    },
    async create(input: { id: string; userId: string; strategyVersionId: string; name: string;
      configurationHash: string; risk: CloudRiskInput; now: number }): Promise<CloudRunRow | null> {
      if (!ID.test(input.id) || !ID.test(input.userId) || !ID.test(input.strategyVersionId)
        || input.name.trim().length < 1 || input.name.trim().length > 100 || !HASH.test(input.configurationHash)) return null;
      return database.prepare(`insert into cloud_strategy_runs
        (id,user_id,connection_id,executor_shard_id,strategy_version_id,name,mode,state,config_json,risk_json,
         configuration_hash,version,consecutive_failures,created_at,updated_at,started_at)
        select ?,s.user_id,c.id,c.executor_shard_id,s.id,?,'futures-demo','running',s.config_json::jsonb,?::jsonb,
          ?,1,0,?,?,?
        from strategy_versions s join weex_connections c on c.user_id=s.user_id and c.provider='weex'
        where s.user_id=? and s.id=? and s.config_hash=? and c.status='active'
          and c.withdrawal_access_absent=true and c.executor_shard_id is not null
        returning ${columns}`).bind(input.id, input.name.trim(), JSON.stringify(input.risk), input.configurationHash,
          input.now, input.now, input.now, input.userId, input.strategyVersionId, input.configurationHash)
        .first<CloudRunRow>();
    },
    transition(input: { userId: string; id: string; state: "running" | "paused" | "stopped";
      expectedVersion: number; now: number }): Promise<CloudRunRow | null> {
      if (!ID.test(input.userId) || !ID.test(input.id) || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion < 1) return Promise.resolve(null);
      return database.prepare(`update cloud_strategy_runs set state=?,version=version+1,updated_at=?,
        started_at=case when ?='running' then ? else started_at end,
        stopped_at=case when ?='stopped' then ? else stopped_at end,
        last_error_code=case when ?='running' then null else last_error_code end
        where user_id=? and id=? and version=? and state<>'stopped' returning ${columns}`)
        .bind(input.state, input.now, input.state, input.now, input.state, input.now, input.state,
          input.userId, input.id, input.expectedVersion).first<CloudRunRow>();
    },
  };
}
