import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "../db/schema";

const expectedTables = [
  "users", "devices", "deviceCredentials", "deviceConnections", "pairingCodes", "deviceBootstraps", "deviceNonces",
  "strategies", "strategyVersions", "backtestJobs", "backtestDatasets", "backtestResults", "strategyPublications",
  "deployments", "riskPolicies", "runHeartbeats", "positionSnapshots", "orders", "fills",
  "commands", "commandAcknowledgements", "auditEvents",
] as const;

const columns = (table: SQLiteTable) => getTableConfig(table).columns.map((column) => column.name);
const indexes = (table: SQLiteTable) => getTableConfig(table).indexes.map((index) => index.config.name);

describe("D1 control-plane schema", () => {
  it("defines every planned table with text IDs and integer millisecond timestamps", () => {
    for (const name of expectedTables) expect(schema[name]).toBeDefined();
    expect(columns(schema.users)).toEqual(expect.arrayContaining(["id", "normalized_email", "created_at", "updated_at"]));
    expect(columns(schema.pairingCodes)).toEqual(expect.arrayContaining(["id", "user_id", "code_hash", "expires_at", "consumed_at"]));
    expect(columns(schema.backtestResults)).toEqual(expect.arrayContaining(["provenance_json", "metrics_json", "initial_capital", "engine_version"]));
    expect(columns(schema.deployments)).toContain("version");
    expect(columns(schema.commands)).toEqual(expect.arrayContaining([
      "version", "correlation_id", "expected_deployment_version",
    ]));
    expect(columns(schema.riskPolicies)).toEqual(expect.arrayContaining([
      "allowed_symbols_json", "max_order_notional", "max_position_notional", "max_total_exposure",
      "max_daily_loss", "max_leverage", "max_slippage_bps", "min_signal_cooldown_ms",
      "max_consecutive_failures",
    ]));
  });

  it("defines ownership, nonce, client-order, and lookup indexes", () => {
    expect(indexes(schema.devices)).toContain("devices_user_status_idx");
    expect(indexes(schema.deviceNonces)).toContain("device_nonces_device_nonce_uidx");
    expect(indexes(schema.orders)).toContain("orders_deployment_client_order_uidx");
    expect(indexes(schema.orders)).toContain("orders_deployment_exchange_order_uidx");
    expect(indexes(schema.fills)).toContain("fills_deployment_exchange_fill_uidx");
    expect(indexes(schema.commands)).toContain("commands_user_correlation_uidx");
    expect(indexes(schema.positionSnapshots)).toContain("position_snapshots_deployment_symbol_side_uidx");
    expect(indexes(schema.auditEvents)).toEqual(expect.arrayContaining([
      "audit_events_user_occurred_idx",
      "audit_events_deployment_occurred_idx",
      "audit_events_correlation_idx",
    ]));
  });

  it("stores only hashes for pairing and device credentials", () => {
    expect(columns(schema.pairingCodes)).toContain("code_hash");
    expect(columns(schema.pairingCodes)).not.toContain("code");
    expect(columns(schema.deviceCredentials)).toContain("credential_hash");
    expect(columns(schema.deviceCredentials)).not.toContain("credential");
    expect(columns(schema.deviceConnections)).toEqual(expect.arrayContaining([
      "provider", "masked_api_key_suffix", "permissions_json", "verified_at", "status", "has_local_credential",
    ]));
  });

  it("has no secret or raw authorization/account columns", () => {
    const forbidden = /(secret|passphrase|access.?sign|authorization|raw.?account)/i;
    for (const name of expectedTables) {
      for (const column of columns(schema[name])) expect(column).not.toMatch(forbidden);
    }
  });

  it("adds device connections in an incremental migration without rewriting the applied baseline", async () => {
    const baseline = await readFile(resolve("drizzle/0000_overconfident_lady_vermin.sql"), "utf8");
    expect(baseline).not.toMatch(/CREATE TABLE `device_connections`/i);

    const files = (await readdir(resolve("drizzle"))).filter((file) => /^0001_.*\.sql$/.test(file));
    expect(files).toHaveLength(1);
    const migration = await readFile(resolve("drizzle", files[0]!), "utf8");
    expect(migration).toMatch(/CREATE TABLE `device_connections`/i);
    expect(migration).not.toMatch(/CREATE TABLE `(backtest_request_keys|strategy_save_keys)`/i);

    const journal = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries).toContainEqual(expect.objectContaining({ idx: 1, tag: files[0]!.replace(/\.sql$/, "") }));

    const snapshot = JSON.parse(await readFile(resolve("drizzle/meta/0001_snapshot.json"), "utf8")) as {
      tables: Record<string, unknown>;
    };
    expect(snapshot.tables).toHaveProperty("device_connections");
  });

  it("generates append-only audit triggers without retaining a Sites project binding", async () => {
    await expect(readFile(resolve(".openai/hosting.json"), "utf8")).rejects.toThrow();
    const files = (await readdir(resolve("drizzle"))).filter((file) => file.endsWith(".sql"));
    const migration = (await Promise.all(files.map((file) => readFile(resolve("drizzle", file), "utf8")))).join("\n");
    expect(migration).toMatch(/CREATE TRIGGER audit_events_prevent_update/i);
    expect(migration).toMatch(/BEFORE UPDATE ON audit_events[\s\S]*RAISE\s*\(\s*ABORT/i);
    expect(migration).toMatch(/CREATE TRIGGER audit_events_prevent_delete/i);
    expect(migration).toMatch(/BEFORE DELETE ON audit_events[\s\S]*RAISE\s*\(\s*ABORT/i);
  });
});
