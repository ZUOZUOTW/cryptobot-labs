PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`device_id` text,
	`deployment_id` text,
	`strategy_version_id` text,
	`type` text NOT NULL,
	`correlation_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_audit_events`("id", "user_id", "actor_type", "actor_id", "device_id", "deployment_id", "strategy_version_id", "type", "correlation_id", "payload_json", "occurred_at", "created_at") SELECT "id", "user_id", "actor_type", "actor_id", "device_id", "deployment_id", "strategy_version_id", "type", "correlation_id", "payload_json", "occurred_at", "created_at" FROM `audit_events`;--> statement-breakpoint
DROP TABLE `audit_events`;--> statement-breakpoint
ALTER TABLE `__new_audit_events` RENAME TO `audit_events`;--> statement-breakpoint
CREATE INDEX `audit_events_user_occurred_idx` ON `audit_events` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_deployment_occurred_idx` ON `audit_events` (`deployment_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_events_correlation_idx` ON `audit_events` (`correlation_id`);--> statement-breakpoint
CREATE INDEX `audit_events_device_occurred_idx` ON `audit_events` (`device_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_backtest_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`backtest_job_id` text NOT NULL,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`interval` text NOT NULL,
	`source` text NOT NULL,
	`requested_start_at` integer NOT NULL,
	`requested_end_at` integer NOT NULL,
	`actual_start_at` integer,
	`actual_end_at` integer,
	`complete` integer NOT NULL,
	`gaps_json` text NOT NULL,
	`checksum` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backtest_job_id`,`user_id`) REFERENCES `backtest_jobs`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_backtest_datasets`("id", "user_id", "backtest_job_id", "market", "symbol", "interval", "source", "requested_start_at", "requested_end_at", "actual_start_at", "actual_end_at", "complete", "gaps_json", "checksum", "created_at") SELECT "id", "user_id", "backtest_job_id", "market", "symbol", "interval", "source", "requested_start_at", "requested_end_at", "actual_start_at", "actual_end_at", "complete", "gaps_json", "checksum", "created_at" FROM `backtest_datasets`;--> statement-breakpoint
DROP TABLE `backtest_datasets`;--> statement-breakpoint
ALTER TABLE `__new_backtest_datasets` RENAME TO `backtest_datasets`;--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_datasets_id_user_uidx` ON `backtest_datasets` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_datasets_job_uidx` ON `backtest_datasets` (`backtest_job_id`);--> statement-breakpoint
CREATE INDEX `backtest_datasets_user_created_idx` ON `backtest_datasets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `backtest_datasets_checksum_idx` ON `backtest_datasets` (`checksum`);--> statement-breakpoint
CREATE TABLE `__new_backtest_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`status` text NOT NULL,
	`evidence_level` text NOT NULL,
	`request_json` text NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_version_id`,`user_id`) REFERENCES `strategy_versions`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_backtest_jobs`("id", "user_id", "strategy_version_id", "status", "evidence_level", "request_json", "error_code", "error_message", "created_at", "started_at", "completed_at") SELECT "id", "user_id", "strategy_version_id", "status", "evidence_level", "request_json", "error_code", "error_message", "created_at", "started_at", "completed_at" FROM `backtest_jobs`;--> statement-breakpoint
DROP TABLE `backtest_jobs`;--> statement-breakpoint
ALTER TABLE `__new_backtest_jobs` RENAME TO `backtest_jobs`;--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_jobs_id_user_uidx` ON `backtest_jobs` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `backtest_jobs_user_created_idx` ON `backtest_jobs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `backtest_jobs_user_status_idx` ON `backtest_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `__new_backtest_results` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`backtest_job_id` text NOT NULL,
	`dataset_id` text NOT NULL,
	`evidence_level` text NOT NULL,
	`initial_capital` text NOT NULL,
	`fee_rate` text NOT NULL,
	`slippage_rate` text NOT NULL,
	`leverage` text NOT NULL,
	`funding_json` text NOT NULL,
	`metrics_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`equity_curve_json` text NOT NULL,
	`engine_version` text NOT NULL,
	`configuration_hash` text NOT NULL,
	`strategy_hash` text NOT NULL,
	`script_hash` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`backtest_job_id`,`user_id`) REFERENCES `backtest_jobs`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dataset_id`,`user_id`) REFERENCES `backtest_datasets`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_backtest_results`("id", "user_id", "backtest_job_id", "dataset_id", "evidence_level", "initial_capital", "fee_rate", "slippage_rate", "leverage", "funding_json", "metrics_json", "provenance_json", "equity_curve_json", "engine_version", "configuration_hash", "strategy_hash", "script_hash", "created_at") SELECT "id", "user_id", "backtest_job_id", "dataset_id", "evidence_level", "initial_capital", "fee_rate", "slippage_rate", "leverage", "funding_json", "metrics_json", "provenance_json", "equity_curve_json", "engine_version", "configuration_hash", "strategy_hash", "script_hash", "created_at" FROM `backtest_results`;--> statement-breakpoint
DROP TABLE `backtest_results`;--> statement-breakpoint
ALTER TABLE `__new_backtest_results` RENAME TO `backtest_results`;--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_results_id_user_uidx` ON `backtest_results` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backtest_results_job_uidx` ON `backtest_results` (`backtest_job_id`);--> statement-breakpoint
CREATE INDEX `backtest_results_user_created_idx` ON `backtest_results` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_command_acknowledgements` (
	`id` text PRIMARY KEY NOT NULL,
	`command_id` text NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`acknowledged_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`command_id`,`device_id`,`user_id`) REFERENCES `commands`(`id`,`device_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_command_acknowledgements`("id", "command_id", "user_id", "device_id", "status", "payload_json", "acknowledged_at") SELECT "id", "command_id", "user_id", "device_id", "status", "payload_json", "acknowledged_at" FROM `command_acknowledgements`;--> statement-breakpoint
DROP TABLE `command_acknowledgements`;--> statement-breakpoint
ALTER TABLE `__new_command_acknowledgements` RENAME TO `command_acknowledgements`;--> statement-breakpoint
CREATE UNIQUE INDEX `command_acknowledgements_id_user_uidx` ON `command_acknowledgements` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `command_acknowledgements_command_uidx` ON `command_acknowledgements` (`command_id`);--> statement-breakpoint
CREATE INDEX `command_acknowledgements_user_idx` ON `command_acknowledgements` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`device_id` text NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_commands`("id", "user_id", "deployment_id", "device_id", "type", "payload_json", "status", "created_at", "expires_at") SELECT "id", "user_id", "deployment_id", "device_id", "type", "payload_json", "status", "created_at", "expires_at" FROM `commands`;--> statement-breakpoint
DROP TABLE `commands`;--> statement-breakpoint
ALTER TABLE `__new_commands` RENAME TO `commands`;--> statement-breakpoint
CREATE UNIQUE INDEX `commands_id_user_uidx` ON `commands` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `commands_id_device_user_uidx` ON `commands` (`id`,`device_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `commands_device_status_created_idx` ON `commands` (`device_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `commands_user_created_idx` ON `commands` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`strategy_version_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`configuration_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer,
	`stopped_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`strategy_version_id`,`user_id`) REFERENCES `strategy_versions`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_deployments`("id", "user_id", "device_id", "strategy_version_id", "name", "mode", "state", "configuration_hash", "created_at", "updated_at", "started_at", "stopped_at") SELECT "id", "user_id", "device_id", "strategy_version_id", "name", "mode", "state", "configuration_hash", "created_at", "updated_at", "started_at", "stopped_at" FROM `deployments`;--> statement-breakpoint
DROP TABLE `deployments`;--> statement-breakpoint
ALTER TABLE `__new_deployments` RENAME TO `deployments`;--> statement-breakpoint
CREATE UNIQUE INDEX `deployments_id_user_uidx` ON `deployments` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `deployments_user_state_idx` ON `deployments` (`user_id`,`state`);--> statement-breakpoint
CREATE INDEX `deployments_device_state_idx` ON `deployments` (`device_id`,`state`);--> statement-breakpoint
CREATE TABLE `__new_device_credentials` (
	`device_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`credential_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_device_credentials`("device_id", "user_id", "credential_hash", "expires_at", "revoked_at", "created_at") SELECT credentials."device_id", devices."user_id", credentials."credential_hash", credentials."expires_at", credentials."revoked_at", credentials."created_at" FROM `device_credentials` AS credentials INNER JOIN `devices` AS devices ON devices."id" = credentials."device_id";--> statement-breakpoint
DROP TABLE `device_credentials`;--> statement-breakpoint
ALTER TABLE `__new_device_credentials` RENAME TO `device_credentials`;--> statement-breakpoint
CREATE UNIQUE INDEX `device_credentials_hash_uidx` ON `device_credentials` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `device_credentials_expiry_idx` ON `device_credentials` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_device_nonces` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`user_id` text NOT NULL,
	`nonce` text NOT NULL,
	`timestamp` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_device_nonces`("id", "device_id", "user_id", "nonce", "timestamp", "expires_at") SELECT nonces."id", nonces."device_id", devices."user_id", nonces."nonce", nonces."timestamp", nonces."expires_at" FROM `device_nonces` AS nonces INNER JOIN `devices` AS devices ON devices."id" = nonces."device_id";--> statement-breakpoint
DROP TABLE `device_nonces`;--> statement-breakpoint
ALTER TABLE `__new_device_nonces` RENAME TO `device_nonces`;--> statement-breakpoint
CREATE UNIQUE INDEX `device_nonces_device_nonce_uidx` ON `device_nonces` (`device_id`,`nonce`);--> statement-breakpoint
CREATE INDEX `device_nonces_expiry_idx` ON `device_nonces` (`expires_at`);--> statement-breakpoint
CREATE TABLE `__new_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`order_id` text NOT NULL,
	`exchange_fill_id` text NOT NULL,
	`price` text NOT NULL,
	`quantity` text NOT NULL,
	`fee` text NOT NULL,
	`fee_currency` text NOT NULL,
	`realized_pnl` text,
	`filled_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`,`deployment_id`,`user_id`) REFERENCES `orders`(`id`,`deployment_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fills`("id", "user_id", "deployment_id", "order_id", "exchange_fill_id", "price", "quantity", "fee", "fee_currency", "realized_pnl", "filled_at") SELECT "id", "user_id", "deployment_id", "order_id", "exchange_fill_id", "price", "quantity", "fee", "fee_currency", "realized_pnl", "filled_at" FROM `fills`;--> statement-breakpoint
DROP TABLE `fills`;--> statement-breakpoint
ALTER TABLE `__new_fills` RENAME TO `fills`;--> statement-breakpoint
CREATE UNIQUE INDEX `fills_id_user_uidx` ON `fills` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fills_order_exchange_fill_uidx` ON `fills` (`order_id`,`exchange_fill_id`);--> statement-breakpoint
CREATE INDEX `fills_user_filled_idx` ON `fills` (`user_id`,`filled_at`);--> statement-breakpoint
CREATE INDEX `fills_deployment_filled_idx` ON `fills` (`deployment_id`,`filled_at`);--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`client_order_id` text NOT NULL,
	`exchange_order_id` text,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`position_side` text NOT NULL,
	`order_type` text NOT NULL,
	`state` text NOT NULL,
	`price` text,
	`quantity` text NOT NULL,
	`filled_quantity` text NOT NULL,
	`average_fill_price` text,
	`notional` text NOT NULL,
	`correlation_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "user_id", "deployment_id", "client_order_id", "exchange_order_id", "market", "symbol", "side", "position_side", "order_type", "state", "price", "quantity", "filled_quantity", "average_fill_price", "notional", "correlation_id", "created_at", "updated_at") SELECT "id", "user_id", "deployment_id", "client_order_id", "exchange_order_id", "market", "symbol", "side", "position_side", "order_type", "state", "price", "quantity", "filled_quantity", "average_fill_price", "notional", "correlation_id", "created_at", "updated_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_user_uidx` ON `orders` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_id_deployment_user_uidx` ON `orders` (`id`,`deployment_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_deployment_client_order_uidx` ON `orders` (`deployment_id`,`client_order_id`);--> statement-breakpoint
CREATE INDEX `orders_user_created_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `orders_exchange_order_idx` ON `orders` (`exchange_order_id`);--> statement-breakpoint
CREATE INDEX `orders_deployment_state_idx` ON `orders` (`deployment_id`,`state`);--> statement-breakpoint
CREATE TABLE `__new_position_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`heartbeat_id` text,
	`market` text NOT NULL,
	`symbol` text NOT NULL,
	`side` text NOT NULL,
	`quantity` text NOT NULL,
	`entry_price` text NOT NULL,
	`mark_price` text NOT NULL,
	`unrealized_pnl` text NOT NULL,
	`leverage` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`heartbeat_id`,`deployment_id`,`user_id`) REFERENCES `run_heartbeats`(`id`,`deployment_id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_position_snapshots`("id", "user_id", "deployment_id", "heartbeat_id", "market", "symbol", "side", "quantity", "entry_price", "mark_price", "unrealized_pnl", "leverage", "captured_at") SELECT "id", "user_id", "deployment_id", "heartbeat_id", "market", "symbol", "side", "quantity", "entry_price", "mark_price", "unrealized_pnl", "leverage", "captured_at" FROM `position_snapshots`;--> statement-breakpoint
DROP TABLE `position_snapshots`;--> statement-breakpoint
ALTER TABLE `__new_position_snapshots` RENAME TO `position_snapshots`;--> statement-breakpoint
CREATE UNIQUE INDEX `position_snapshots_id_user_uidx` ON `position_snapshots` (`id`,`user_id`);--> statement-breakpoint
CREATE INDEX `position_snapshots_deployment_captured_idx` ON `position_snapshots` (`deployment_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `position_snapshots_user_captured_idx` ON `position_snapshots` (`user_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `__new_risk_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`allowed_symbols_json` text NOT NULL,
	`max_order_notional` text NOT NULL,
	`max_position_notional` text NOT NULL,
	`max_total_exposure` text NOT NULL,
	`max_simultaneous_positions` integer NOT NULL,
	`max_daily_loss` text NOT NULL,
	`max_leverage` text NOT NULL,
	`max_slippage_bps` integer NOT NULL,
	`min_signal_cooldown_ms` integer NOT NULL,
	`max_consecutive_failures` integer NOT NULL,
	`operation_mode` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_risk_policies`("id", "user_id", "deployment_id", "allowed_symbols_json", "max_order_notional", "max_position_notional", "max_total_exposure", "max_simultaneous_positions", "max_daily_loss", "max_leverage", "max_slippage_bps", "min_signal_cooldown_ms", "max_consecutive_failures", "operation_mode", "created_at", "updated_at") SELECT "id", "user_id", "deployment_id", "allowed_symbols_json", "max_order_notional", "max_position_notional", "max_total_exposure", "max_simultaneous_positions", "max_daily_loss", "max_leverage", "max_slippage_bps", "min_signal_cooldown_ms", "max_consecutive_failures", "operation_mode", "created_at", "updated_at" FROM `risk_policies`;--> statement-breakpoint
DROP TABLE `risk_policies`;--> statement-breakpoint
ALTER TABLE `__new_risk_policies` RENAME TO `risk_policies`;--> statement-breakpoint
CREATE UNIQUE INDEX `risk_policies_id_user_uidx` ON `risk_policies` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `risk_policies_deployment_uidx` ON `risk_policies` (`deployment_id`);--> statement-breakpoint
CREATE INDEX `risk_policies_user_idx` ON `risk_policies` (`user_id`);--> statement-breakpoint
CREATE TABLE `__new_run_heartbeats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`deployment_id` text NOT NULL,
	`device_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`health` text NOT NULL,
	`summary_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deployment_id`,`user_id`) REFERENCES `deployments`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`,`user_id`) REFERENCES `devices`(`id`,`user_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_run_heartbeats`("id", "user_id", "deployment_id", "device_id", "sequence", "mode", "state", "health", "summary_json", "occurred_at") SELECT "id", "user_id", "deployment_id", "device_id", "sequence", "mode", "state", "health", "summary_json", "occurred_at" FROM `run_heartbeats`;--> statement-breakpoint
DROP TABLE `run_heartbeats`;--> statement-breakpoint
ALTER TABLE `__new_run_heartbeats` RENAME TO `run_heartbeats`;--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_id_user_uidx` ON `run_heartbeats` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_id_deployment_user_uidx` ON `run_heartbeats` (`id`,`deployment_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `run_heartbeats_deployment_sequence_uidx` ON `run_heartbeats` (`deployment_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `run_heartbeats_user_occurred_idx` ON `run_heartbeats` (`user_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `__new_strategy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`strategy_id` text NOT NULL,
	`version` integer NOT NULL,
	`config_hash` text NOT NULL,
	`source_hash` text,
	`config_json` text NOT NULL,
	`source_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`strategy_id`,`user_id`) REFERENCES `strategies`(`id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_strategy_versions`("id", "user_id", "strategy_id", "version", "config_hash", "source_hash", "config_json", "source_code", "created_at") SELECT versions."id", strategies."user_id", versions."strategy_id", versions."version", versions."config_hash", versions."source_hash", versions."config_json", versions."source_code", versions."created_at" FROM `strategy_versions` AS versions INNER JOIN `strategies` AS strategies ON strategies."id" = versions."strategy_id";--> statement-breakpoint
DROP TABLE `strategy_versions`;--> statement-breakpoint
ALTER TABLE `__new_strategy_versions` RENAME TO `strategy_versions`;--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_versions_id_user_uidx` ON `strategy_versions` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strategy_versions_strategy_version_uidx` ON `strategy_versions` (`strategy_id`,`version`);--> statement-breakpoint
CREATE INDEX `strategy_versions_config_hash_idx` ON `strategy_versions` (`config_hash`);--> statement-breakpoint
CREATE INDEX `strategy_versions_source_hash_idx` ON `strategy_versions` (`source_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `devices_id_user_uidx` ON `devices` (`id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `strategies_id_user_uidx` ON `strategies` (`id`,`user_id`);--> statement-breakpoint
CREATE TRIGGER audit_events_prevent_update
BEFORE UPDATE ON audit_events
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER audit_events_prevent_delete
BEFORE DELETE ON audit_events
BEGIN
	SELECT RAISE(ABORT, 'audit_events are append-only');
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
