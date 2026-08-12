import type { ControlPlaneDatabase } from "@/db";
import { canonicalizeWeexSymbol } from "@cryptobot-labs/weex-client";
import {
  hasFormalBacktestEvidence,
  type FormalEvidenceGateRow,
} from "./formal-evidence-gate";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

const compareOrderDecimals = (left: string, right: string): -1 | 0 | 1 => {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger! + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger! + rightFraction.padEnd(scale, "0"));
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
};

const validOrderFillState = (
  status: CloudOrderProviderStatus,
  quantity: string,
  cumulativeFilledQuantity: string,
): boolean => {
  const versusZero = compareOrderDecimals(cumulativeFilledQuantity, "0");
  const versusQuantity = compareOrderDecimals(cumulativeFilledQuantity, quantity);
  if (compareOrderDecimals(quantity, "0") <= 0 || versusQuantity > 0) return false;
  if (status === "NEW" || status === "REJECTED") return versusZero === 0;
  if (status === "PARTIALLY_FILLED") return versusZero > 0 && versusQuantity < 0;
  if (status === "FILLED") return versusQuantity === 0;
  return status === "CANCELED";
};

export const CLOUD_RUN_TARGET_CONFLICT = Object.freeze({
  error: "cloud_run_target_conflict",
  message: "Another non-stopped cloud strategy already controls this WEEX account, market, and symbol. Stop it before starting this strategy.",
});
export const CLOUD_RUN_ORDER_IN_FLIGHT = Object.freeze({
  error: "cloud_run_order_in_flight",
  message: "This strategy still has an order awaiting authoritative exchange settlement. It remains non-stopped and retains its trading target.",
});

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
  market: "spot" | "futures"; symbol: string;
  version: number; lastCandleAt: number | null; lastEvaluatedAt: number | null;
  lastSignalJson: string | Record<string, unknown> | null; lastErrorCode: string | null;
  consecutiveFailures: number; createdAt: number; updatedAt: number;
  allowedSymbols: string[]; accountAsset: string | null; accountObservedAt: number | null;
  accountEquity: string | null; availableEquity: string | null; unrealizedPnl: string | null;
  positionsJson: string | Array<Record<string, unknown>>; evaluationCount: number; signalCount: number;
  maxTotalExposure: string | null; maxDailyLoss: string | null;
}
export interface CloudAccountRow {
  connectionId: string;
  connectionStatus: "active" | "pending" | "processing" | "reauthorization_required" | "revoked" | "error";
  syncStatus: "pending" | "ready" | "error" | null;
  accountUid: string | null;
  observedAt: number | null;
  balancesJson: string | Array<Record<string, unknown>> | null;
  positionsJson: string | Array<Record<string, unknown>> | null;
  accountEquity: string | null;
  availableEquity: string | null;
  unrealizedPnl: string | null;
  lastErrorCode: string | null;
  permissionsJson: string | Record<string, unknown>;
  withdrawalAccessAbsent: boolean;
}
export interface RealizedPnlPointRow {
  observedAt: number;
  netPnl: string;
  cumulativeNetPnl: string;
  tradeCount: number;
}
export interface RealizedPnlSeries {
  total: string;
  tradeCount: number;
  points: RealizedPnlPointRow[];
}
export type CloudOrderLifecycleStatus = "claimed" | "risk-rejected" | "acknowledged" | "rejected" | "unknown";
export type CloudOrderEvidenceLevel = "authoritative" | "uncertain" | "pending" | "control-plane";
export type CloudOrderProviderStatus = "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED";
export interface CloudOrderFillEvidence {
  exchangeFillId: string;
  price: string;
  quantity: string;
  fee: string;
  feeCurrency: string;
  realizedPnl: string | null;
  filledAt: number;
}
export interface CloudOrderEvidence {
  runId: string;
  candleCloseAt: number;
  createdAt: number;
  updatedAt: number;
  lifecycleStatus: CloudOrderLifecycleStatus;
  evidenceLevel: CloudOrderEvidenceLevel;
  errorCode: string | null;
  clientOrderId: string | null;
  exchangeOrderId: string | null;
  symbol: string;
  side: "buy" | "sell" | null;
  quantity: string | null;
  requestedPrice: string | null;
  providerStatus: CloudOrderProviderStatus | null;
  cumulativeFilledQuantity: string | null;
  averageFillPrice: string | null;
  fees: string | null;
  fills: CloudOrderFillEvidence[];
  evidenceObservedAt: number | null;
}
interface CloudOrderEvidenceQueryRow extends Omit<CloudOrderEvidence, "fills"> {
  fillsJson: unknown;
}
export type CloudRunMode = "futures-demo" | "live";
interface RealizedPnlQueryRow extends RealizedPnlPointRow {
  overallNetPnl: string;
  overallTradeCount: number;
}

const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

export function isRecentLiveConfirmation(value: unknown, now: number): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(now)) return false;
  const confirmation = value as Record<string, unknown>;
  if (!exact(confirmation, ["acknowledged", "acceptedAt"]) || confirmation.acknowledged !== true
    || !Number.isSafeInteger(confirmation.acceptedAt)) return false;
  const acceptedAt = confirmation.acceptedAt as number;
  return acceptedAt <= now + 30_000 && now - acceptedAt <= 10 * 60_000;
}

export function parseCloudRisk(value: unknown): CloudRiskInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const risk = value as Record<string, unknown>;
  const keys = ["allowedSymbols", "maxOrderNotional", "maxPositionNotional", "maxTotalExposure",
    "maxSimultaneousPositions", "maxDailyLoss", "maxLeverage", "maxSlippageBps",
    "minSignalCooldownMs", "maxConsecutiveFailures", "operationMode"];
  if (!exact(risk, keys) || !Array.isArray(risk.allowedSymbols) || risk.allowedSymbols.length < 1
    || risk.allowedSymbols.length > 20) return null;
  const allowedSymbols = risk.allowedSymbols.map(canonicalizeWeexSymbol);
  if (allowedSymbols.some((symbol) => symbol === null)) return null;
  const uniqueAllowedSymbols = [...new Set(allowedSymbols as string[])];
  for (const key of ["maxOrderNotional", "maxPositionNotional", "maxTotalExposure", "maxDailyLoss", "maxLeverage"]) {
    if (typeof risk[key] !== "string" || !DECIMAL.test(risk[key] as string) || Number(risk[key]) <= 0) return null;
  }
  for (const [key, maximum] of [["maxSimultaneousPositions", 100], ["maxSlippageBps", 10_000],
    ["minSignalCooldownMs", 86_400_000], ["maxConsecutiveFailures", 100]] as const) {
    if (!Number.isSafeInteger(risk[key]) || Number(risk[key]) < (key === "minSignalCooldownMs" ? 0 : 1)
      || Number(risk[key]) > maximum) return null;
  }
  if (risk.operationMode !== "automatic") return null;
  return { ...risk, allowedSymbols: uniqueAllowedSymbols } as unknown as CloudRiskInput;
}

const columns = `id,name,mode,state,config_json->>'market' as market,config_json->>'symbol' as symbol,
  version,last_candle_at as lastCandleAt,
  last_evaluated_at as lastEvaluatedAt,last_signal_json as lastSignalJson,last_error_code as lastErrorCode,
  consecutive_failures as consecutiveFailures,created_at as createdAt,updated_at as updatedAt,
  risk_json->'allowedSymbols' as allowedSymbols,account_asset as accountAsset,
  risk_json->>'maxTotalExposure' as maxTotalExposure,risk_json->>'maxDailyLoss' as maxDailyLoss,
  account_observed_at as accountObservedAt,account_equity::text as accountEquity,
  available_equity::text as availableEquity,unrealized_pnl::text as unrealizedPnl,
  positions_json as positionsJson,evaluation_count as evaluationCount,signal_count as signalCount`;

const normalizeCloudRunRow = (row: CloudRunRow): CloudRunRow => {
  const symbol = canonicalizeWeexSymbol(row.symbol);
  const allowedSymbols = Array.isArray(row.allowedSymbols)
    ? [...new Set(row.allowedSymbols.map(canonicalizeWeexSymbol).filter((item): item is string => item !== null))]
    : row.allowedSymbols;
  return { ...row, ...(symbol ? { symbol } : {}), allowedSymbols };
};

const ORDER_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const ORDER_SYMBOL = /^[A-Z0-9_]{3,32}$/;
const ORDER_DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const ORDER_SIGNED_DECIMAL = /^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;
const cloudOrderArray = (value: unknown): unknown[] | null => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};
const optionalOrderText = (value: unknown, pattern: RegExp): string | null | undefined =>
  value === null ? null : typeof value === "string" && pattern.test(value) ? value : undefined;
const orderTimestamp = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value)
    ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};
const normalizeCloudOrderEvidence = (row: CloudOrderEvidenceQueryRow): CloudOrderEvidence => {
  const lifecycleStatuses: readonly CloudOrderLifecycleStatus[] = [
    "claimed", "risk-rejected", "acknowledged", "rejected", "unknown",
  ];
  const evidenceLevels: readonly CloudOrderEvidenceLevel[] = [
    "authoritative", "uncertain", "pending", "control-plane",
  ];
  const providerStatuses: readonly CloudOrderProviderStatus[] = [
    "NEW", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED",
  ];
  const candleCloseAt = orderTimestamp(row.candleCloseAt);
  const createdAt = orderTimestamp(row.createdAt);
  const updatedAt = orderTimestamp(row.updatedAt);
  const evidenceObservedAt = row.evidenceObservedAt === null ? null : orderTimestamp(row.evidenceObservedAt);
  const clientOrderId = optionalOrderText(row.clientOrderId, ORDER_ID);
  const exchangeOrderId = optionalOrderText(row.exchangeOrderId, ORDER_ID);
  const quantity = optionalOrderText(row.quantity, ORDER_DECIMAL);
  const requestedPrice = optionalOrderText(row.requestedPrice, ORDER_DECIMAL);
  const cumulativeFilledQuantity = optionalOrderText(row.cumulativeFilledQuantity, ORDER_DECIMAL);
  const averageFillPrice = optionalOrderText(row.averageFillPrice, ORDER_DECIMAL);
  const fees = optionalOrderText(row.fees, ORDER_DECIMAL);
  const fillsJson = cloudOrderArray(row.fillsJson);
  const fills = fillsJson?.map((value): CloudOrderFillEvidence | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fill = value as Record<string, unknown>;
    const filledAt = orderTimestamp(fill.filledAt);
    const realizedPnl = optionalOrderText(fill.realizedPnl ?? null, ORDER_SIGNED_DECIMAL);
    if (typeof fill.exchangeFillId !== "string" || !ORDER_ID.test(fill.exchangeFillId)
      || typeof fill.price !== "string" || !ORDER_DECIMAL.test(fill.price)
      || typeof fill.quantity !== "string" || !ORDER_DECIMAL.test(fill.quantity)
      || typeof fill.fee !== "string" || !ORDER_DECIMAL.test(fill.fee)
      || typeof fill.feeCurrency !== "string" || !/^[A-Z0-9]{1,16}$/.test(fill.feeCurrency)
      || filledAt === null || realizedPnl === undefined) return null;
    return { exchangeFillId: fill.exchangeFillId, price: fill.price, quantity: fill.quantity,
      fee: fill.fee, feeCurrency: fill.feeCurrency, realizedPnl, filledAt };
  }) ?? null;
  const authoritative = row.evidenceLevel === "authoritative";
  if (typeof row.runId !== "string" || !ID.test(row.runId)
    || candleCloseAt === null || createdAt === null || updatedAt === null
    || !lifecycleStatuses.includes(row.lifecycleStatus)
    || !evidenceLevels.includes(row.evidenceLevel)
    || (row.errorCode !== null && (typeof row.errorCode !== "string" || !/^[a-z0-9_-]{1,64}$/.test(row.errorCode)))
    || clientOrderId === undefined || exchangeOrderId === undefined
    || typeof row.symbol !== "string" || !ORDER_SYMBOL.test(row.symbol)
    || (row.side !== null && row.side !== "buy" && row.side !== "sell")
    || quantity === undefined || requestedPrice === undefined
    || (row.providerStatus !== null && !providerStatuses.includes(row.providerStatus))
    || cumulativeFilledQuantity === undefined || averageFillPrice === undefined || fees === undefined
    || !fills || fills.some((fill) => fill === null)
    || new Set((fills as CloudOrderFillEvidence[]).map(({ exchangeFillId: id }) => id)).size !== fills.length
    || (authoritative && (row.providerStatus === null || evidenceObservedAt === null
      || clientOrderId === null || exchangeOrderId === null || row.side === null || quantity === null
      || cumulativeFilledQuantity === null
      || !validOrderFillState(row.providerStatus, quantity, cumulativeFilledQuantity)))
    || (!authoritative && (row.providerStatus !== null || evidenceObservedAt !== null
      || cumulativeFilledQuantity !== null || averageFillPrice !== null || fees !== null || fills.length > 0))) {
    throw new Error("Cloud order evidence projection is invalid");
  }
  return { runId: row.runId, candleCloseAt, createdAt, updatedAt,
    lifecycleStatus: row.lifecycleStatus, evidenceLevel: row.evidenceLevel,
    errorCode: row.errorCode, clientOrderId, exchangeOrderId, symbol: row.symbol, side: row.side,
    quantity, requestedPrice, providerStatus: row.providerStatus, cumulativeFilledQuantity,
    averageFillPrice, fees, fills: fills as CloudOrderFillEvidence[], evidenceObservedAt };
};

export function createCloudRunRepository(database: ControlPlaneDatabase) {
  return {
    async list(userId: string): Promise<CloudRunRow[]> {
      const result = await database.prepare(`with non_stopped as (
          select ${columns} from cloud_strategy_runs
          where user_id=? and state<>'stopped'
        ), stopped_history as (
          select ${columns} from cloud_strategy_runs
          where user_id=? and state='stopped'
          order by created_at desc,id desc limit 100
        )
        select * from non_stopped
        union all
        select * from stopped_history
        order by "createdAt" desc,id desc`).bind(userId, userId).all<CloudRunRow>();
      return result.results.map(normalizeCloudRunRow);
    },
    account(userId: string): Promise<CloudAccountRow | null> {
      return database.prepare(`select c.id as connectionId,c.status as connectionStatus,
        c.permissions_json as permissionsJson,c.withdrawal_access_absent as withdrawalAccessAbsent,
        s.status as syncStatus,s.account_uid as accountUid,s.observed_at as observedAt,
        s.balances_json as balancesJson,s.positions_json as positionsJson,
        s.account_equity::text as accountEquity,s.available_equity::text as availableEquity,
        s.unrealized_pnl::text as unrealizedPnl,s.last_error_code as lastErrorCode
        from weex_connections c left join weex_account_snapshots s
          on s.connection_id=c.id and s.user_id=c.user_id
        where c.user_id=? and c.provider='weex'
        order by case when c.status='active' then 0 else 1 end,c.updated_at desc limit 1`)
        .bind(userId).first<CloudAccountRow>();
    },
    async realizedPnl(userId: string, connectionId: string): Promise<RealizedPnlSeries> {
      const result = await database.prepare(`with daily as (
          select ((traded_at+28800000)/86400000)*86400000-28800000 as observed_at,
            sum(net_pnl) as net_pnl,cast(count(*) as bigint) as trade_count
          from weex_realized_pnl_ledger
          where user_id=? and connection_id=?
          group by ((traded_at+28800000)/86400000)*86400000-28800000
        ), cumulative as (
          select observed_at,net_pnl,trade_count,
            sum(net_pnl) over(order by observed_at rows between unbounded preceding and current row)
              as cumulative_net_pnl,
            sum(net_pnl) over() as overall_net_pnl,
            cast(sum(trade_count) over() as bigint) as overall_trade_count
          from daily
        ), latest as (
          select * from cumulative order by observed_at desc limit 366
        )
        select observed_at as observedAt,cast(net_pnl as text) as netPnl,
          cast(cumulative_net_pnl as text) as cumulativeNetPnl,trade_count as tradeCount,
          cast(overall_net_pnl as text) as overallNetPnl,overall_trade_count as overallTradeCount
        from latest order by observed_at asc`).bind(userId, connectionId).all<RealizedPnlQueryRow>();
      const totals = result.results.at(-1);
      return {
        total: totals?.overallNetPnl ?? "0",
        tradeCount: totals?.overallTradeCount ?? 0,
        points: result.results.map((point) => ({
          observedAt: point.observedAt,
          netPnl: point.netPnl,
          cumulativeNetPnl: point.cumulativeNetPnl,
          tradeCount: point.tradeCount,
        })),
      };
    },
    async orders(userId: string, runId: string, limit = 20): Promise<CloudOrderEvidence[]> {
      if (!ID.test(userId) || !ID.test(runId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return [];
      // Cloud execution is a PostgreSQL-only production surface. D1 fixtures
      // have no private schema and therefore no order evidence to project.
      if (database.dialect !== "postgres") return [];
      const result = await database.prepare(`select
          run_id as runId,candle_close_at as candleCloseAt,created_at as createdAt,
          updated_at as updatedAt,lifecycle_status as lifecycleStatus,
          evidence_level as evidenceLevel,error_code as errorCode,
          client_order_id as clientOrderId,exchange_order_id as exchangeOrderId,
          symbol,side,quantity,requested_price as requestedPrice,
          provider_status as providerStatus,
          cumulative_filled_quantity as cumulativeFilledQuantity,
          average_fill_price as averageFillPrice,fees,fills_json as fillsJson,
          evidence_observed_at as evidenceObservedAt
        from private.list_cloud_run_order_evidence(?,?,?)`)
        .bind(userId, runId, limit).all<CloudOrderEvidenceQueryRow>();
      return result.results.map(normalizeCloudOrderEvidence);
    },
    async create(input: { id: string; userId: string; strategyVersionId: string; name: string;
      configurationHash: string; mode: CloudRunMode; risk: CloudRiskInput; now: number }): Promise<CloudRunRow | null> {
      if (!ID.test(input.id) || !ID.test(input.userId) || !ID.test(input.strategyVersionId)
        || input.name.trim().length < 1 || input.name.trim().length > 100 || !HASH.test(input.configurationHash)) return null;
      const evidence = await database.prepare(`select
          s.id as strategyVersionId,s.config_hash as configHash,s.source_hash as sourceHash,
          s.config_json as configJson,s.source_code as sourceCode,
          j.id as jobId,j.status as jobStatus,j.evidence_level as jobEvidenceLevel,
          j.request_json as requestJson,j.completed_at as completedAt,
          d.id as datasetId,d.market as datasetMarket,d.symbol as datasetSymbol,
          d.interval as datasetInterval,d.source as datasetSource,
          d.requested_start_at as requestedStartAt,d.requested_end_at as requestedEndAt,
          d.actual_start_at as actualStartAt,d.actual_end_at as actualEndAt,
          d.complete as datasetComplete,d.gaps_json as gapsJson,d.checksum,
          r.id as resultId,r.evidence_level as resultEvidenceLevel,
          r.initial_capital as initialCapital,r.fee_rate as feeRate,
          r.slippage_rate as slippageRate,r.leverage,r.funding_json as fundingJson,
          r.metrics_json as metricsJson,r.provenance_json as provenanceJson,
          r.equity_curve_json as equityCurveJson,r.engine_version as engineVersion,
          r.configuration_hash as configurationHash,r.strategy_hash as strategyHash,
          r.script_hash as scriptHash
        from strategy_versions s
        join backtest_jobs j on j.user_id=s.user_id and j.strategy_version_id=s.id
        join backtest_results r on r.user_id=j.user_id and r.backtest_job_id=j.id
        join backtest_datasets d on d.user_id=j.user_id and d.backtest_job_id=j.id and d.id=r.dataset_id
        where s.user_id=? and s.id=? and s.config_hash=?
        order by j.completed_at desc,j.id desc limit 1`)
        .bind(input.userId, input.strategyVersionId, input.configurationHash).first<FormalEvidenceGateRow>();
      if (!hasFormalBacktestEvidence(evidence)) return null;
      const row = await database.prepare(`insert into cloud_strategy_runs
        (id,user_id,connection_id,executor_shard_id,strategy_version_id,name,mode,state,config_json,risk_json,
         configuration_hash,version,consecutive_failures,created_at,updated_at,started_at)
        select ?,s.user_id,c.id,c.executor_shard_id,s.id,?,?,'running',s.config_json::jsonb,?::text::jsonb,
          ?,1,0,?,?,?
        from strategy_versions s
        join strategies t on t.id=s.strategy_id and t.user_id=s.user_id
        join weex_connections c on c.user_id=s.user_id and c.provider='weex'
        where s.user_id=? and s.id=? and s.config_hash=? and c.status='active'
          and ((?='futures-demo' and t.market='futures') or (?='live' and t.market in ('spot','futures')))
          and s.source_code is null and s.source_hash is null
          and s.config_json::jsonb->>'market'=t.market
          and regexp_replace(regexp_replace(upper(btrim(s.config_json::jsonb->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
            =regexp_replace(regexp_replace(upper(btrim(t.symbol)), '^CMT_', ''), '[-/_]', '', 'g')
          and exists (
            select 1 from jsonb_array_elements_text(?::text::jsonb->'allowedSymbols') allowed(symbol)
            where regexp_replace(regexp_replace(upper(btrim(allowed.symbol)), '^CMT_', ''), '[-/_]', '', 'g')
              =regexp_replace(regexp_replace(upper(btrim(t.symbol)), '^CMT_', ''), '[-/_]', '', 'g')
          )
          and c.withdrawal_access_absent=true and c.executor_shard_id is not null
          and c.permissions_json @> '{"read":true}'::jsonb
          and (
            (?='futures-demo' and s.config_json::jsonb->>'market'='futures' and (
              c.permissions_json @> '{"futuresDemoTrade":true}'::jsonb
              or c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb
            ))
            or
            (?='live' and (
              (s.config_json::jsonb->>'market'='spot'
                and c.permissions_json @> '{"spotTrade":true,"liveVerified":true}'::jsonb)
              or
              (s.config_json::jsonb->>'market'='futures'
                and c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb)
            ))
          )
          and exists (
            select 1 from backtest_jobs j
            join backtest_results r on r.user_id=j.user_id and r.backtest_job_id=j.id
              and r.evidence_level='historical' and r.configuration_hash=s.config_hash
              and r.strategy_hash=s.config_hash
              and ((s.source_hash is null and r.script_hash is null) or r.script_hash=s.source_hash)
            join backtest_datasets d on d.user_id=j.user_id and d.backtest_job_id=j.id
              and d.id=r.dataset_id and d.complete=1 and d.gaps_json='[]'
            where j.user_id=s.user_id and j.strategy_version_id=s.id
              and j.status='succeeded' and j.evidence_level='historical'
          )
          and not exists (
            select 1 from cloud_strategy_runs active
            where active.user_id=s.user_id and active.connection_id=c.id
              and active.config_json->>'market'=t.market
              and regexp_replace(regexp_replace(upper(btrim(active.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
                =regexp_replace(regexp_replace(upper(btrim(t.symbol)), '^CMT_', ''), '[-/_]', '', 'g')
              and active.state<>'stopped'
          )
        on conflict do nothing
        returning ${columns}`).bind(input.id, input.name.trim(), input.mode, JSON.stringify(input.risk), input.configurationHash,
          input.now, input.now, input.now, input.userId, input.strategyVersionId, input.configurationHash, input.mode, input.mode,
          JSON.stringify(input.risk), input.mode, input.mode)
        .first<CloudRunRow>();
      return row ? normalizeCloudRunRow(row) : null;
    },
    async findMatching(input: { id: string; userId: string; strategyVersionId: string; name: string;
      configurationHash: string; mode: CloudRunMode; risk: CloudRiskInput }): Promise<CloudRunRow | null> {
      if (!ID.test(input.id) || !ID.test(input.userId) || !ID.test(input.strategyVersionId)
        || input.name.trim().length < 1 || input.name.trim().length > 100 || !HASH.test(input.configurationHash)) {
        return Promise.resolve(null);
      }
      const row = await database.prepare(`select ${columns} from cloud_strategy_runs
        where id=? and user_id=? and strategy_version_id=? and name=? and configuration_hash=?
          and mode=? and risk_json=?::text::jsonb limit 1`)
        .bind(input.id, input.userId, input.strategyVersionId, input.name.trim(), input.configurationHash,
          input.mode, JSON.stringify(input.risk)).first<CloudRunRow>();
      return row ? normalizeCloudRunRow(row) : null;
    },
    async hasActiveTargetConflict(input: { id: string; userId: string; strategyVersionId: string;
      configurationHash: string }): Promise<boolean> {
      if (!ID.test(input.id) || !ID.test(input.userId) || !ID.test(input.strategyVersionId)
        || !HASH.test(input.configurationHash)) return false;
      const conflict = await database.prepare(`select 1 as conflict
        from strategy_versions requested_version
        join strategies requested_strategy
          on requested_strategy.id=requested_version.strategy_id
          and requested_strategy.user_id=requested_version.user_id
        join weex_connections requested_connection
          on requested_connection.user_id=requested_version.user_id and requested_connection.provider='weex'
        join cloud_strategy_runs active
          on active.user_id=requested_version.user_id
          and active.connection_id=requested_connection.id
          and active.config_json->>'market'=requested_version.config_json::jsonb->>'market'
          and regexp_replace(regexp_replace(upper(btrim(active.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
            =regexp_replace(regexp_replace(upper(btrim(requested_version.config_json::jsonb->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
        where requested_version.user_id=? and requested_version.id=? and requested_version.config_hash=?
          and active.id<>? and active.state<>'stopped' limit 1`)
        .bind(input.userId, input.strategyVersionId, input.configurationHash, input.id).first<{ conflict: number }>();
      return conflict !== null;
    },
    async hasTransitionTargetConflict(input: { id: string; userId: string }): Promise<boolean> {
      if (!ID.test(input.id) || !ID.test(input.userId)) return false;
      const conflict = await database.prepare(`select 1 as conflict
        from cloud_strategy_runs target join cloud_strategy_runs active
          on active.user_id=target.user_id and active.connection_id=target.connection_id
          and active.config_json->>'market'=target.config_json->>'market'
          and regexp_replace(regexp_replace(upper(btrim(active.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
            =regexp_replace(regexp_replace(upper(btrim(target.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
        where target.user_id=? and target.id=? and active.id<>target.id
          and active.state<>'stopped' limit 1`)
        .bind(input.userId, input.id).first<{ conflict: number }>();
      return conflict !== null;
    },
    async modeForUser(input: { id: string; userId: string }): Promise<CloudRunMode | null> {
      if (!ID.test(input.id) || !ID.test(input.userId)) return null;
      const row = await database.prepare(`select mode from cloud_strategy_runs where user_id=? and id=? limit 1`)
        .bind(input.userId, input.id).first<{ mode: string }>();
      if (!row) return null;
      if (row.mode !== "futures-demo" && row.mode !== "live") throw new Error("stored cloud run mode is invalid");
      return row.mode;
    },
    async transition(input: { userId: string; id: string; state: "running" | "paused" | "stopped";
      expectedVersion: number; allowLiveResume: boolean; now: number }): Promise<CloudRunRow | null> {
      if (!ID.test(input.userId) || !ID.test(input.id) || !Number.isSafeInteger(input.expectedVersion)
        || input.expectedVersion < 1 || typeof input.allowLiveResume !== "boolean"
        || !Number.isSafeInteger(input.now) || input.now < 0) return Promise.resolve(null);
      if (input.state === "stopped") {
        const stopped = await database.prepare(`select ${columns}
          from private.stop_cloud_strategy_run(?,?,?,?)`)
          .bind(input.userId, input.id, input.expectedVersion, input.now).first<CloudRunRow>();
        return stopped ? normalizeCloudRunRow(stopped) : null;
      }
      const row = await database.prepare(`update cloud_strategy_runs as target set state=?,version=version+1,updated_at=?,
        started_at=case when ?='running' then ? else started_at end,
        stopped_at=case when ?='stopped' then ? else stopped_at end,
        last_error_code=case when ?='running' then null else last_error_code end,
        consecutive_failures=case when ?='running' then 0 else consecutive_failures end,
        lease_owner=null,lease_expires_at=null
        where target.user_id=? and target.id=? and target.version=? and target.state<>'stopped'
          and (?<>'running' or target.mode<>'live' or ?)
          and (?<>'running' or not exists (
            select 1 from cloud_strategy_runs active
            where active.user_id=target.user_id and active.connection_id=target.connection_id
              and active.config_json->>'market'=target.config_json->>'market'
              and regexp_replace(regexp_replace(upper(btrim(active.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
                =regexp_replace(regexp_replace(upper(btrim(target.config_json->>'symbol')), '^CMT_', ''), '[-/_]', '', 'g')
              and active.id<>target.id and active.state<>'stopped'
          )) returning ${columns}`)
        .bind(input.state, input.now, input.state, input.now, input.state, input.now, input.state, input.state,
          input.userId, input.id, input.expectedVersion, input.state, input.allowLiveResume, input.state).first<CloudRunRow>();
      return row ? normalizeCloudRunRow(row) : null;
    },
  };
}
