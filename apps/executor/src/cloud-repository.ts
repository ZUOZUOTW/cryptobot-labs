import postgres, { type Sql } from "postgres";
import type { EncryptedWeexCredentials } from "@cryptobot-labs/weex-client";

type Database = Sql<Record<string, never>>;
type Row = Record<string, unknown>;

export interface CloudRun {
  id: string; userId: string; connectionId: string; mode: "futures-demo" | "live";
  version: number; config: Record<string, unknown>; risk: Record<string, unknown>;
  lastCandleAt: number | null; lastEvaluatedAt: number | null;
}
export interface StoredCredential {
  envelope: EncryptedWeexCredentials;
  context: Readonly<Record<string, string>>;
}
export interface ClaimedOrder {
  status: "claimed" | "risk-rejected" | "acknowledged" | "rejected" | "unknown";
  exchangeOrderId: string | null;
}
export interface AccountSnapshot {
  asset: string;
  observedAt: number;
  equity: string;
  availableEquity: string;
  unrealizedPnl: string;
  positions: readonly unknown[];
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} is invalid`);
  return parsed as Record<string, unknown>;
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

export class CloudRuntimeRepository {
  readonly #sql: Database;
  constructor(databaseUrl: string, private readonly shardId: string) {
    this.#sql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: "require" });
  }

  async assertReady(): Promise<void> {
    const rows = await this.#sql.unsafe(`select to_regclass('public.cloud_strategy_runs') as runs,
      to_regclass('private.cloud_order_intents') as orders`);
    if (!rows[0] || Object.values(rows[0] as Row).some((value) => typeof value !== "string")) {
      throw new Error("Cloud runtime database schema is not ready");
    }
  }

  async claimRuns(owner: string, now: number, limit = 10): Promise<CloudRun[]> {
    const rows = await this.#sql.unsafe(`update public.cloud_strategy_runs set lease_owner=$1,
      lease_expires_at=$2+30000,updated_at=greatest(updated_at,$2)
      where id in (select id from public.cloud_strategy_runs
        where executor_shard_id=$3 and state='running' and (lease_expires_at is null or lease_expires_at<$2 or lease_owner=$1)
        order by coalesce(last_evaluated_at,0),created_at limit $4 for update skip locked)
      returning id,user_id,connection_id,mode,version,config_json,risk_json,last_candle_at,last_evaluated_at`,
    [owner, now, this.shardId, limit]);
    return rows.map((row) => {
      const value = row as Row;
      if ((value.mode !== "futures-demo" && value.mode !== "live") || typeof value.id !== "string"
        || typeof value.user_id !== "string" || typeof value.connection_id !== "string") throw new Error("Cloud run is invalid");
      return { id: value.id, userId: value.user_id, connectionId: value.connection_id, mode: value.mode,
        version: integer(value.version), config: object(value.config_json, "strategy config"),
        risk: object(value.risk_json, "risk policy"),
        lastCandleAt: value.last_candle_at === null ? null : integer(value.last_candle_at),
        lastEvaluatedAt: value.last_evaluated_at === null ? null : integer(value.last_evaluated_at) };
    });
  }

  async credential(connectionId: string, userId: string): Promise<StoredCredential> {
    const rows = await this.#sql.unsafe(`select kms_key_id,encrypted_data_key,initialization_vector,
      credential_ciphertext,encryption_context_json from private.weex_credential_blobs
      where connection_id=$1 and user_id=$2`, [connectionId, userId]);
    const row = rows[0] as Row | undefined;
    if (!row || typeof row.kms_key_id !== "string") throw new Error("Cloud credential is unavailable");
    const rawContext = object(row.encryption_context_json, "credential context");
    if (Object.values(rawContext).some((value) => typeof value !== "string")) throw new Error("Credential context is invalid");
    return { envelope: { version: 1, keyId: row.kms_key_id, encryptedDataKey: bytes(row.encrypted_data_key),
      initializationVector: bytes(row.initialization_vector), ciphertext: bytes(row.credential_ciphertext) },
      context: rawContext as Record<string, string> };
  }

  async claimOrder(input: { runId: string; candleCloseAt: number; clientOrderId: string;
    signal: unknown; now: number }): Promise<ClaimedOrder> {
    await this.#sql.unsafe(`insert into private.cloud_order_intents
      (run_id,candle_close_at,client_order_id,signal_json,status,created_at,updated_at)
      values ($1,$2,$3,$4::jsonb,'claimed',$5,$5) on conflict(run_id,candle_close_at) do nothing`,
    [input.runId, input.candleCloseAt, input.clientOrderId, JSON.stringify(input.signal), input.now]);
    const rows = await this.#sql.unsafe(`select status,exchange_order_id from private.cloud_order_intents
      where run_id=$1 and candle_close_at=$2 and client_order_id=$3`,
    [input.runId, input.candleCloseAt, input.clientOrderId]);
    const row = rows[0] as Row | undefined;
    if (!row || !["claimed", "risk-rejected", "acknowledged", "rejected", "unknown"].includes(String(row.status))) {
      throw new Error("Cloud order claim conflict");
    }
    return { status: row.status as ClaimedOrder["status"],
      exchangeOrderId: typeof row.exchange_order_id === "string" ? row.exchange_order_id : null };
  }

  async recordOrder(input: { runId: string; candleCloseAt: number; status: ClaimedOrder["status"];
    intent?: unknown; exchangeOrderId?: string; errorCode?: string; now: number }): Promise<void> {
    await this.#sql.unsafe(`update private.cloud_order_intents set status=$3,intent_json=$4::jsonb,
      exchange_order_id=$5,error_code=$6,updated_at=$7 where run_id=$1 and candle_close_at=$2`,
    [input.runId, input.candleCloseAt, input.status, input.intent ? JSON.stringify(input.intent) : null,
      input.exchangeOrderId ?? null, input.errorCode ?? null, input.now]);
  }

  async recordAccountSnapshot(run: CloudRun, owner: string, snapshot: AccountSnapshot): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set account_asset=$3,account_observed_at=$4,
      account_equity=$5::numeric,available_equity=$6::numeric,unrealized_pnl=$7::numeric,
      positions_json=$8::jsonb,updated_at=greatest(updated_at,$4)
      where id=$1 and lease_owner=$2`, [run.id, owner, snapshot.asset, snapshot.observedAt, snapshot.equity,
      snapshot.availableEquity, snapshot.unrealizedPnl, JSON.stringify(snapshot.positions)]);
  }

  async complete(run: CloudRun, owner: string, candleCloseAt: number, signal: unknown, now: number): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set last_candle_at=$3,last_evaluated_at=$4,
      last_signal_json=$5::jsonb,last_error_code=null,consecutive_failures=0,lease_owner=null,lease_expires_at=null,
      evaluation_count=evaluation_count+1,
      signal_count=signal_count+case when $5::jsonb->>'action' is distinct from 'hold' then 1 else 0 end,
      updated_at=$4 where id=$1 and lease_owner=$2`, [run.id, owner, candleCloseAt, now, JSON.stringify(signal)]);
  }

  async release(runId: string, owner: string, now: number): Promise<void> {
    await this.#sql.unsafe(`update public.cloud_strategy_runs set lease_owner=null,lease_expires_at=null,
      updated_at=greatest(updated_at,$3) where id=$1 and lease_owner=$2`, [runId, owner, now]);
  }

  async fail(run: CloudRun, owner: string, code: string, now: number): Promise<void> {
    const safe = /^[a-z0-9_-]{1,64}$/.test(code) ? code : "execution_failed";
    await this.#sql.unsafe(`update public.cloud_strategy_runs set consecutive_failures=consecutive_failures+1,
      last_error_code=$3,last_evaluated_at=$4,lease_owner=null,lease_expires_at=null,updated_at=$4,
      state=case when consecutive_failures+1 >= least(10,greatest(1,coalesce((risk_json->>'maxConsecutiveFailures')::bigint,3)))
        then 'error' else state end where id=$1 and lease_owner=$2`, [run.id, owner, safe, now]);
  }

  async close(): Promise<void> { await this.#sql.end({ timeout: 5 }); }
}
