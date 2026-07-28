import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath =
  "supabase/migrations/20260728164403_add_weex_credential_source.sql";

describe("WEEX credential source migration", () => {
  it("adds a constrained, non-secret source and backfills successful OAuth rows", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toMatch(/add column credential_source text not null default 'manual'/i);
    expect(sql).toMatch(/credential_source in \('manual', 'oauth'\)/i);
    expect(sql).toMatch(/private\.weex_oauth_states[\s\S]*status = 'success'/i);
    expect(sql).not.toMatch(/api_key|secret_key|passphrase|access_token|refresh_token/i);
  });
});
