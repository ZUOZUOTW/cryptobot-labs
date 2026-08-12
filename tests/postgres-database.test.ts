import { describe, expect, it, vi } from "vitest";
import { createCloudRunRepository } from "../lib/server/cloud-runs";
import { createPostgresControlPlaneDatabase, PostgresControlPlaneDatabase } from "../lib/server/postgres-database";
import { POSTGRES_RUNTIME_IDENTITY_SQL } from "../lib/server/postgres-runtime-readiness.js";

const websiteIdentity = {
  current_role: "cryptobot_netlify",
  session_role: "cryptobot_netlify",
  current_superuser: false,
  current_bypassrls: false,
  session_superuser: false,
  session_bypassrls: false,
};

describe("Supabase Postgres D1 compatibility adapter", () => {
  it("verifies the formal website role before its first control-plane query", async () => {
    const unsafe = vi.fn()
      .mockResolvedValueOnce([websiteIdentity])
      .mockResolvedValueOnce([{ id: "u1" }]);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never, "cryptobot_netlify");

    await expect(database.prepare("select id from users where id=?").bind("u1").first())
      .resolves.toEqual({ id: "u1" });

    expect(unsafe).toHaveBeenCalledTimes(2);
    expect(unsafe.mock.calls[0]?.[0]).toBe(POSTGRES_RUNTIME_IDENTITY_SQL);
    expect(unsafe.mock.calls[1]).toEqual(["select id from users where id=$1", ["u1"]]);
  });

  it("fails closed before a website query when its database role is elevated or mismatched", async () => {
    const unsafe = vi.fn().mockResolvedValueOnce([{
      ...websiteIdentity,
      current_role: "postgres",
      session_role: "postgres",
      current_superuser: true,
    }]);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never, "cryptobot_netlify");

    await expect(database.prepare("select id from users").first())
      .rejects.toThrow("Postgres runtime identity is not ready");
    expect(unsafe).toHaveBeenCalledOnce();
  });

  it("retries identity evidence after a transient database failure", async () => {
    const unsafe = vi.fn()
      .mockRejectedValueOnce(new Error("temporary connection failure"))
      .mockResolvedValueOnce([websiteIdentity]);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never, "cryptobot_netlify");

    await expect(database.assertReady()).rejects.toThrow("temporary connection failure");
    await expect(database.assertReady()).resolves.toBeUndefined();
    expect(unsafe).toHaveBeenCalledTimes(2);
  });

  it("rejects a formal runtime URL whose configured login does not match the expected role", () => {
    expect(() => createPostgresControlPlaneDatabase(
      "postgresql://postgres:secret@example.test/postgres",
      "cryptobot_netlify",
    )).toThrow("cryptobot_netlify runtime role");
    expect(() => createPostgresControlPlaneDatabase(
      "postgresql://cryptobot_netlify.project:secret@example.test/postgres",
      "cryptobot_netlify",
    )).not.toThrow();
  });

  it("quotes camelCase aliases and translates placeholders", async () => {
    const rows = Object.assign([{ userId: "u1" }], { count: 1 });
    const unsafe = vi.fn(async () => rows);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never);
    await expect(database.prepare("SELECT user_id AS userId FROM users WHERE id = ?").bind("u1").first())
      .resolves.toEqual({ userId: "u1" });
    expect(unsafe).toHaveBeenCalledWith('SELECT user_id AS "userId" FROM users WHERE id = $1', ["u1"]);
  });

  it("quotes camelCase aliases when repositories use lowercase as", async () => {
    const rows = Object.assign([{ maskedApiKeySuffix: "d0d9" }], { count: 1 });
    const unsafe = vi.fn(async () => rows);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never);
    await expect(database.prepare("select masked_api_key_suffix as maskedApiKeySuffix from weex_connections")
      .first()).resolves.toEqual({ maskedApiKeySuffix: "d0d9" });
    expect(unsafe).toHaveBeenCalledWith(
      'select masked_api_key_suffix AS "maskedApiKeySuffix" from weex_connections',
      [],
    );
  });

  it("translates SQLite INSERT OR IGNORE", async () => {
    const result = Object.assign([], { count: 0 });
    const unsafe = vi.fn(async () => result);
    const database = new PostgresControlPlaneDatabase({ unsafe } as never);
    await database.prepare("INSERT OR IGNORE INTO device_nonces (id) VALUES (?)").bind("n1").run();
    expect(unsafe).toHaveBeenCalledWith("INSERT INTO device_nonces (id) VALUES ($1) ON CONFLICT DO NOTHING", ["n1"]);
  });

  it("preserves the quoted camelCase outer ordering used by the cloud-run CTE", async () => {
    const rows = Object.assign([], { count: 0 });
    const unsafe = vi.fn(async (sql: string, bindings: unknown[]) => {
      void sql;
      void bindings;
      return rows;
    });
    const database = new PostgresControlPlaneDatabase({ unsafe } as never);

    await createCloudRunRepository(database).list("user_1");

    expect(unsafe).toHaveBeenCalledOnce();
    const [sql, bindings] = unsafe.mock.calls[0]!;
    expect(sql).toMatch(/created_at AS "createdAt"/);
    expect(sql).toMatch(/order by "createdAt" desc,id desc$/i);
    expect(bindings).toEqual(["user_1", "user_1"]);
  });
});
