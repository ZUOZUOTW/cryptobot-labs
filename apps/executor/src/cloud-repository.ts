import postgres, { type Sql } from "postgres";
import type { EncryptedWeexCredentials } from "@cryptobot-labs/weex-client";
import { canonicalizeWeexSymbol } from "@cryptobot-labs/weex-client";
import type { SubmitOutcome } from "@cryptobot-labs/trading-core";

type Database = Sql<Record<string, never>>;
type Row = Record<string, unknown>;

export interface CloudRun {
  id: string; userId: string; connectionId: string; mode: "futures-demo" | "live";
  version: number; configurationHash: string; config: Record<string, unknown>; risk: Record<string, unknown>;
  lastCandleAt: number | null; lastEvaluatedAt: number | null; consecutiveFailures: number;
  positions: readonly unknown[];
}
export interface StoredCredential {
  envelope: EncryptedWeexCredentials;
  context: Readonly<Record<string, string>>;
  credentialVersion: number;
  connectionVersion: number;
}
export type CloudRunTarget =
  | { readonly market: "spot"; readonly mode: "live" }
  | { readonly market: "futures"; readonly mode: "futures-demo" | "live" };
export type AuthorizedOrderSubmission =
  | { readonly authorized: false }
  | { readonly authorized: true; readonly outcome: SubmitOutcome };
export interface ClaimedOrder {
  status: "claimed" | "risk-rejected" | "acknowledged" | "rejected" | "unknown";
  exchangeOrderId: string | null;
  clientOrderId: string;
  candleCloseAt: number;
  createdAt: number;
  signal: Readonly<Record<string, unknown>>;
  intent: Readonly<Record<string, unknown>> | null;
  fresh: boolean;
}
export interface AccountSnapshot {
  asset: string;
  observedAt: number;
  equity: string;
  availableEquity: string;
  unrealizedPnl: string;
  positions: readonly unknown[];
}
export interface ClaimedAccountSnapshot {
  connectionId: string;
  userId: string;
  tradeCursorAt: number;
  permissions: Record<string, unknown>;
  withdrawalAccessAbsent: boolean;
}
export interface RealizedTrade {
  exchangeTradeId: string;
  symbol: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  netPnl: string;
  tradedAt: number;
}
export interface AccountProjection {
  uid: string | null;
  observedAt: number;
  balances: readonly unknown[];
  positions: readonly unknown[];
  equity: string;
  availableEquity: string;
  unrealizedPnl: string;
  trades: readonly RealizedTrade[];
  nextTradeCursorAt: number;
  partialErrorCode?: string;
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} is invalid`);
  return parsed as Record<string, unknown>;
};
const nullableObject = (value: unknown, label: string): Record<string, unknown> | null =>
  value === null ? null : object(value, label);
const array = (value: unknown, label: string): readonly unknown[] => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
};
const bytes = (value: unknown): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.byteLength < 1) throw new Error("credential envelope is invalid");
  return Uint8Array.from(value);
};
const integer = (value: unknown): number => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("database integer is invalid");
  return result;
};
const jsonValue = (value: unknown): postgres.JSONValue => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("database JSON value is invalid");
  return JSON.parse(serialized) as postgres.JSONValue;
};
const signedDecimal = (value: unknown): string => {
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/.test(value)) {
    throw new Error("database decimal is invalid");
  }
  return value;
};
const CONFIGURATION_HASH = /^[a-f0-9]{64}$/;
const LEASE_DURATION_MS = 180_000;
export const ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS = 12_000;
export const ORDER_SUBMISSION_TIMEOUT_MS = 10_500;
const CONNECTION_AUTHORIZATION_REQUIRED = "connection_authorization_required";

const connectionAuthorizesTarget = (
  connection: Row | undefined,
  target: CloudRunTarget,
): boolean => {
  if (!connection || connection.status !== "active" || connection.withdrawal_access_absent !== true) return false;
  const permissions = object(connection.permissions_json, "connection permissions");
  if (permissions.read !== true) return false;
  if (target.mode === "futures-demo") {
    return target.market === "futures" && (permissions.futuresDemoTrade === true
      || (permissions.futuresTrade === true && permissions.liveVerified === true));
  }
  return permissions.liveVerified === true && (target.market === "spot"
    ? permissions.spotTrade === true
    : permissions.futuresTrade === true);
};

const canonicalRunTarget = (
  configValue: unknown,
  riskValue: unknown,
): { config: Record<string, unknown>; risk: Record<string, unknown> } => {
  const config = object(configValue, "strategy config");
  const risk = object(riskValue, "risk policy");
  const symbol = canonicalizeWeexSymbol(config.symbol);
  if ((config.market !== "spot" && config.market !== "futures") || !symbol
    || !Array.isArray(risk.allowedSymbols) || risk.allowedSymbols.length < 1 || risk.allowedSymbols.length > 20) {
    throw new Error("Cloud run target is invalid");
  }
  const canonicalAllowed = risk.allowedSymbols.map(canonicalizeWeexSymbol);
  if (canonicalAllowed.some((candidate) => candidate === null)) throw new Error("Cloud run target is invalid");
  const allowedSymbols = [...new Set(canonicalAllowed as string[])];
  if (!allowedSymbols.includes(symbol)) throw new Error("Cloud run target is inconsistent");
  return {
    config: { ...config, symbol },
    risk: { ...risk, allowedSymbols },
  };
};

export class CloudRuntimeRepository {
  readonly #sql: Database;
  constructor(databaseUrl: string, private readonly shardId: string) {
    this.#sql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: "require" });
  }

  async assertReady(): Promise<void> {
    const rows = await this.#sql.unsafe(`select to_regclass('public.cloud_strategy_runs') as runs,
      to_regclass('private.cloud_order_intents') as orders,
      to_regclass('public.weex_account_snapshots') as account_snapshots,
      to_regclass('public.weex_realized_pnl_ledger') as realized_pnl`);
    if (!rows[0] || Object.values(rows[0] as Row).some((value) => typeof value !== "string")) {
      throw new Error("Cloud runtime database schema is not ready");
    }
  }

  async claimAccountSnapshots(owner: string, now: number, limit = 20): Promise<ClaimedAccountSnapshot[]> {
    await this.#sql.unsafe(`insert into public.weex_account_snapshots
      (connection_id,user_id,status,trade_cursor_at,created_at,updated_at)
      select id,user_id,'pending',greatest(1,least($2,coalesce(verified_at,created_at))),$2,$2
      from public.weex_connections
      where executor_shard_id=$1 and status='active'
      on conflict(connection_id) do nothing`, [this.shardId, now]);
    const rows = await this.#sql.unsafe(`with claimed as (
      update public.weex_account_snapshots set
        lease_owner=$1,lease_expires_at=$2::bigint+${LEASE_DURATION_MS},updated_at=greatest(updated_at,$2::bigint)
        where connection_id in (
          select s.connection_id from public.weex_account_snapshots s
          join public.weex_connections c on c.id=s.connection_id and c.user_id=s.user_id
          where c.executor_shard_id=$3 and c.status='active'
            and (s.observed_at is null or s.observed_at <= $2::bigint-60000)
            and (s.lease_expires_at is null or s.lease_expires_at<$2::bigint or s.lease_owner=$1)
          order by coalesce(s.observed_at,0),s.created_at limit $4 for update of s skip locked
        )
        returning connection_id,user_id,trade_cursor_at
      )
      select claimed.*,c.permissions_json,c.withdrawal_access_absent
      from claimed join public.weex_connections c
        on c.id=claimed.connection_id and c.user_id=claimed.user_id`,
    [owner, now, this.shardId, limit]);
    return rows.map((row) => {
      const value = row as Row;
      if (typeof value.connection_id !== "string" || typeof value.user_id !== "string") {
        throw new Error("Claimed account snapshot is invalid");
      }
      return {
        connectionId: value.connection_id,
        userId: value.user_id,
        tradeCursorAt: integer(value.trade_cursor_at),
        permissions: object(value.permissions_json, "connection permissions"),
        withdrawalAccessAbsent: value.withdrawal_access_absent === true,
      };
    });
  }

  async renewAccountLease(
    account: ClaimedAccountSnapshot,
    owner: string,
    now: number,
  ): Promise<boolean> {
    const result = await this.#sql.unsafe(`update public.weex_account_snapshots
      set lease_expires_at=$4::bigint+${LEASE_DURATION_MS},updated_at=greatest(updated_at,$4::bigint)
      where connection_id=$1 and user_id=$2 and lease_owner=$3`,
    [account.connectionId, account.userId, owner, now]);
    return (result.count ?? 0) > 0;
  }

  async recordConnectionPermissions(
    account: ClaimedAccountSnapshot,
    owner: string,
    permissions: Readonly<Record<string, boolean>>,
    withdrawalAccessAbsent: boolean,
    now: number,
  ): Promise<void> {
    await this.#sql.unsafe(`update public.weex_connections c set permissions_json=$4::jsonb,
      withdrawal_access_absent=$5,verified_at=$6,updated_at=$6
      where c.id=$1 and c.user_id=$2 and exists (
        select 1 from public.weex_account_snapshots s
        where s.connection_id=c.id and s.user_id=c.user_id and s.lease_owner=$3
      )`, [account.connectionId, account.userId, owner,
      this.#sql.json(jsonValue(permissions)), withdrawalAccessAbsent, now]);
  }

  async claimRuns(owner: string, now: number, limit = 10): Promise<CloudRun[]> {
    const rows = await this.#sql.unsafe(`update public.cloud_strategy_runs set lease_owner=$1,
      lease_expires_at=$2::bigint+${LEASE_DURATION_MS},updated_at=greatest(updated_at,$2::bigint)
      where id in (select r.id from public.cloud_strategy_runs r
        join public.weex_connections c
          on c.id=r.connection_id and c.user_id=r.user_id and c.provider='weex'
          and c.executor_shard_id=r.executor_shard_id
        cross join lateral (values (case r.config_json->>'timeframe'
          when '1m' then 60000::bigint when '5m' then 300000::bigint
          when '15m' then 900000::bigint when '30m' then 1800000::bigint
          when '1h' then 3600000::bigint when '4h' then 14400000::bigint
          when '1d' then 86400000::bigint else 60000::bigint end)) schedule(interval_ms)
        where r.executor_shard_id=$3 and r.state='running'
          and c.status='active' and c.withdrawal_access_absent=true
          and c.permissions_json @> '{"read":true}'::jsonb
          and (
            (r.mode='futures-demo' and r.config_json->>'market'='futures' and (
              c.permissions_json @> '{"futuresDemoTrade":true}'::jsonb
              or c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb
            ))
            or
            (r.mode='live' and (
              (r.config_json->>'market'='spot'
                and c.permissions_json @> '{"spotTrade":true,"liveVerified":true}'::jsonb)
              or
              (r.config_json->>'market'='futures'
                and c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb)
            ))
          )
          and (r.lease_expires_at is null or r.lease_expires_at<$2::bigint or r.lease_owner=$1)
          and (r.last_candle_at is null
            or r.last_candle_at < (($2::bigint/schedule.interval_ms)*schedule.interval_ms)-1
            or exists (select 1 from private.cloud_order_intents o where o.run_id=r.id and (
              o.status in ('claimed','unknown')
              or (o.status='acknowledged' and coalesce(o.error_code,'') not in
                ('exchange_order_filled','exchange_order_cancelled_partially_filled'))
              or o.candle_close_at>coalesce(r.last_candle_at,-1)
            )))
        order by coalesce(r.last_evaluated_at,0),r.created_at limit $4 for update of r skip locked)
      returning id,user_id,connection_id,mode,version,configuration_hash,config_json,risk_json,last_candle_at,last_evaluated_at,
        consecutive_failures,positions_json`,
    [owner, now, this.shardId, limit]);
    return rows.map((row) => {
      const value = row as Row;
      if ((value.mode !== "futures-demo" && value.mode !== "live") || typeof value.id !== "string"
        || typeof value.user_id !== "string" || typeof value.connection_id !== "string"
        || typeof value.configuration_hash !== "string"
        || !CONFIGURATION_HASH.test(value.configuration_hash)) throw new Error("Cloud run is invalid");
      const target = canonicalRunTarget(value.config_json, value.risk_json);
      return { id: value.id, userId: value.user_id, connectionId: value.connection_id, mode: value.mode,
        version: integer(value.version), configurationHash: value.configuration_hash,
        config: target.config,
        risk: target.risk,
        lastCandleAt: value.last_candle_at === null ? null : integer(value.last_candle_at),
        lastEvaluatedAt: value.last_evaluated_at === null ? null : integer(value.last_evaluated_at),
        consecutiveFailures: integer(value.consecutive_failures),
        positions: array(value.positions_json, "run positions") };
    });
  }

  async renewRunLease(runId: string, owner: string, now: number): Promise<boolean> {
    const result = await this.#sql.unsafe(`update public.cloud_strategy_runs
      set lease_expires_at=$3::bigint+${LEASE_DURATION_MS},updated_at=greatest(updated_at,$3::bigint)
      where id=$1 and lease_owner=$2`, [runId, owner, now]);
    return (result.count ?? 0) > 0;
  }

  async credential(connectionId: string, userId: string, target?: CloudRunTarget): Promise<StoredCredential> {
    const rows = await this.#sql.unsafe(`select b.kms_key_id,b.encrypted_data_key,b.initialization_vector,
      b.credential_ciphertext,b.encryption_context_json,b.credential_version,c.version as connection_version
      from private.weex_credential_blobs b
      join public.weex_connections c on c.id=b.connection_id and c.user_id=b.user_id
      where b.connection_id=$1 and b.user_id=$2 and c.provider='weex' and c.status='active'
        and c.withdrawal_access_absent=true and c.permissions_json @> '{"read":true}'::jsonb
        and (
          ($3::text is null and $4::text is null)
          or
          ($3::text='futures-demo' and $4::text='futures' and (
            c.permissions_json @> '{"futuresDemoTrade":true}'::jsonb
            or c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb
          ))
          or
          ($3::text='live' and $4::text='spot'
            and c.permissions_json @> '{"spotTrade":true,"liveVerified":true}'::jsonb)
          or
          ($3::text='live' and $4::text='futures'
            and c.permissions_json @> '{"futuresTrade":true,"liveVerified":true}'::jsonb)
        )`, [connectionId, userId, target?.mode ?? null, target?.market ?? null]);
    const row = rows[0] as Row | undefined;
    if (!row || typeof row.kms_key_id !== "string") throw new Error("Cloud credential is unavailable");
    const rawContext = object(row.encryption_context_json, "credential context");
    if (Object.values(rawContext).some((value) => typeof value !== "string")) throw new Error("Credential context is invalid");
    return { envelope: { version: 1, keyId: row.kms_key_id, encryptedDataKey: bytes(row.encrypted_data_key),
      initializationVector: bytes(row.initialization_vector), ciphertext: bytes(row.credential_ciphertext) },
      context: rawContext as Record<string, string>, credentialVersion: integer(row.credential_version),
      connectionVersion: integer(row.connection_version) };
  }

  async realizedPnl(userId: string, connectionId: string, startAt: number, endAt: number): Promise<string> {
    if (!Number.isSafeInteger(startAt) || startAt < 0 || !Number.isSafeInteger(endAt) || endAt < startAt) {
      throw new Error("Realized PnL range is invalid");
    }
    const rows = await this.#sql.unsafe(`select coalesce(sum(net_pnl),0)::text as net_pnl
      from public.weex_realized_pnl_ledger
      where user_id=$1 and connection_id=$2 and traded_at >= $3 and traded_at <= $4`,
    [userId, connectionId, startAt, endAt]);
    return signedDecimal((rows[0] as Row | undefined)?.net_pnl);
  }

  async dayStartEquity(runId: string, owner: string, utcDay: string, equity: string, now: number): Promise<string> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDay) || !/^(?:0|[1-9]\d{0,23})(?:\.\d{1,18})?$/.test(equity)
      || Number(equity) <= 0 || !Number.isSafeInteger(now) || now < 0) {
      throw new Error("Daily equity checkpoint is invalid");
    }
    const rows = await this.#sql.unsafe(`with updated as (
        update public.cloud_strategy_runs set risk_utc_day=$3,day_start_equity=$4::numeric,
          updated_at=greatest(updated_at,$5)
        where id=$1 and lease_owner=$2 and risk_utc_day is distinct from $3
        returning day_start_equity::text
      )
      select day_start_equity from updated
      union all
      select day_start_equity::text from public.cloud_strategy_runs
      where id=$1 and lease_owner=$2 and risk_utc_day=$3 and not exists(select 1 from updated)
      limit 1`, [runId, owner, utcDay, equity, now]);
    return signedDecimal((rows[0] as Row | undefined)?.day_start_equity);
  }

  async hasAcknowledgedOrder(runId: string): Promise<boolean> {
    const rows = await this.#sql.unsafe(`select exists(
      select 1 from private.cloud_order_intents where run_id=$1 and status='acknowledged'
    ) as acknowledged`, [runId]);
    const acknowledged = (rows[0] as Row | undefined)?.acknowledged;
    if (typeof acknowledged !== "boolean") throw new Error("Cloud order ownership state is invalid");
    return acknowledged;
  }

  async blockingOrder(runId: string, lastCandleAt: number | null): Promise<ClaimedOrder | null> {
    const rows = await this.#sql.unsafe(`select status,exchange_order_id,client_order_id,candle_close_at,
      created_at,signal_json,intent_json,false as fresh
      from private.cloud_order_intents
      where run_id=$1 and (
        status in ('claimed','unknown')
        or (status='acknowledged' and coalesce(error_code,'') not in
          ('exchange_order_filled','exchange_order_cancelled_partially_filled'))
        or candle_close_at>$2
      )
      order by candle_close_at asc limit 1`, [runId, lastCandleAt ?? -1]);
    const row = rows[0] as Row | undefined;
    return row ? this.#claimedOrder(row) : null;
  }

  async claimOrder(input: { runId: string; candleCloseAt: number; clientOrderId: string;
    signal: unknown; intent: unknown; now: number }): Promise<ClaimedOrder> {
    const rows = await this.#sql.unsafe(`with inserted as (
        insert into private.cloud_order_intents
          (run_id,candle_close_at,client_order_id,signal_json,intent_json,status,created_at,updated_at)
        values ($1,$2,$3,$4::jsonb,$5::jsonb,'claimed',$6,$6)
        on conflict(run_id,candle_close_at) do nothing
        returning status,exchange_order_id,client_order_id,candle_close_at,created_at,
          signal_json,intent_json,true as fresh
      )
      select status,exchange_order_id,client_order_id,candle_close_at,created_at,
        signal_json,intent_json,fresh from inserted
      union all
      select status,exchange_order_id,client_order_id,candle_close_at,created_at,
        signal_json,intent_json,false as fresh
      from private.cloud_order_intents
      where run_id=$1 and candle_close_at=$2 and not exists(select 1 from inserted)
      limit 1`,
    [input.runId, input.candleCloseAt, input.clientOrderId, this.#sql.json(jsonValue(input.signal)),
      this.#sql.json(jsonValue(input.intent)), input.now]);
    const row = rows[0] as Row | undefined;
    if (!row) throw new Error("Cloud order claim conflict");
    return this.#claimedOrder(row);
  }

  async submitAuthorizedOrder(
    input: { run: CloudRun; owner: string; candleCloseAt: number; now: number;
      credentialVersion: number; connectionVersion: number },
    operation: (signal: AbortSignal) => Promise<SubmitOutcome>,
  ): Promise<AuthorizedOrderSubmission> {
    const transactionResult = await this.#sql.begin(async (transaction) => {
      await transaction.unsafe(`set local lock_timeout='5s';
        set local statement_timeout='${ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS}ms';
        set local idle_in_transaction_session_timeout='${ORDER_SUBMISSION_TRANSACTION_TIMEOUT_MS}ms'`);
      const connections = await transaction.unsafe(`select c.status,c.permissions_json,c.withdrawal_access_absent,
        c.version as connection_version,b.credential_version
        from public.weex_connections c
        join private.weex_credential_blobs b on b.connection_id=c.id and b.user_id=c.user_id
        where c.id=$1 and c.user_id=$2 and c.provider='weex' for update of c,b`,
      [input.run.connectionId, input.run.userId]);
      const runOrders = await transaction.unsafe(`select r.mode,r.config_json->>'market' as market,
        r.state,r.lease_owner,o.status as order_status
        from public.cloud_strategy_runs r
        join private.cloud_order_intents o on o.run_id=r.id and o.candle_close_at=$4
        where r.id=$1 and r.user_id=$2 and r.connection_id=$3
        for update of r,o`,
      [input.run.id, input.run.userId, input.run.connectionId, input.candleCloseAt]);
      const runOrder = runOrders[0] as Row | undefined;
      if (!runOrder || runOrder.order_status !== "claimed") return { authorized: false } as const;
      const connection = connections[0] as Row | undefined;
      const target = (runOrder.market === "spot" && runOrder.mode === "live")
        ? { market: "spot", mode: "live" } as const
        : (runOrder.market === "futures"
          && (runOrder.mode === "futures-demo" || runOrder.mode === "live"))
          ? { market: "futures", mode: runOrder.mode } as const
          : null;
      const versionsMatch = connection
        ? integer(connection.credential_version) === input.credentialVersion
          && integer(connection.connection_version) === input.connectionVersion
        : false;
      const connectionAuthorized = target ? connectionAuthorizesTarget(connection, target) : false;
      if (!target || !connectionAuthorized) {
        await transaction.unsafe(`update public.cloud_strategy_runs set state='paused',version=version+1,
          last_error_code=$4,lease_owner=null,lease_expires_at=null,updated_at=greatest(updated_at,$5)
          where id=$1 and user_id=$2 and connection_id=$3 and state<>'stopped'`,
        [input.run.id, input.run.userId, input.run.connectionId, CONNECTION_AUTHORIZATION_REQUIRED, input.now]);
        await transaction.unsafe(`update private.cloud_order_intents set status='rejected',error_code=$3,updated_at=$4
          where run_id=$1 and candle_close_at=$2 and status='claimed'`,
        [input.run.id, input.candleCloseAt, CONNECTION_AUTHORIZATION_REQUIRED, input.now]);
        return { authorized: false } as const;
      }
      if (!versionsMatch) {
        await transaction.unsafe(`update public.cloud_strategy_runs set lease_owner=null,lease_expires_at=null,
          updated_at=greatest(updated_at,$3) where id=$1 and user_id=$2 and lease_owner=$4`,
        [input.run.id, input.run.userId, input.now, input.owner]);
        return { authorized: false } as const;
      }
      if (runOrder.state !== "running" || runOrder.lease_owner !== input.owner) {
        return { authorized: false } as const;
      }
      const marked = await transaction.unsafe(`update private.cloud_order_intents set status='unknown',
        exchange_order_id=null,error_code='submission_in_progress',updated_at=$3
        where run_id=$1 and candle_close_at=$2 and status='claimed'`,
      [input.run.id, input.candleCloseAt, input.now]);
      if (marked.count !== 1) throw new Error("Cloud order authorization conflict");
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        const controller = new AbortController();
        const submissionTimeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            controller.abort(new Error("WEEX order submission exceeded its transaction deadline"));
            reject(new Error("WEEX order submission exceeded its transaction deadline"));
          }, ORDER_SUBMISSION_TIMEOUT_MS);
          timer.unref?.();
        });
        const operationPromise = operation(controller.signal);
        const outcome = await Promise.race([operationPromise, submissionTimeout]).finally(() => {
          if (timer) clearTimeout(timer);
        });
        if (timedOut) throw new Error("WEEX order submission exceeded its transaction deadline");
        if (!outcome || !["acknowledged", "rejected", "unknown"].includes(outcome.status)
          || (outcome.status === "acknowledged" && typeof outcome.exchangeOrderId !== "string")) {
          throw new Error("Cloud order submission outcome is invalid");
        }
        const unsafeReason = outcome.status === "acknowledged" ? null : outcome.reason ?? outcome.status;
        const reason = unsafeReason && /^[a-z0-9_-]{1,64}$/.test(unsafeReason)
          ? unsafeReason : outcome.status === "acknowledged" ? null : "submission_failed";
        await transaction.unsafe(`update private.cloud_order_intents set status=$3,
          exchange_order_id=$4,error_code=$5,updated_at=$6 where run_id=$1 and candle_close_at=$2`,
        [input.run.id, input.candleCloseAt, outcome.status,
          outcome.status === "acknowledged" ? outcome.exchangeOrderId : null, reason, input.now]);
        return { authorized: true, outcome } as const;
      } catch (error) {
        return { authorized: true, submissionError: error } as const;
      }
    });
    if ("submissionError" in transactionResult) throw transactionResult.submissionError;
    return transactionResult;
  }

  async recordOrder(input: { runId: string; candleCloseAt: number; status: ClaimedOrder["status"];
    intent?: unknown; exchangeOrderId?: string; errorCode?: string; now: number }): Promise<void> {
    await this.#sql.unsafe(`update private.cloud_order_intents set status=$3,
      intent_json=coalesce($4::jsonb,intent_json),
      exchange_order_id=$5,error_code=$6,updated_at=$7 where run_id=$1 and candle_close_at=$2`,
    [input.runId, input.candleCloseAt, input.status,
      input.intent === undefined ? null : this.#sql.json(jsonValue(input.intent)),
      input.exchangeOrderId ?? null, input.errorCode ?? null, input.now]);
  }

  #claimedOrder(row: Row): ClaimedOrder {
    if (!["claimed", "risk-rejected", "acknowledged", "rejected", "unknown"].includes(String(row.status))
      || typeof row.client_order_id !== "string" || typeof row.fresh !== "boolean") {
      throw new Error("Cloud order claim conflict");
    }
    return {
      status: row.status as ClaimedOrder["status"],
      exchangeOrderId: typeof row.exchange_order_id === "string" ? row.exchange_order_id : null,
      clientOrderId: row.client_order_id,
      candleCloseAt: integer(row.candle_close_at),
      createdAt: integer(row.created_at),
      signal: object(row.signal_json, "cloud order signal"),
      intent: nullableObject(row.intent_json, "cloud order intent"),
      fresh: row.fresh,
    };
  }

  async recordAccountSnapshot(run: CloudRun, owner: string, snapshot: AccountSnapshot): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set account_asset=$3,account_observed_at=$4,
      account_equity=$5::numeric,available_equity=$6::numeric,unrealized_pnl=$7::numeric,
      positions_json=$8::jsonb,updated_at=greatest(updated_at,$4)
      where id=$1 and lease_owner=$2`, [run.id, owner, snapshot.asset, snapshot.observedAt, snapshot.equity,
      snapshot.availableEquity, snapshot.unrealizedPnl, this.#sql.json(jsonValue(snapshot.positions))]);
  }

  async recordAccountProjection(
    account: ClaimedAccountSnapshot,
    owner: string,
    projection: AccountProjection,
  ): Promise<void> {
    for (const trade of projection.trades) {
      await this.#sql.unsafe(`insert into public.weex_realized_pnl_ledger
        (connection_id,user_id,exchange_trade_id,symbol,realized_pnl,commission,commission_asset,
         net_pnl,traded_at,inserted_at)
        values ($1,$2,$3,$4,$5::numeric,$6::numeric,$7,$8::numeric,$9,$10)
        on conflict(connection_id,exchange_trade_id) do nothing`,
      [account.connectionId, account.userId, trade.exchangeTradeId, trade.symbol, trade.realizedPnl,
        trade.commission, trade.commissionAsset, trade.netPnl, trade.tradedAt, projection.observedAt]);
    }
    const safePartial = projection.partialErrorCode && /^[a-z0-9_-]{1,64}$/.test(projection.partialErrorCode)
      ? projection.partialErrorCode : null;
    await this.#sql.unsafe(`update public.weex_account_snapshots set status='ready',
      account_uid=coalesce($3,account_uid),observed_at=$4,balances_json=$5::jsonb,positions_json=$6::jsonb,
      account_equity=$7::numeric,available_equity=$8::numeric,unrealized_pnl=$9::numeric,
      trade_cursor_at=greatest(trade_cursor_at,$10),consecutive_failures=0,last_error_code=$11,
      lease_owner=null,lease_expires_at=null,updated_at=$4
      where connection_id=$1 and user_id=$2 and lease_owner=$12`,
    [account.connectionId, account.userId, projection.uid, projection.observedAt,
      this.#sql.json(jsonValue(projection.balances)), this.#sql.json(jsonValue(projection.positions)), projection.equity,
      projection.availableEquity, projection.unrealizedPnl, projection.nextTradeCursorAt,
      safePartial, owner]);
  }

  async failAccountProjection(
    account: ClaimedAccountSnapshot,
    owner: string,
    code: string,
    now: number,
  ): Promise<void> {
    const safe = /^[a-z0-9_-]{1,64}$/.test(code) ? code : "account_sync_failed";
    await this.#sql.unsafe(`update public.weex_account_snapshots set status='error',
      consecutive_failures=consecutive_failures+1,last_error_code=$3,
      lease_owner=null,lease_expires_at=null,updated_at=$4
      where connection_id=$1 and user_id=$2 and lease_owner=$5`,
    [account.connectionId, account.userId, safe, now, owner]);
  }

  async complete(run: CloudRun, owner: string, candleCloseAt: number, signal: unknown, now: number): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set
      last_candle_at=greatest(coalesce(last_candle_at,$3),$3),last_evaluated_at=$4,
      last_signal_json=case when last_candle_at is null or $3>=last_candle_at then $5::jsonb else last_signal_json end,
      last_error_code=null,consecutive_failures=0,lease_owner=null,lease_expires_at=null,
      evaluation_count=evaluation_count+case when last_candle_at is null or $3>last_candle_at then 1 else 0 end,
      signal_count=signal_count+case when (last_candle_at is null or $3>last_candle_at)
        and $5::jsonb->>'action' is distinct from 'hold' then 1 else 0 end,
      updated_at=$4 where id=$1 and lease_owner=$2`,
    [run.id, owner, candleCloseAt, now, this.#sql.json(jsonValue(signal))]);
  }

  async release(runId: string, owner: string, now: number): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set lease_owner=null,lease_expires_at=null,
      updated_at=greatest(updated_at,$3) where id=$1 and lease_owner=$2`, [runId, owner, now]);
  }

  async fail(run: CloudRun, owner: string, code: string, now: number, terminal = false): Promise<void> {
    const safe = /^[a-z0-9_-]{1,64}$/.test(code) ? code : "execution_failed";
    await this.#sql.unsafe(`update public.cloud_strategy_runs set consecutive_failures=consecutive_failures+1,
      last_error_code=$3,last_evaluated_at=$4,lease_owner=null,lease_expires_at=null,updated_at=$4,
      state=case when $5::boolean or consecutive_failures+1 >= least(10,greatest(1,coalesce((risk_json->>'maxConsecutiveFailures')::bigint,3)))
        then 'error' else state end where id=$1 and lease_owner=$2`, [run.id, owner, safe, now, terminal]);
  }

  async close(): Promise<void> { await this.#sql.end({ timeout: 5 }); }
}
