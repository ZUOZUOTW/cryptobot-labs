import postgres, { type Sql } from "postgres";
import type {
  EncryptedWeexCredentials,
  ExecutorOAuthHandoff,
  WeexCredentialSource,
} from "@cryptobot-labs/weex-client";
import {
  assertPostgresRuntimeIdentity,
  POSTGRES_RUNTIME_IDENTITY_SQL,
} from "../../../lib/server/postgres-runtime-readiness.js";

type Database = Sql<Record<string, never>>;
type Row = Record<string, unknown>;
const CONNECTION_REAUTHORIZATION_REQUIRED = "connection_reauthorization_required";
const CONNECTION_VERIFICATION_FAILED = "connection_verification_failed";

export interface StoredOAuthState {
  readonly id: string;
  readonly connectionId: string;
  readonly userId: string;
  readonly stateHash: string;
  readonly sessionHash: string;
  readonly redirectUri: string;
  readonly keyId: string;
  readonly encryptedDataKey: Uint8Array;
  readonly initializationVector: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly context: Readonly<Record<string, string>>;
  readonly connectionVersion: number;
  readonly expiresAt: number;
}

export interface PreparedConnection {
  readonly id: string;
  readonly version: number;
}

export interface OAuthRepository {
  assertReady(): Promise<void>;
  registerShard(input: { shardId: string; region: string; egressIp: string; now: number }): Promise<void>;
  reserveHandoff(input: { handoff: ExecutorOAuthHandoff; nonceHash: string; now: number }): Promise<void>;
  prepareConnection(input: { candidateId: string; userId: string; shardId: string;
    credentialSource: WeexCredentialSource; now: number }): Promise<PreparedConnection>;
  createState(input: { id: string; connectionId: string; userId: string; stateHash: string; sessionHash: string;
    connectionVersion: number; redirectUri: string; expiresAt: number; now: number; envelope: EncryptedWeexCredentials;
    context: Readonly<Record<string, string>> }): Promise<void>;
  findState(stateHash: string): Promise<StoredOAuthState | null>;
  consumeState(id: string, stateHash: string, connectionVersion: number, now: number): Promise<boolean>;
  completeState(input: { state: StoredOAuthState; credentialEnvelope: EncryptedWeexCredentials;
    credentialContext: Readonly<Record<string, string>>; maskedApiKeySuffix: string; now: number }): Promise<void>;
  completeManualConnection(input: { connectionId: string; userId: string;
    expectedConnectionVersion: number;
    credentialEnvelope: EncryptedWeexCredentials; credentialContext: Readonly<Record<string, string>>;
    maskedApiKeySuffix: string; permissions: Readonly<Record<string, boolean>>; now: number }): Promise<void>;
  failConnection(input: { connectionId: string; userId: string;
    expectedConnectionVersion: number; credentialSource: WeexCredentialSource; now: number }): Promise<void>;
  failState(input: { state: StoredOAuthState; code: string; now: number }): Promise<void>;
  close(): Promise<void>;
}

const number = (value: unknown, label: string): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} is invalid`);
  return parsed;
};
const bytes = (value: unknown, label: string): Uint8Array => {
  if (!(value instanceof Uint8Array) || value.byteLength < 1) throw new Error(`${label} is invalid`);
  return Uint8Array.from(value);
};
const context = (value: unknown): Readonly<Record<string, string>> => {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.values(parsed).some((item) => typeof item !== "string")) throw new Error("encryption context is invalid");
  return Object.freeze({ ...(parsed as Record<string, string>) });
};
const connectionVersion = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("connection version is invalid");
  return parsed;
};

export class PostgresOAuthRepository implements OAuthRepository {
  readonly #sql: Database;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 4, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: "require" });
  }

  async assertReady(): Promise<void> {
    const identities = await this.#sql.unsafe(POSTGRES_RUNTIME_IDENTITY_SQL);
    assertPostgresRuntimeIdentity(identities[0], "cryptobot_executor");
    const rows = await this.#sql.unsafe(`select
      to_regclass('public.weex_connections') as connections,
      to_regclass('private.weex_oauth_states') as states,
      to_regclass('private.weex_credential_blobs') as credentials,
      to_regclass('private.weex_oauth_handoffs') as handoffs,
      exists (
        select 1 from information_schema.columns
        where table_schema='public' and table_name='weex_connections' and column_name='credential_source'
      ) as credential_source_ready`);
    const row = rows[0] as Row | undefined;
    if (!row || ["connections", "states", "credentials", "handoffs"]
      .some((key) => typeof row[key] !== "string") || row.credential_source_ready !== true) {
      throw new Error("OAuth database schema is not ready");
    }
  }

  async registerShard(input: { shardId: string; region: string; egressIp: string; now: number }): Promise<void> {
    await this.#sql.unsafe(`insert into public.executor_shards
      (id,name,region,egress_ip,status,last_seen_at,created_at,updated_at) values ($1,$2,$3,$4,'ready',$5,$5,$5)
      on conflict(id) do update set region=excluded.region,egress_ip=excluded.egress_ip,status='ready',
      last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`,
    [input.shardId, "CryptoBot Labs production executor", input.region, input.egressIp, input.now]);
  }

  async reserveHandoff(input: { handoff: ExecutorOAuthHandoff; nonceHash: string; now: number }): Promise<void> {
    await this.#sql.unsafe(`insert into private.weex_oauth_handoffs
      (nonce_hash,user_id,action,expires_at,consumed_at,created_at) values ($1,$2,$3,$4,$5,$5)`,
    [input.nonceHash, input.handoff.userId, input.handoff.action, input.handoff.expiresAt, input.now]);
  }

  async prepareConnection(input: { candidateId: string; userId: string; shardId: string;
    credentialSource: WeexCredentialSource; now: number }): Promise<PreparedConnection> {
    return this.#sql.begin(async (transaction) => {
      const rows = await transaction.unsafe(`insert into public.weex_connections
        (id,user_id,executor_shard_id,provider,credential_source,status,permissions_json,
         withdrawal_access_absent,version,created_at,updated_at)
        values ($1,$2,$3,'weex',$4,'pending','{}'::jsonb,false,1,$5,$5)
        on conflict(user_id,provider) do update set executor_shard_id=excluded.executor_shard_id,status='pending',
        credential_source=excluded.credential_source,permissions_json='{}'::jsonb,
        withdrawal_access_absent=false,verified_at=null,revoked_at=null,
        version=public.weex_connections.version+1,updated_at=excluded.updated_at returning id,version`,
      [input.candidateId, input.userId, input.shardId, input.credentialSource, input.now]);
      const row = rows[0] as Row | undefined;
      const id = row?.id;
      if (typeof id !== "string") throw new Error("WEEX connection preparation failed");
      const version = connectionVersion(row?.version);
      await transaction.unsafe(`update public.cloud_strategy_runs set state='paused',version=version+1,
        last_error_code=$3,lease_owner=null,lease_expires_at=null,updated_at=greatest(updated_at,$4)
        where connection_id=$1 and user_id=$2 and state<>'stopped'`,
      [id, input.userId, CONNECTION_REAUTHORIZATION_REQUIRED, input.now]);
      return Object.freeze({ id, version });
    });
  }

  async createState(input: { id: string; connectionId: string; userId: string; stateHash: string; sessionHash: string;
    connectionVersion: number; redirectUri: string; expiresAt: number; now: number; envelope: EncryptedWeexCredentials;
    context: Readonly<Record<string, string>> }): Promise<void> {
    const result = await this.#sql.unsafe(`insert into private.weex_oauth_states
      (id,connection_id,user_id,state_hash,session_hash,redirect_uri,promoter_slug,kms_key_id,encrypted_data_key,
       initialization_vector,code_verifier_ciphertext,encryption_context_json,status,expires_at,created_at,updated_at)
      select $1,$2,$3,$4,$5,$6,null,$7,$8,$9,$10,$11::jsonb,'init',$12,$13,$13
      from public.weex_connections
      where id=$2 and user_id=$3 and credential_source='oauth' and status='pending' and version=$14`,
    [input.id, input.connectionId, input.userId, input.stateHash, input.sessionHash, input.redirectUri,
      input.envelope.keyId, input.envelope.encryptedDataKey, input.envelope.initializationVector,
      input.envelope.ciphertext, this.#sql.json(input.context), input.expiresAt, input.now,
      connectionVersion(input.connectionVersion)]);
    if (result.count !== 1) throw new Error("OAuth connection source conflict");
  }

  async findState(stateHash: string): Promise<StoredOAuthState | null> {
    const rows = await this.#sql.unsafe(`select id,connection_id,user_id,state_hash,session_hash,redirect_uri,kms_key_id,
      encrypted_data_key,initialization_vector,code_verifier_ciphertext,encryption_context_json,expires_at
      from private.weex_oauth_states where state_hash=$1 and status='init' and consumed_at is null limit 1`, [stateHash]);
    const row = rows[0] as Row | undefined;
    if (!row) return null;
    const storedContext = context(row.encryption_context_json);
    let storedConnectionVersion: number;
    try { storedConnectionVersion = connectionVersion(storedContext.connection_version); }
    catch { return null; }
    return Object.freeze({ id: String(row.id), connectionId: String(row.connection_id), userId: String(row.user_id),
      stateHash: String(row.state_hash), sessionHash: String(row.session_hash), redirectUri: String(row.redirect_uri),
      keyId: String(row.kms_key_id), encryptedDataKey: bytes(row.encrypted_data_key, "encrypted data key"),
      initializationVector: bytes(row.initialization_vector, "initialization vector"),
      ciphertext: bytes(row.code_verifier_ciphertext, "PKCE ciphertext"), context: storedContext,
      connectionVersion: storedConnectionVersion,
      expiresAt: number(row.expires_at, "OAuth expiry") });
  }

  async consumeState(id: string, stateHash: string, expectedConnectionVersion: number, now: number): Promise<boolean> {
    const result = await this.#sql.unsafe(`update private.weex_oauth_states set status='processing',consumed_at=$3,updated_at=$3
      where id=$1 and state_hash=$2 and status='init' and consumed_at is null and expires_at>$3
        and exists (
          select 1 from public.weex_connections c
          where c.id=private.weex_oauth_states.connection_id
            and c.user_id=private.weex_oauth_states.user_id
            and c.credential_source='oauth' and c.status='pending' and c.version=$4
        )`, [id, stateHash, now, connectionVersion(expectedConnectionVersion)]);
    return result.count === 1;
  }

  async completeState(input: { state: StoredOAuthState; credentialEnvelope: EncryptedWeexCredentials;
    credentialContext: Readonly<Record<string, string>>; maskedApiKeySuffix: string; now: number }): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const connection = await transaction.unsafe(`update public.weex_connections set status='active',masked_api_key_suffix=$3,
        permissions_json=$4::jsonb,withdrawal_access_absent=true,verified_at=$5,revoked_at=null,updated_at=$5
        where id=$1 and user_id=$2 and credential_source='oauth' and status='pending' and version=$6
          and exists (select 1 from private.weex_oauth_states s where s.id=$7 and s.connection_id=$1
            and s.user_id=$2 and s.status='processing')`,
      [input.state.connectionId, input.state.userId, input.maskedApiKeySuffix,
        transaction.json({ read: true, spotTrade: false, futuresTrade: false, futuresDemoTrade: false,
          withdrawal: false, liveVerified: false }), input.now,
        connectionVersion(input.state.connectionVersion), input.state.id]);
      if (connection.count !== 1) throw new Error("OAuth connection attempt is stale");
      await transaction.unsafe(`insert into private.weex_credential_blobs
        (connection_id,user_id,kms_key_id,encrypted_data_key,initialization_vector,credential_ciphertext,
         encryption_context_json,credential_version,created_at,rotated_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8,null,$8)
        on conflict(connection_id) do update set kms_key_id=excluded.kms_key_id,encrypted_data_key=excluded.encrypted_data_key,
        initialization_vector=excluded.initialization_vector,credential_ciphertext=excluded.credential_ciphertext,
        encryption_context_json=excluded.encryption_context_json,credential_version=private.weex_credential_blobs.credential_version+1,
        rotated_at=excluded.updated_at,updated_at=excluded.updated_at`,
      [input.state.connectionId, input.state.userId, input.credentialEnvelope.keyId,
        input.credentialEnvelope.encryptedDataKey, input.credentialEnvelope.initializationVector,
        input.credentialEnvelope.ciphertext, transaction.json(input.credentialContext), input.now]);
      const state = await transaction.unsafe(`update private.weex_oauth_states set status='success',error_code=null,updated_at=$2
        where id=$1 and status='processing'`, [input.state.id, input.now]);
      if (state.count !== 1) throw new Error("OAuth completion conflict");
    });
  }

  async completeManualConnection(input: { connectionId: string; userId: string;
    expectedConnectionVersion: number;
    credentialEnvelope: EncryptedWeexCredentials; credentialContext: Readonly<Record<string, string>>;
    maskedApiKeySuffix: string; permissions: Readonly<Record<string, boolean>>; now: number }): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const connection = await transaction.unsafe(`update public.weex_connections
        set status='active',masked_api_key_suffix=$3,permissions_json=$4::jsonb,
        withdrawal_access_absent=$5,verified_at=$6,revoked_at=null,updated_at=$6
        where id=$1 and user_id=$2 and credential_source='manual' and status='pending' and version=$7`,
      [input.connectionId, input.userId, input.maskedApiKeySuffix, transaction.json(input.permissions),
        input.permissions.withdrawal === false, input.now, connectionVersion(input.expectedConnectionVersion)]);
      if (connection.count !== 1) throw new Error("Manual WEEX connection attempt is stale");
      await transaction.unsafe(`insert into private.weex_credential_blobs
        (connection_id,user_id,kms_key_id,encrypted_data_key,initialization_vector,credential_ciphertext,
         encryption_context_json,credential_version,created_at,rotated_at,updated_at)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8,null,$8)
        on conflict(connection_id) do update set kms_key_id=excluded.kms_key_id,
        encrypted_data_key=excluded.encrypted_data_key,initialization_vector=excluded.initialization_vector,
        credential_ciphertext=excluded.credential_ciphertext,encryption_context_json=excluded.encryption_context_json,
        credential_version=private.weex_credential_blobs.credential_version+1,
        rotated_at=excluded.updated_at,updated_at=excluded.updated_at`,
      [input.connectionId, input.userId, input.credentialEnvelope.keyId,
        input.credentialEnvelope.encryptedDataKey, input.credentialEnvelope.initializationVector,
        input.credentialEnvelope.ciphertext, transaction.json(input.credentialContext), input.now]);
    });
  }

  async failConnection(input: { connectionId: string; userId: string;
    expectedConnectionVersion: number; credentialSource: WeexCredentialSource; now: number }): Promise<void> {
    await this.#sql.begin(async (transaction) => {
      const connection = await transaction.unsafe(`update public.weex_connections set status='error',
        permissions_json='{}'::jsonb,withdrawal_access_absent=false,verified_at=null,updated_at=$3
        where id=$1 and user_id=$2 and credential_source=$4 and status='pending' and version=$5`,
      [input.connectionId, input.userId, input.now, input.credentialSource,
        connectionVersion(input.expectedConnectionVersion)]);
      if (connection.count !== 1) return;
      await transaction.unsafe(`update public.cloud_strategy_runs set state='paused',version=version+1,
        last_error_code=$3,lease_owner=null,lease_expires_at=null,updated_at=greatest(updated_at,$4)
        where connection_id=$1 and user_id=$2 and state<>'stopped'`,
      [input.connectionId, input.userId, CONNECTION_VERIFICATION_FAILED, input.now]);
    });
  }

  async failState(input: { state: StoredOAuthState; code: string; now: number }): Promise<void> {
    const safeCode = /^[a-z0-9_]{1,64}$/.test(input.code) ? input.code : "internal";
    await this.#sql.begin(async (transaction) => {
      await transaction.unsafe(`update private.weex_oauth_states set status='failed',error_code=$2,updated_at=$3
        where id=$1 and status='processing'`, [input.state.id, safeCode, input.now]);
      const connection = await transaction.unsafe(`update public.weex_connections set status='error',
        permissions_json='{}'::jsonb,withdrawal_access_absent=false,verified_at=null,updated_at=$3
        where id=$1 and user_id=$2 and credential_source='oauth' and status='pending' and version=$4`,
      [input.state.connectionId, input.state.userId, input.now,
        connectionVersion(input.state.connectionVersion)]);
      if (connection.count !== 1) return;
      await transaction.unsafe(`update public.cloud_strategy_runs set state='paused',version=version+1,
        last_error_code=$3,lease_owner=null,lease_expires_at=null,updated_at=greatest(updated_at,$4)
        where connection_id=$1 and user_id=$2 and state<>'stopped'`,
      [input.state.connectionId, input.state.userId, CONNECTION_VERIFICATION_FAILED, input.now]);
    });
  }

  async close(): Promise<void> { await this.#sql.end({ timeout: 5 }); }
}
