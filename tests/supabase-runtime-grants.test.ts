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

  it("keeps account projections server-only while granting the executor least-privilege synchronization", async () => {
    const migration = await readFile(resolve(
      "supabase/migrations/20260724074817_sync_weex_account_dashboard.sql",
    ), "utf8");

    expect(migration).toMatch(/alter table public\.weex_account_snapshots enable row level security/i);
    expect(migration).toMatch(/alter table public\.weex_realized_pnl_ledger enable row level security/i);
    expect(migration).toMatch(/revoke all[\s\S]*from public,\s*anon,\s*authenticated/i);
    expect(migration).toMatch(
      /grant select,\s*insert,\s*update on table public\.weex_account_snapshots\s+to cryptobot_executor/i,
    );
    expect(migration).toMatch(
      /grant select on table public\.weex_account_snapshots,\s*public\.weex_realized_pnl_ledger to cryptobot_netlify/i,
    );
    expect(migration).not.toMatch(/grant\s+.*\s+to\s+(anon|authenticated)/i);
    expect(migration).not.toMatch(/grant\s+delete/i);
  });
});
