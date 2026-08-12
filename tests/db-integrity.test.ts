// @vitest-environment node

import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const openDatabases: DatabaseSync[] = [];
const rejectsForeignKey = (database: DatabaseSync, sql: string): void => {
  expect(() => database.exec(sql)).toThrow(/FOREIGN KEY constraint failed/);
};
const addUser = (database: DatabaseSync, id: string): void => {
  database.prepare("INSERT INTO users VALUES (?, ?, ?, 1, 1)").run(id, `${id}@example.test`, id);
};
const addDevice = (database: DatabaseSync, id: string, userId: string): void => {
  database.prepare("INSERT INTO devices VALUES (?, ?, ?, 'macos', '{}', 'active', 1, NULL, NULL, 1, 1)")
    .run(id, userId, id);
};
const addStrategy = (database: DatabaseSync, id: string, userId: string): void => {
  database.prepare("INSERT INTO strategies VALUES (?, ?, ?, 'spot', 'BTCUSDT', 1, 1)").run(id, userId, id);
};
const addVersion = (database: DatabaseSync, id: string, userId: string, strategyId: string): void => {
  database.prepare("INSERT INTO strategy_versions VALUES (?, ?, ?, 1, 'config', NULL, '{}', NULL, 1)")
    .run(id, userId, strategyId);
};
const addDeployment = (database: DatabaseSync, id: string, userId: string, deviceId: string, versionId: string): void => {
  database.prepare("INSERT INTO deployments VALUES (?, ?, ?, ?, ?, 'paper', 'stopped', 1, 'config', 1, 1, NULL, NULL)")
    .run(id, userId, deviceId, versionId, id);
};

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
});

describe("D1 tenant integrity migrations", () => {
  it("applies the ordered migration chain, preserves immutable audit identity, and enforces tenant parents", async () => {
    const database = new DatabaseSync(":memory:");
    openDatabases.push(database);
    database.exec("PRAGMA foreign_keys=ON");

    const migrationFiles = (await readdir(resolve("drizzle"))).filter((file) => file.endsWith(".sql")).sort();
    expect(migrationFiles).toEqual([
      "0000_overconfident_lady_vermin.sql",
      "0001_acoustic_luke_cage.sql",
      "0002_flaky_riptide.sql",
      "0003_mushy_frightful_four.sql",
      "0004_glorious_jetstream.sql",
      "0005_cuddly_brother_voodoo.sql",
      "0006_tranquil_proudstar.sql",
    ]);
    const journal = JSON.parse(await readFile(resolve("drizzle/meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.map(({ idx, tag }) => ({ idx, tag }))).toEqual(
      migrationFiles.map((file, idx) => ({ idx, tag: file.replace(/\.sql$/u, "") })),
    );
    const migrations = await Promise.all(migrationFiles.map((file) => readFile(resolve("drizzle", file), "utf8")));
    const sql = migrations.join("\n");
    expect(sql).not.toMatch(/PRAGMA\s+foreign_keys\s*=\s*OFF/i);
    expect(sql).toMatch(/FOREIGN KEY \(`device_id`,`user_id`\) REFERENCES `devices`\(`id`,`user_id`\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(`strategy_version_id`,`user_id`\) REFERENCES `strategy_versions`\(`id`,`user_id`\)/i);
    expect(sql).toMatch(/FOREIGN KEY \(`pairing_code_id`,`user_id`\) REFERENCES `pairing_codes`\(`id`,`user_id`\)/i);
    for (const migration of migrations) database.exec(migration.replaceAll("--> statement-breakpoint", ""));

    addUser(database, "user_a");
    addUser(database, "user_b");
    addDevice(database, "device_a", "user_a");
    addDevice(database, "device_b", "user_b");
    addStrategy(database, "strategy_a", "user_a");
    addStrategy(database, "strategy_b", "user_b");
    addVersion(database, "version_a", "user_a", "strategy_a");
    addVersion(database, "version_b", "user_b", "strategy_b");
    database.exec("INSERT INTO device_credentials VALUES ('device_a', 'user_a', 'credential-a', 100, NULL, 1)");
    database.exec("INSERT INTO device_nonces VALUES ('nonce_a', 'device_a', 'user_a', 'nonce', 1, 100)");
    database.exec("INSERT INTO audit_events VALUES ('audit_a', 'user_a', 'user', 'user_a', 'device_a', NULL, 'version_a', 'paired', 'correlation', '{}', 1, 1)");

    expect(database.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    database.exec("DELETE FROM users WHERE id = 'user_a'");
    expect(database.prepare("SELECT user_id, device_id, strategy_version_id FROM audit_events WHERE id = 'audit_a'").get())
      .toEqual({ user_id: "user_a", device_id: "device_a", strategy_version_id: "version_a" });
    expect(() => database.exec("UPDATE audit_events SET actor_id = 'changed' WHERE id = 'audit_a'"))
      .toThrow(/append-only/);
    expect(() => database.exec("DELETE FROM audit_events WHERE id = 'audit_a'"))
      .toThrow(/append-only/);

    addUser(database, "user_a");
    addDevice(database, "device_a", "user_a");
    addStrategy(database, "strategy_a", "user_a");
    addVersion(database, "version_a2", "user_a", "strategy_a");
    database.exec("INSERT INTO pairing_codes VALUES ('pair_b', 'user_b', 'pair-hash-b', 100, NULL, 1)");
    rejectsForeignKey(database, "INSERT INTO device_bootstraps VALUES ('boot_bad', 'user_a', 'device_a', 'pair_b', 'boot-hash', 'challenge-hash', 100, NULL, 1)");
    rejectsForeignKey(database, "INSERT INTO strategy_versions VALUES ('bad_version', 'user_a', 'strategy_b', 2, 'x', NULL, '{}', NULL, 1)");
    rejectsForeignKey(database, "INSERT INTO device_credentials VALUES ('device_b', 'user_a', 'bad', 100, NULL, 1)");
    rejectsForeignKey(database, "INSERT INTO device_nonces VALUES ('bad_nonce', 'device_b', 'user_a', 'bad', 1, 100)");

    rejectsForeignKey(database, "INSERT INTO deployments VALUES ('bad_dep_device', 'user_a', 'device_b', 'version_a2', 'bad', 'paper', 'stopped', 1, 'x', 1, 1, NULL, NULL)");
    rejectsForeignKey(database, "INSERT INTO deployments VALUES ('bad_dep_strategy', 'user_a', 'device_a', 'version_b', 'bad', 'paper', 'stopped', 1, 'x', 1, 1, NULL, NULL)");
    addDeployment(database, "dep_a", "user_a", "device_a", "version_a2");
    addDeployment(database, "dep_b", "user_b", "device_b", "version_b");

    rejectsForeignKey(database, "INSERT INTO backtest_jobs VALUES ('bad_job', 'user_a', 'version_b', 'queued', 'historical', '{}', NULL, NULL, 1, NULL, NULL)");
    database.exec("INSERT INTO backtest_jobs VALUES ('job_a', 'user_a', 'version_a2', 'done', 'historical', '{}', NULL, NULL, 1, 1, 1)");
    database.exec("INSERT INTO backtest_jobs VALUES ('job_b', 'user_b', 'version_b', 'done', 'historical', '{}', NULL, NULL, 1, 1, 1)");
    rejectsForeignKey(database, "INSERT INTO backtest_datasets VALUES ('bad_dataset', 'user_a', 'job_b', 'spot', 'BTCUSDT', '1h', 'WEEX', 1, 2, 1, 2, 1, '[]', 'x', 1)");
    database.exec("INSERT INTO backtest_datasets VALUES ('dataset_a', 'user_a', 'job_a', 'spot', 'BTCUSDT', '1h', 'WEEX', 1, 2, 1, 2, 1, '[]', 'a', 1)");
    database.exec("INSERT INTO backtest_datasets VALUES ('dataset_b', 'user_b', 'job_b', 'spot', 'BTCUSDT', '1h', 'WEEX', 1, 2, 1, 2, 1, '[]', 'b', 1)");
    rejectsForeignKey(database, "INSERT INTO backtest_results VALUES ('bad_result', 'user_a', 'job_a', 'dataset_b', 'historical', '1', '0', '0', '1', '[]', '{}', '{}', '[]', '1', 'c', 's', NULL, 1)");

    rejectsForeignKey(database, "INSERT INTO risk_policies VALUES ('bad_risk', 'user_a', 'dep_b', '[]', '1', '1', '1', 1, '1', '1', 1, 1, 1, 'paper', 1, 1)");
    rejectsForeignKey(database, "INSERT INTO run_heartbeats VALUES ('bad_heartbeat', 'user_a', 'dep_a', 'device_b', 1, 'paper', 'running', 'healthy', '{}', 1)");
    database.exec("INSERT INTO run_heartbeats VALUES ('heartbeat_a', 'user_a', 'dep_a', 'device_a', 1, 'paper', 'running', 'healthy', '{}', 1)");
    database.exec("INSERT INTO run_heartbeats VALUES ('heartbeat_b', 'user_b', 'dep_b', 'device_b', 1, 'paper', 'running', 'healthy', '{}', 1)");
    rejectsForeignKey(database, "INSERT INTO position_snapshots VALUES ('bad_position', 'user_a', 'dep_a', 'heartbeat_b', 'spot', 'BTCUSDT', 'long', '1', '1', '1', '0', '1', 1)");

    rejectsForeignKey(database, "INSERT INTO orders VALUES ('bad_order', 'user_a', 'dep_b', 'client-bad', NULL, 'spot', 'BTCUSDT', 'buy', 'net', 'market', 'created', NULL, '1', '0', NULL, '1', 'c', 1, 1)");
    database.exec("INSERT INTO orders VALUES ('order_a', 'user_a', 'dep_a', 'client-a', NULL, 'spot', 'BTCUSDT', 'buy', 'net', 'market', 'filled', NULL, '1', '1', '1', '1', 'a', 1, 1)");
    database.exec("INSERT INTO orders VALUES ('order_b', 'user_b', 'dep_b', 'client-b', NULL, 'spot', 'BTCUSDT', 'buy', 'net', 'market', 'filled', NULL, '1', '1', '1', '1', 'b', 1, 1)");
    rejectsForeignKey(database, "INSERT INTO fills VALUES ('bad_fill', 'user_a', 'dep_a', 'order_b', 'fill', '1', '1', '0', 'USDT', NULL, 1)");

    rejectsForeignKey(database, "INSERT INTO commands VALUES ('bad_command', 'user_a', 'dep_a', 'device_b', 'pause', 1, 'corr-bad', 1, '{}', 'pending', 1, 2)");
    database.exec("INSERT INTO commands VALUES ('command_a', 'user_a', 'dep_a', 'device_a', 'pause', 1, 'corr-a', 1, '{}', 'pending', 1, 2)");
    database.exec("INSERT INTO commands VALUES ('command_b', 'user_b', 'dep_b', 'device_b', 'pause', 1, 'corr-b', 1, '{}', 'pending', 1, 2)");
    rejectsForeignKey(database, "INSERT INTO command_acknowledgements VALUES ('bad_ack', 'command_b', 'user_a', 'device_a', 'ok', '{}', 1)");
  });
});
