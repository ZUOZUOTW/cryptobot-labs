import { describe, expect, it, vi } from "vitest";
import { PostgresControlPlaneDatabase } from "../lib/server/postgres-database";

describe("Supabase Postgres D1 compatibility adapter", () => {
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
});
