import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Supabase server runtime grants", () => {
  it("lets the Netlify control plane read WEEX connection state and manage cloud runs only", async () => {
    const migration = await readFile(resolve(
      "supabase/migrations/20260724054500_grant_netlify_cloud_control_plane.sql",
    ), "utf8");

    expect(migration).toMatch(
      /grant\s+select\s+on\s+table\s+public\.weex_connections\s+to\s+cryptobot_netlify/i,
    );
    expect(migration).toMatch(
      /grant\s+select,\s*insert,\s*update\s+on\s+table\s+public\.cloud_strategy_runs\s+to\s+cryptobot_netlify/i,
    );
    expect(migration).not.toMatch(/\bdelete\b/i);
    expect(migration).not.toMatch(/\bprivate\./i);
    expect(migration).not.toMatch(/weex_credential_blobs|cloud_order_intents/i);
  });
});
