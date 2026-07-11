import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "number" });

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  normalizedEmail: text("normalized_email").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  uniqueIndex("users_normalized_email_uidx").on(table.normalizedEmail),
]);

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  publicKeyJwk: text("public_key_jwk").notNull(),
  status: text("status").notNull(),
  pairedAt: timestamp("paired_at").notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  index("devices_user_status_idx").on(table.userId, table.status),
  index("devices_user_last_seen_idx").on(table.userId, table.lastSeenAt),
]);

export const deviceCredentials = sqliteTable("device_credentials", {
  deviceId: text("device_id").primaryKey().references(() => devices.id, { onDelete: "cascade" }),
  credentialHash: text("credential_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("device_credentials_hash_uidx").on(table.credentialHash),
  index("device_credentials_expiry_idx").on(table.expiresAt),
]);

export const pairingCodes = sqliteTable("pairing_codes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("pairing_codes_hash_uidx").on(table.codeHash),
  index("pairing_codes_user_expiry_idx").on(table.userId, table.expiresAt),
]);

export const deviceNonces = sqliteTable("device_nonces", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
  nonce: text("nonce").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  uniqueIndex("device_nonces_device_nonce_uidx").on(table.deviceId, table.nonce),
  index("device_nonces_expiry_idx").on(table.expiresAt),
]);

export const strategies = sqliteTable("strategies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  market: text("market").notNull(),
  symbol: text("symbol").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  index("strategies_user_updated_idx").on(table.userId, table.updatedAt),
]);

export const strategyVersions = sqliteTable("strategy_versions", {
  id: text("id").primaryKey(),
  strategyId: text("strategy_id").notNull().references(() => strategies.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  configHash: text("config_hash").notNull(),
  sourceHash: text("source_hash"),
  configJson: text("config_json").notNull(),
  sourceCode: text("source_code"),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("strategy_versions_strategy_version_uidx").on(table.strategyId, table.version),
  index("strategy_versions_config_hash_idx").on(table.configHash),
  index("strategy_versions_source_hash_idx").on(table.sourceHash),
]);

export const backtestJobs = sqliteTable("backtest_jobs", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  strategyVersionId: text("strategy_version_id").notNull().references(() => strategyVersions.id),
  status: text("status").notNull(),
  evidenceLevel: text("evidence_level").notNull(),
  requestJson: text("request_json").notNull(),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("backtest_jobs_user_created_idx").on(table.userId, table.createdAt),
  index("backtest_jobs_user_status_idx").on(table.userId, table.status),
]);

export const backtestDatasets = sqliteTable("backtest_datasets", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  backtestJobId: text("backtest_job_id").notNull().references(() => backtestJobs.id, { onDelete: "cascade" }),
  market: text("market").notNull(),
  symbol: text("symbol").notNull(),
  interval: text("interval").notNull(),
  source: text("source").notNull(),
  requestedStartAt: timestamp("requested_start_at").notNull(),
  requestedEndAt: timestamp("requested_end_at").notNull(),
  actualStartAt: timestamp("actual_start_at"),
  actualEndAt: timestamp("actual_end_at"),
  complete: integer("complete", { mode: "boolean" }).notNull(),
  gapsJson: text("gaps_json").notNull(),
  checksum: text("checksum").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("backtest_datasets_job_uidx").on(table.backtestJobId),
  index("backtest_datasets_user_created_idx").on(table.userId, table.createdAt),
  index("backtest_datasets_checksum_idx").on(table.checksum),
]);

export const backtestResults = sqliteTable("backtest_results", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  backtestJobId: text("backtest_job_id").notNull().references(() => backtestJobs.id, { onDelete: "cascade" }),
  datasetId: text("dataset_id").notNull().references(() => backtestDatasets.id),
  evidenceLevel: text("evidence_level").notNull(),
  initialCapital: text("initial_capital").notNull(),
  feeRate: text("fee_rate").notNull(),
  slippageRate: text("slippage_rate").notNull(),
  leverage: text("leverage").notNull(),
  fundingJson: text("funding_json").notNull(),
  metricsJson: text("metrics_json").notNull(),
  provenanceJson: text("provenance_json").notNull(),
  equityCurveJson: text("equity_curve_json").notNull(),
  engineVersion: text("engine_version").notNull(),
  configurationHash: text("configuration_hash").notNull(),
  strategyHash: text("strategy_hash").notNull(),
  scriptHash: text("script_hash"),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  uniqueIndex("backtest_results_job_uidx").on(table.backtestJobId),
  index("backtest_results_user_created_idx").on(table.userId, table.createdAt),
]);

export const deployments = sqliteTable("deployments", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  strategyVersionId: text("strategy_version_id").notNull().references(() => strategyVersions.id),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  state: text("state").notNull(),
  configurationHash: text("configuration_hash").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  startedAt: timestamp("started_at"),
  stoppedAt: timestamp("stopped_at"),
}, (table) => [
  index("deployments_user_state_idx").on(table.userId, table.state),
  index("deployments_device_state_idx").on(table.deviceId, table.state),
]);

export const riskPolicies = sqliteTable("risk_policies", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  allowedSymbolsJson: text("allowed_symbols_json").notNull(),
  maxOrderNotional: text("max_order_notional").notNull(),
  maxPositionNotional: text("max_position_notional").notNull(),
  maxTotalExposure: text("max_total_exposure").notNull(),
  maxSimultaneousPositions: integer("max_simultaneous_positions").notNull(),
  maxDailyLoss: text("max_daily_loss").notNull(),
  maxLeverage: text("max_leverage").notNull(),
  maxSlippageBps: integer("max_slippage_bps").notNull(),
  minSignalCooldownMs: timestamp("min_signal_cooldown_ms").notNull(),
  maxConsecutiveFailures: integer("max_consecutive_failures").notNull(),
  operationMode: text("operation_mode").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  uniqueIndex("risk_policies_deployment_uidx").on(table.deploymentId),
  index("risk_policies_user_idx").on(table.userId),
]);

export const runHeartbeats = sqliteTable("run_heartbeats", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  sequence: integer("sequence").notNull(),
  mode: text("mode").notNull(),
  state: text("state").notNull(),
  health: text("health").notNull(),
  summaryJson: text("summary_json").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
}, (table) => [
  uniqueIndex("run_heartbeats_deployment_sequence_uidx").on(table.deploymentId, table.sequence),
  index("run_heartbeats_user_occurred_idx").on(table.userId, table.occurredAt),
]);

export const positionSnapshots = sqliteTable("position_snapshots", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  heartbeatId: text("heartbeat_id").references(() => runHeartbeats.id, { onDelete: "set null" }),
  market: text("market").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  entryPrice: text("entry_price").notNull(),
  markPrice: text("mark_price").notNull(),
  unrealizedPnl: text("unrealized_pnl").notNull(),
  leverage: text("leverage").notNull(),
  capturedAt: timestamp("captured_at").notNull(),
}, (table) => [
  index("position_snapshots_deployment_captured_idx").on(table.deploymentId, table.capturedAt),
  index("position_snapshots_user_captured_idx").on(table.userId, table.capturedAt),
]);

export const orders = sqliteTable("orders", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  clientOrderId: text("client_order_id").notNull(),
  exchangeOrderId: text("exchange_order_id"),
  market: text("market").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  positionSide: text("position_side").notNull(),
  orderType: text("order_type").notNull(),
  state: text("state").notNull(),
  price: text("price"),
  quantity: text("quantity").notNull(),
  filledQuantity: text("filled_quantity").notNull(),
  averageFillPrice: text("average_fill_price"),
  notional: text("notional").notNull(),
  correlationId: text("correlation_id").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
}, (table) => [
  uniqueIndex("orders_deployment_client_order_uidx").on(table.deploymentId, table.clientOrderId),
  index("orders_user_created_idx").on(table.userId, table.createdAt),
  index("orders_exchange_order_idx").on(table.exchangeOrderId),
  index("orders_deployment_state_idx").on(table.deploymentId, table.state),
]);

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  exchangeFillId: text("exchange_fill_id").notNull(),
  price: text("price").notNull(),
  quantity: text("quantity").notNull(),
  fee: text("fee").notNull(),
  feeCurrency: text("fee_currency").notNull(),
  realizedPnl: text("realized_pnl"),
  filledAt: timestamp("filled_at").notNull(),
}, (table) => [
  uniqueIndex("fills_order_exchange_fill_uidx").on(table.orderId, table.exchangeFillId),
  index("fills_user_filled_idx").on(table.userId, table.filledAt),
  index("fills_deployment_filled_idx").on(table.deploymentId, table.filledAt),
]);

export const commands = sqliteTable("commands", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull().references(() => deployments.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("commands_device_status_created_idx").on(table.deviceId, table.status, table.createdAt),
  index("commands_user_created_idx").on(table.userId, table.createdAt),
]);

export const commandAcknowledgements = sqliteTable("command_acknowledgements", {
  id: text("id").primaryKey(),
  commandId: text("command_id").notNull().references(() => commands.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull().references(() => devices.id),
  status: text("status").notNull(),
  payloadJson: text("payload_json").notNull(),
  acknowledgedAt: timestamp("acknowledged_at").notNull(),
}, (table) => [
  uniqueIndex("command_acknowledgements_command_uidx").on(table.commandId),
  index("command_acknowledgements_user_idx").on(table.userId),
]);

export const auditEvents = sqliteTable("audit_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  actorType: text("actor_type").notNull(),
  actorId: text("actor_id").notNull(),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
  deploymentId: text("deployment_id").references(() => deployments.id, { onDelete: "set null" }),
  strategyVersionId: text("strategy_version_id").references(() => strategyVersions.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  correlationId: text("correlation_id").notNull(),
  payloadJson: text("payload_json").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
}, (table) => [
  index("audit_events_user_occurred_idx").on(table.userId, table.occurredAt),
  index("audit_events_deployment_occurred_idx").on(table.deploymentId, table.occurredAt),
  index("audit_events_correlation_idx").on(table.correlationId),
  index("audit_events_device_occurred_idx").on(table.deviceId, table.occurredAt),
]);
