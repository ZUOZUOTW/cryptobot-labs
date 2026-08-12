import type { ControlPlaneDatabase } from "@/db";
import { canonicalizeWeexSymbol } from "@cryptobot-labs/weex-client";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/;

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
    async create(input: { id: string; userId: string; strategyVersionId: string; name: string;
      configurationHash: string; mode: CloudRunMode; risk: CloudRiskInput; now: number }): Promise<CloudRunRow | null> {
      if (!ID.test(input.id) || !ID.test(input.userId) || !ID.test(input.strategyVersionId)
        || input.name.trim().length < 1 || input.name.trim().length > 100 || !HASH.test(input.configurationHash)) return null;
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
            join backtest_datasets d on d.user_id=j.user_id and d.backtest_job_id=j.id
              and d.id=r.dataset_id and d.complete=1
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
