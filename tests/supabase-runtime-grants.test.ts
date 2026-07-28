import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Supabase server runtime grants", () => {
  it("removes Netlify BYPASSRLS, private-schema access, and broad mutation grants", async () => {
    const migration = await readFile(resolve(
      "supabase/migrations/20260728050917_harden_netlify_role_and_audit_events.sql",
    ), "utf8");

    expect(migration).toMatch(/alter role cryptobot_netlify[\s\S]*\bnobypassrls\b/i);
    expect(migration).toMatch(
      /pg_roles[\s\S]*rolname = 'cryptobot_netlify'[\s\S]*rolsuper or rolreplication/i,
    );
    expect(migration).toMatch(/revoke all on schema private from cryptobot_netlify/i);
    expect(migration).toMatch(/revoke all on all tables in schema private from cryptobot_netlify/i);
    expect(migration).toMatch(/revoke all on all tables in schema public from cryptobot_netlify/i);
    expect(migration).toMatch(/create policy netlify_server_runtime[\s\S]*to cryptobot_netlify/i);
    expect(migration).toMatch(
      /grant delete on table\s+public\.device_nonces,\s+public\.position_snapshots\s+to cryptobot_netlify/i,
    );
    expect(migration).not.toMatch(
      /grant delete on table[\s\S]*public\.(users|orders|fills|audit_events)[\s\S]*to cryptobot_netlify/i,
    );
  });

  it("makes the production audit ledger append-only for every application role", async () => {
    const migration = await readFile(resolve(
      "supabase/migrations/20260728050917_harden_netlify_role_and_audit_events.sql",
    ), "utf8");

    expect(migration).toMatch(/create or replace function private\.reject_audit_event_mutation\(\)/i);
    expect(migration).toMatch(/raise exception[\s\S]*audit_events are append-only/i);
    expect(migration).toMatch(/revoke update,\s*delete,\s*truncate on table public\.audit_events/i);
    expect(migration).toMatch(
      /before update or delete on public\.audit_events[\s\S]*reject_audit_event_mutation\(\)/i,
    );
    expect(migration).toMatch(
      /before truncate on public\.audit_events[\s\S]*reject_audit_event_mutation\(\)/i,
    );
  });

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
