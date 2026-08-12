import { describe, expect, it } from "vitest";
import {
  assertExecutorDatabaseSchema,
  assertPostgresRuntimeIdentity,
  assertWebsiteDatabaseSchema,
  EXECUTOR_DATABASE_SCHEMA_SQL,
  POSTGRES_RUNTIME_IDENTITY_SQL,
  WEBSITE_DATABASE_SCHEMA_SQL,
} from "../lib/server/postgres-runtime-readiness.js";

const validIdentity = {
  current_role: "cryptobot_netlify",
  session_role: "cryptobot_netlify",
  current_superuser: false,
  current_bypassrls: false,
  session_superuser: false,
  session_bypassrls: false,
};

const validSchema = {
  runs_table_ready: true,
  orders_table_ready: true,
  account_snapshots_table_ready: true,
  realized_pnl_table_ready: true,
  market_column_ready: true,
  symbol_column_ready: true,
  target_index_definition: "CREATE UNIQUE INDEX cloud_runs_nonterminal_target_uidx ON public.cloud_strategy_runs USING btree (user_id, connection_id, market, symbol) WHERE (state <> 'stopped'::text)",
  target_index_predicate: "(state <> 'stopped'::text)",
  target_trigger_ready: true,
  target_function_ready: true,
  target_function_acl_ready: true,
  stop_trigger_ready: true,
  stop_trigger_function_ready: true,
  stop_trigger_function_acl_ready: true,
  stop_function_ready: true,
  stop_function_acl_ready: true,
};

const validWebsiteSchema = {
  promoters_table_ready: true,
  promoters_columns_ready: true,
  promoters_rls_ready: true,
  promoters_policy_ready: true,
  promoters_select_ready: true,
  promoters_mutation_blocked: true,
  promoters_constraints_ready: true,
};

describe("Postgres production runtime readiness", () => {
  it("accepts only the exact low-privilege website or executor database identity", () => {
    expect(() => assertPostgresRuntimeIdentity(validIdentity, "cryptobot_netlify")).not.toThrow();
    expect(() => assertPostgresRuntimeIdentity({
      ...validIdentity,
      current_role: "cryptobot_executor",
      session_role: "cryptobot_executor",
    }, "cryptobot_executor")).not.toThrow();
  });

  it.each([
    ["mismatched current role", { current_role: "postgres" }],
    ["mismatched session role", { session_role: "postgres" }],
    ["current superuser", { current_superuser: true }],
    ["session superuser", { session_superuser: true }],
    ["current BYPASSRLS", { current_bypassrls: true }],
    ["session BYPASSRLS", { session_bypassrls: true }],
  ])("rejects %s", (_label, override) => {
    expect(() => assertPostgresRuntimeIdentity({ ...validIdentity, ...override }, "cryptobot_netlify"))
      .toThrow("Postgres runtime identity is not ready");
  });

  it.each([null, undefined, [], {}, { ...validIdentity, current_bypassrls: "false" }])(
    "rejects malformed identity evidence %#",
    (identity) => {
      expect(() => assertPostgresRuntimeIdentity(identity, "cryptobot_netlify"))
        .toThrow("Postgres runtime identity is not ready");
    },
  );

  it("requires the canonical target columns, unique partial index, compatibility trigger, and stop fence", () => {
    expect(() => assertExecutorDatabaseSchema(validSchema)).not.toThrow();
    expect(POSTGRES_RUNTIME_IDENTITY_SQL).toContain("current_user::text");
    expect(POSTGRES_RUNTIME_IDENTITY_SQL).toContain("rolbypassrls");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL).toContain("cloud_runs_nonterminal_target_uidx");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL).toContain("cloud_runs_synchronize_target");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL).toContain("cloud_runs_reject_unsettled_stop");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL)
      .toContain("private.stop_cloud_strategy_run(text,text,bigint,bigint)");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL).toContain("target_function_acl_ready");
    expect(EXECUTOR_DATABASE_SCHEMA_SQL).toContain("stop_function_acl_ready");
  });

  it.each([
    ["market column", { market_column_ready: false }],
    ["symbol column", { symbol_column_ready: false }],
    ["compatibility trigger", { target_trigger_ready: false }],
    ["target function", { target_function_ready: false }],
    ["target function ACL", { target_function_acl_ready: false }],
    ["stop trigger", { stop_trigger_ready: false }],
    ["stop trigger function", { stop_trigger_function_ready: false }],
    ["stop trigger function ACL", { stop_trigger_function_acl_ready: false }],
    ["stop fence function", { stop_function_ready: false }],
    ["stop fence ACL", { stop_function_acl_ready: false }],
    ["canonical index", { target_index_definition: null }],
    ["canonical index column", {
      target_index_definition: "CREATE UNIQUE INDEX cloud_runs_nonterminal_target_uidx ON public.cloud_strategy_runs USING btree (user_id, connection_id, symbol)",
    }],
    ["nonterminal predicate", { target_index_predicate: "state = 'running'::text" }],
  ])("rejects a schema missing its %s", (_label, override) => {
    expect(() => assertExecutorDatabaseSchema({ ...validSchema, ...override }))
      .toThrow("Cloud runtime database schema is not ready");
  });

  it("requires the server-owned promoter schema and read-only Netlify authorization", () => {
    expect(() => assertWebsiteDatabaseSchema(validWebsiteSchema)).not.toThrow();
    expect(WEBSITE_DATABASE_SCHEMA_SQL).toContain("to_regclass('public.promoters')");
    expect(WEBSITE_DATABASE_SCHEMA_SQL).toContain("relrowsecurity");
    expect(WEBSITE_DATABASE_SCHEMA_SQL).toContain("promoters_active_approval");
    for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"]) {
      expect(WEBSITE_DATABASE_SCHEMA_SQL).toContain(`'${privilege}'`);
    }
  });

  it.each([
    ["table", { promoters_table_ready: false }],
    ["columns", { promoters_columns_ready: false }],
    ["RLS", { promoters_rls_ready: false }],
    ["select policy", { promoters_policy_ready: false }],
    ["select grant", { promoters_select_ready: false }],
    ["mutation block", { promoters_mutation_blocked: false }],
    ["trust constraints", { promoters_constraints_ready: false }],
  ])("rejects a website schema missing its %s", (_label, override) => {
    expect(() => assertWebsiteDatabaseSchema({ ...validWebsiteSchema, ...override }))
      .toThrow("Website control-plane database schema is not ready");
  });
});
