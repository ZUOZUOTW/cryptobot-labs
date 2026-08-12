import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  unsafe: vi.fn(),
  json: vi.fn((value: unknown) => ({ json: value })),
  begin: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: vi.fn(() => database),
}));

import { PostgresOAuthRepository, type StoredOAuthState } from "../src/oauth-repository";

const state: StoredOAuthState = {
  id: "woauth_abcdefghijklmnop",
  connectionId: "conn_abcdefghijklmnop",
  userId: "user_abcdefghijklmnop",
  stateHash: "a".repeat(43),
  sessionHash: "b".repeat(43),
  redirectUri: "https://example.com/callback",
  keyId: "kms-key",
  encryptedDataKey: Uint8Array.of(1),
  initializationVector: new Uint8Array(12).fill(2),
  ciphertext: new Uint8Array(17).fill(3),
  context: { purpose: "oauth", connection_version: "7" },
  connectionVersion: 7,
  expiresAt: 1_700_000_600_000,
};

describe("PostgresOAuthRepository connection lifecycle fencing", () => {
  beforeEach(() => {
    database.unsafe.mockReset();
    database.json.mockClear();
    database.begin.mockReset();
  });

  it("atomically clears stale authorization and pauses every nonterminal run before reauthorization", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce([{ id: state.connectionId, version: state.connectionVersion }])
        .mockResolvedValueOnce(Object.assign([], { count: 2 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await expect(repository.prepareConnection({
      candidateId: "conn_newabcdefghijklmnop",
      userId: state.userId,
      shardId: "exec_abcdefghijklmnop",
      credentialSource: "manual",
      now: 1_700_000_000_000,
    })).resolves.toEqual({ id: state.connectionId, version: state.connectionVersion });

    const connectionSql = String(transaction.unsafe.mock.calls[0]?.[0]);
    const runsSql = String(transaction.unsafe.mock.calls[1]?.[0]);
    expect(connectionSql).toContain("status='pending'");
    expect(connectionSql).toContain("permissions_json='{}'::jsonb");
    expect(connectionSql).toContain("withdrawal_access_absent=false");
    expect(connectionSql).toContain("verified_at=null");
    expect(runsSql).toContain("state='paused'");
    expect(runsSql).toContain("state<>'stopped'");
    expect(runsSql).toContain("lease_owner=null");
    expect(runsSql).toContain("lease_expires_at=null");
    expect(transaction.unsafe.mock.calls[1]?.[1]).toContain("connection_reauthorization_required");
  });

  it("atomically pauses leased runs when manual verification fails", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.failConnection({
      connectionId: state.connectionId,
      userId: state.userId,
      expectedConnectionVersion: state.connectionVersion,
      credentialSource: "manual",
      now: 1_700_000_000_000,
    });

    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='error'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("permissions_json='{}'::jsonb");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$5");
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("state='paused'");
    expect(transaction.unsafe.mock.calls[1]?.[1]).toContain("connection_verification_failed");
  });

  it("fails OAuth state and pauses runs in the same transaction", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.failState({ state, code: "authorization_denied", now: 1_700_000_000_000 });

    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='failed'");
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("status='error'");
    expect(String(transaction.unsafe.mock.calls[2]?.[0])).toContain("state='paused'");
    expect(String(transaction.unsafe.mock.calls[2]?.[0])).toContain("state<>'stopped'");
  });

  it("never changes paused runs back to running when replacement credentials succeed", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.completeManualConnection({
      connectionId: state.connectionId,
      userId: state.userId,
      expectedConnectionVersion: state.connectionVersion,
      credentialEnvelope: {
        version: 1,
        keyId: "kms-key",
        encryptedDataKey: Uint8Array.of(1),
        initializationVector: new Uint8Array(12).fill(2),
        ciphertext: new Uint8Array(17).fill(3),
      },
      credentialContext: { purpose: "manual" },
      maskedApiKeySuffix: "1234",
      permissions: {
        read: true,
        spotTrade: false,
        futuresTrade: false,
        futuresDemoTrade: true,
        withdrawal: false,
        liveVerified: false,
      },
      now: 1_700_000_000_000,
    });

    const allSql = transaction.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$7");
    expect(allSql).not.toContain("cloud_strategy_runs");
    expect(allSql).not.toContain("state='running'");
  });

  it("also leaves runs paused after OAuth credential replacement succeeds", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 1 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.completeState({
      state,
      credentialEnvelope: {
        version: 1,
        keyId: "kms-key",
        encryptedDataKey: Uint8Array.of(1),
        initializationVector: new Uint8Array(12).fill(2),
        ciphertext: new Uint8Array(17).fill(3),
      },
      credentialContext: { purpose: "oauth" },
      maskedApiKeySuffix: "1234",
      now: 1_700_000_000_000,
    });

    const allSql = transaction.unsafe.mock.calls.map((call) => String(call[0])).join("\n");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$6");
    expect(allSql).not.toContain("cloud_strategy_runs");
    expect(allSql).not.toContain("state='running'");
  });

  it("does not let a stale OAuth callback overwrite the current connection generation", async () => {
    const transaction = {
      unsafe: vi.fn().mockResolvedValueOnce(Object.assign([], { count: 0 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await expect(repository.completeState({
      state: { ...state, connectionVersion: state.connectionVersion - 1 },
      credentialEnvelope: {
        version: 1, keyId: "old-kms-key", encryptedDataKey: Uint8Array.of(1),
        initializationVector: new Uint8Array(12).fill(2), ciphertext: new Uint8Array(17).fill(3),
      },
      credentialContext: { purpose: "oauth", connection_version: "6" },
      maskedApiKeySuffix: "0000",
      now: 1_700_000_000_000,
    })).rejects.toThrow("attempt is stale");

    expect(transaction.unsafe).toHaveBeenCalledOnce();
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$6");
  });

  it("records a stale OAuth failure without disabling or pausing the newer connection", async () => {
    const transaction = {
      unsafe: vi.fn()
        .mockResolvedValueOnce(Object.assign([], { count: 1 }))
        .mockResolvedValueOnce(Object.assign([], { count: 0 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.failState({ state: { ...state, connectionVersion: state.connectionVersion - 1 },
      code: "authorization_denied", now: 1_700_000_000_000 });

    expect(transaction.unsafe).toHaveBeenCalledTimes(2);
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[1]?.[0])).toContain("version=$4");
    expect(transaction.unsafe.mock.calls.map((call) => String(call[0])).join("\n"))
      .not.toContain("cloud_strategy_runs");
  });

  it("does not let a stale manual attempt overwrite newer credentials", async () => {
    const transaction = {
      unsafe: vi.fn().mockResolvedValueOnce(Object.assign([], { count: 0 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await expect(repository.completeManualConnection({
      connectionId: state.connectionId,
      userId: state.userId,
      expectedConnectionVersion: state.connectionVersion - 1,
      credentialEnvelope: {
        version: 1, keyId: "old-kms-key", encryptedDataKey: Uint8Array.of(1),
        initializationVector: new Uint8Array(12).fill(2), ciphertext: new Uint8Array(17).fill(3),
      },
      credentialContext: { purpose: "manual", connection_version: "6" },
      maskedApiKeySuffix: "0000",
      permissions: { read: true, spotTrade: false, futuresTrade: false, futuresDemoTrade: true,
        withdrawal: false, liveVerified: false },
      now: 1_700_000_000_000,
    })).rejects.toThrow("attempt is stale");

    expect(transaction.unsafe).toHaveBeenCalledOnce();
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$7");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
  });

  it("does not let a stale failed attempt disable the newer active connection", async () => {
    const transaction = {
      unsafe: vi.fn().mockResolvedValueOnce(Object.assign([], { count: 0 })),
      json: database.json,
    };
    database.begin.mockImplementationOnce(async (callback: (sql: typeof transaction) => Promise<unknown>) =>
      callback(transaction));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await repository.failConnection({ connectionId: state.connectionId, userId: state.userId,
      expectedConnectionVersion: state.connectionVersion - 1, credentialSource: "manual", now: 1_700_000_000_000 });

    expect(transaction.unsafe).toHaveBeenCalledOnce();
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("status='pending'");
    expect(String(transaction.unsafe.mock.calls[0]?.[0])).toContain("version=$5");
  });

  it("fences OAuth state consumption to the attempt generation", async () => {
    database.unsafe.mockResolvedValueOnce(Object.assign([], { count: 0 }));
    const repository = new PostgresOAuthRepository("postgres://executor.invalid/database");

    await expect(repository.consumeState(state.id, state.stateHash, state.connectionVersion, 1_700_000_000_000))
      .resolves.toBe(false);

    expect(String(database.unsafe.mock.calls[0]?.[0])).toContain("c.status='pending'");
    expect(String(database.unsafe.mock.calls[0]?.[0])).toContain("c.version=$4");
    expect(database.unsafe.mock.calls[0]?.[1]).toEqual([
      state.id, state.stateHash, 1_700_000_000_000, state.connectionVersion,
    ]);
  });
});
