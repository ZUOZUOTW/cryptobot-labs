import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  ControlPlaneDatabase,
  ControlPlaneRunResult,
  ControlPlaneStatement,
} from "../db";
import {
  createDeviceCredentialRepository,
  createDeviceNonceRepository,
  createDeviceRepository,
  createPairingCodeRepository,
  createUserRepository,
} from "../db/repositories";

class SqliteStatement implements ControlPlaneStatement {
  readonly #statement: StatementSync;
  readonly #values: unknown[];

  constructor(statement: StatementSync, values: unknown[] = []) {
    this.#statement = statement;
    this.#values = values;
  }

  bind(...values: unknown[]): ControlPlaneStatement {
    return new SqliteStatement(this.#statement, values);
  }

  async first<T>(): Promise<T | null> {
    return (this.#statement.get(...this.#values as Parameters<StatementSync["get"]>) as T | undefined) ?? null;
  }

  async all<T>(): Promise<{ results: T[]; success: boolean }> {
    return { results: this.#statement.all(...this.#values as Parameters<StatementSync["all"]>) as T[], success: true };
  }

  async run(): Promise<ControlPlaneRunResult> {
    const result = this.#statement.run(...this.#values as Parameters<StatementSync["run"]>);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class SqliteDatabase implements ControlPlaneDatabase {
  readonly raw = new DatabaseSync(":memory:");

  constructor() {
    this.raw.exec("PRAGMA foreign_keys = ON");
    const migrationFile = readdirSync(resolve("drizzle")).find((file) => file.endsWith(".sql"));
    if (!migrationFile) throw new Error("migration missing");
    const migration = readFileSync(resolve("drizzle", migrationFile), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim()) this.raw.exec(statement);
    }
  }

  prepare(sql: string): ControlPlaneStatement {
    return new SqliteStatement(this.raw.prepare(sql));
  }

  async batch<T extends readonly ControlPlaneStatement[]>(statements: T): Promise<ControlPlaneRunResult[]> {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results: ControlPlaneRunResult[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

const publicKeyJwk = { kty: "OKP", crv: "Ed25519", x: "A".repeat(43), ext: true, key_ops: ["verify"] };
const pairingHash = "a".repeat(64);
const credentialHash = "b".repeat(64);

describe("scoped control-plane repositories", () => {
  let database: SqliteDatabase;
  let users: ReturnType<typeof createUserRepository>;
  let devices: ReturnType<typeof createDeviceRepository>;
  let pairing: ReturnType<typeof createPairingCodeRepository>;
  let credentials: ReturnType<typeof createDeviceCredentialRepository>;
  let nonces: ReturnType<typeof createDeviceNonceRepository>;

  beforeEach(async () => {
    database = new SqliteDatabase();
    users = createUserRepository(database);
    devices = createDeviceRepository(database);
    pairing = createPairingCodeRepository(database);
    credentials = createDeviceCredentialRepository(database);
    nonces = createDeviceNonceRepository(database);
    await users.upsertIdentity({ id: "usr_a", email: " A@Example.com ", displayName: "Alice", now: 10 });
    await users.upsertIdentity({ id: "usr_b", email: "b@example.com", displayName: "Bob", now: 10 });
    await devices.create({ id: "dev_a", userId: "usr_a", name: "Alice Mac", platform: "macos", publicKeyJwk, now: 20 });
    await devices.create({ id: "dev_b", userId: "usr_b", name: "Bob PC", platform: "windows", publicKeyJwk, now: 20 });
  });

  it("normalizes identities and fails closed on email ownership collisions", async () => {
    expect((await users.getById("usr_a"))?.normalizedEmail).toBe("a@example.com");
    await expect(users.upsertIdentity({ id: "usr_c", email: "A@example.com", displayName: "Mallory", now: 30 }))
      .rejects.toThrow();
    expect(await users.getById("usr_c")).toBeNull();
    await expect(users.upsertIdentity({ id: "usr_c", email: "not-an-email", displayName: "Mallory", now: 30 }))
      .rejects.toThrow(/email/i);
  });

  it("makes cross-owner device reads and mutations invisible and bounds pagination", async () => {
    expect(await devices.get("usr_b", "dev_a")).toBeNull();
    expect(await devices.touch("usr_b", "dev_a", 40)).toBeNull();
    expect((await devices.get("usr_a", "dev_a"))?.lastSeenAt).toBeNull();
    expect(await devices.touch("usr_a", "dev_a", 41)).toMatchObject({ userId: "usr_a", lastSeenAt: 41 });
    expect(await devices.revoke("usr_b", "dev_a", 50)).toBeNull();
    expect((await devices.get("usr_a", "dev_a"))?.status).toBe("active");
    await expect(devices.list("usr_a", { limit: 101 })).rejects.toThrow(/limit/);
    expect((await devices.list("usr_a", { limit: 1 })).items).toHaveLength(1);
  });

  it("consumes a pairing hash exactly once and rejects expiry", async () => {
    await pairing.issue({ id: "pair_a", userId: "usr_a", codeHash: pairingHash, now: 100, expiresAt: 200 });
    expect(await pairing.consume(pairingHash, 150)).toMatchObject({ id: "pair_a", userId: "usr_a", consumedAt: 150 });
    expect(await pairing.consume(pairingHash, 151)).toBeNull();
    await pairing.issue({ id: "pair_b", userId: "usr_b", codeHash: "c".repeat(64), now: 100, expiresAt: 120 });
    expect(await pairing.consume("c".repeat(64), 120)).toBeNull();
  });

  it("stores only device credential hashes and revokes device plus credential atomically", async () => {
    await expect(credentials.create({ userId: "usr_b", deviceId: "dev_a", credentialHash, now: 90, expiresAt: 1_000 }))
      .rejects.toThrow(/owned/);
    await credentials.create({ userId: "usr_a", deviceId: "dev_a", credentialHash, now: 100, expiresAt: 1_000 });
    expect(await credentials.verifyForAuthenticatedDevice("dev_a", credentialHash, 200))
      .toMatchObject({ deviceId: "dev_a", userId: "usr_a" });
    expect(await credentials.revoke("usr_b", "dev_a", 250)).toBe(false);
    expect(await credentials.verifyForAuthenticatedDevice("dev_a", credentialHash, 251)).not.toBeNull();
    expect(JSON.stringify(database.raw.prepare("SELECT * FROM device_credentials").all())).not.toContain("opaque-plaintext");
    expect(database.raw.prepare("SELECT credential_hash FROM device_credentials").get()).toEqual({ credential_hash: credentialHash });

    await devices.revoke("usr_a", "dev_a", 300);
    expect((await devices.get("usr_a", "dev_a"))?.status).toBe("revoked");
    expect(await credentials.verifyForAuthenticatedDevice("dev_a", credentialHash, 301)).toBeNull();
    expect(database.raw.prepare("SELECT revoked_at FROM device_credentials WHERE device_id = ?").get("dev_a"))
      .toEqual({ revoked_at: 300 });
  });

  it("claims each device nonce once and purges only a bounded expired page", async () => {
    expect(await nonces.claim({ id: "nonce_cross", userId: "usr_b", deviceId: "dev_a", nonce: "x".repeat(32), timestamp: 99, expiresAt: 200, now: 99 })).toBe(false);
    expect(await nonces.claim({ id: "nonce_a", userId: "usr_a", deviceId: "dev_a", nonce: "n".repeat(32), timestamp: 100, expiresAt: 200, now: 100 })).toBe(true);
    expect(await nonces.claim({ id: "nonce_b", userId: "usr_a", deviceId: "dev_a", nonce: "n".repeat(32), timestamp: 101, expiresAt: 201, now: 101 })).toBe(false);
    expect(await nonces.claim({ id: "nonce_c", userId: "usr_b", deviceId: "dev_b", nonce: "n".repeat(32), timestamp: 101, expiresAt: 201, now: 101 })).toBe(true);
    expect(await nonces.purgeExpired("usr_b", "dev_a", 500, 1)).toBe(0);
    await expect(nonces.purgeExpired("usr_a", "dev_a", 500, 101)).rejects.toThrow(/limit/);
    expect(await nonces.purgeExpired("usr_a", "dev_a", 500, 1)).toBe(1);
    expect(database.raw.prepare("SELECT count(*) AS count FROM device_nonces WHERE device_id = ?").get("dev_b"))
      .toEqual({ count: 1 });
  });

  it("rejects private JWK material, raw credential-shaped inputs, and invalid times", async () => {
    await expect(devices.create({
      id: "dev_private", userId: "usr_a", name: "bad", platform: "macos",
      publicKeyJwk: { ...publicKeyJwk, d: "private" }, now: 30,
    })).rejects.toThrow(/public/i);
    await expect(credentials.create({
      userId: "usr_a", deviceId: "dev_a", credentialHash: "opaque-plaintext", now: 100, expiresAt: 200,
    })).rejects.toThrow(/hash/i);
    await expect(credentials.create({
      userId: "usr_a", deviceId: "dev_a", credentialHash, now: 100, expiresAt: 200, secretKey: "raw-secret",
    } as never)).rejects.toThrow(/sensitive/i);
    await expect(pairing.issue({ id: "pair_bad", userId: "usr_a", codeHash: pairingHash, now: 200, expiresAt: 200 }))
      .rejects.toThrow(/expiresAt/);
  });
});
