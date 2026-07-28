import { describe, expect, it, vi } from "vitest";

import type {
  ControlPlaneDatabase,
  ControlPlaneStatement,
} from "../db";
import { createWeexOAuthConnectionRepository } from "../db/repositories";

const databaseWithRow = (row: Record<string, unknown>) => {
  const first = vi.fn(async () => row);
  const statement: ControlPlaneStatement = {
    bind: vi.fn(() => statement),
    first,
    all: vi.fn(),
    run: vi.fn(),
  };
  const prepare = vi.fn(() => statement);
  return {
    database: { prepare, batch: vi.fn() } as unknown as ControlPlaneDatabase,
    prepare,
  };
};

const row = {
  id: "conn_abcdefghijklmnop",
  status: "active",
  credentialSource: "manual",
  maskedApiKeySuffix: "A1B2",
  permissionsJson: {
    read: true,
    spotTrade: true,
    futuresTrade: false,
    withdrawal: false,
  },
  withdrawalAccessAbsent: true,
  verifiedAt: 1_000,
  revokedAt: null,
  updatedAt: 1_000,
};

describe("safe WEEX connection projection", () => {
  it("returns credential origin metadata without exposing credential material", async () => {
    const { database, prepare } = databaseWithRow(row);
    const connection = await createWeexOAuthConnectionRepository(database)
      .latestForUser("usr_1");

    expect(connection).toEqual(expect.objectContaining({
      credentialSource: "manual",
      maskedApiKeySuffix: "A1B2",
    }));
    expect(JSON.stringify(connection)).not.toMatch(/secret|passphrase|access.?token|refresh.?token/i);
    expect(prepare).toHaveBeenCalledWith(expect.stringMatching(/credential_source as credentialSource/i));
  });

  it("fails closed when the stored source is outside the schema contract", async () => {
    const { database } = databaseWithRow({ ...row, credentialSource: "legacy" });
    await expect(createWeexOAuthConnectionRepository(database).latestForUser("usr_1"))
      .rejects.toThrow(/credential source/);
  });
});
